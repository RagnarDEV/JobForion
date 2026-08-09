// src/db/sync.js
// Thin orchestrator ONLY. It does not know how to talk to any specific
// job-board API — that logic lives entirely in src/providers/*.js. This
// file's job is: read active sources -> pick the right provider module ->
// call it -> dedupe -> save -> log. Adding a new provider never requires
// touching this file (see src/providers/index.js).

import { ensureTable } from './schema.js';
import { logSync } from './analytics.js';
import { PROVIDERS } from '../providers/index.js';
import { getSettings } from '../lib/settings.js';

// QUERIES only applies to a future keyword-search provider (ignoresQuery ===
// false) — every provider currently registered is a per-company/tenant ATS
// board (ignoresQuery === true, called once per sync), so this list is
// dormant today but kept so the orchestrator doesn't need to change again
// the moment a keyword-search provider is added back.
const QUERIES = ["developer", "designer", "marketing", "data", "devops", "writer", "sales", "customer support", "product manager", "finance", "recruiter", "qa engineer", "manager"];
const RETRIES = 2;
const TIMEOUT_MS = 15000;
const DELAY_BETWEEN_QUERIES_MS = 350; // spaces out consecutive calls to the same provider to avoid per-second rate limits

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ────────────────────────────────────────────────────────────────
// WARM-UP GOVERNOR — protects the site from a mass job dump the first
// time a company board is added (or the first time sync ever runs on a
// fresh database). Without this, adding several ATS sources at once (each
// returning dozens-to-hundreds of postings) inserts everything in a single
// run — a burst of D1 writes and a sudden jump in listing/sitemap size
// that a small Cloudflare Workers/D1 plan isn't sized for on day one.
//
// While the site's total job count is still below `sync_warmup_threshold`,
// each provider is capped at `sync_warmup_cap_per_provider` NEW jobs per
// run instead of its full board. Because sync re-runs on a cron (every few
// hours — see wrangler.toml), the count climbs gradually run over run
// until it crosses the threshold, at which point the cap lifts
// automatically and every provider syncs its full board from then on — no
// manual step, no flag to remember to flip back off.
//
// `sync_hard_cap_per_provider` is a second, much looser ceiling that stays
// in effect permanently (even after warm-up ends) as basic defense against
// any single tenant board being unexpectedly huge.
// ────────────────────────────────────────────────────────────────

async function getSyncGovernorConfig(env) {
  const s = await getSettings(env);
  return {
    warmupThreshold: Math.max(0, parseInt(s.sync_warmup_threshold, 10) || 150),
    warmupCapPerProvider: Math.max(1, parseInt(s.sync_warmup_cap_per_provider, 10) || 15),
    hardCapPerProvider: Math.max(1, parseInt(s.sync_hard_cap_per_provider, 10) || 100),
  };
}

async function getTotalJobsCount(env) {
  try {
    const { results } = await env.DB.prepare('SELECT COUNT(*) c FROM jobs').all();
    return results?.[0]?.c || 0;
  } catch (e) {
    return 0; // fail safe toward warm-up (throttled), never toward an unbounded first run
  }
}

// ────────────────────────────────────────────────────────────────
// SUBREQUEST BUDGET — Cloudflare Workers caps the TOTAL number of
// subrequests (fetch calls + D1 calls, combined) a single Worker
// invocation may make — as low as 50 on the free plan. syncJobs() runs as
// ONE invocation (the cron `scheduled()` handler) that loops every active
// source in sequence, so with enough sources configured the run can hit
// that ceiling mid-loop and get killed by Cloudflare itself, mid-provider
// — which is exactly what "Too many subrequests by a single Worker
// invocation" in the sync log means (this is a platform-level abort, not
// a provider bug). This budget stops picking up NEW sources once the
// estimated remaining headroom gets tight, so a run always finishes
// cleanly with a clear log line instead of being cut off mid-write.
// Remaining sources simply get their turn on the next cron run (every few
// hours — see wrangler.toml) rather than being skipped forever.
const SUBREQUEST_SAFETY_CEILING = 40; // stay well under the free plan's 50
let subrequestsUsed = 0;

// Conservative estimate of subrequests one provider run could use: 1
// fetch + up to 2 D1 batch() calls (insert + update) per DB_BATCH_SIZE
// chunk of its capped job count. Estimating BEFORE the fetch (not after)
// is what lets the budget check actually prevent an overrun rather than
// just notice it too late.
function estimateSubrequests(capForThisProvider) {
  const chunks = Math.ceil(capForThisProvider / DB_BATCH_SIZE);
  return 1 + chunks * 2;
}

// ────────────────────────────────────────────────────────────────
// Sources (api_sources table)
// ────────────────────────────────────────────────────────────────

export async function getActiveSources(env) {
  const sources = [];
  try {
    const { results } = await env.DB.prepare(`SELECT label, api_key, provider FROM api_sources WHERE active = 1`).all();
    (results || []).forEach(r => {
      if (r.api_key && r.provider) sources.push({ label: r.label, api_key: r.api_key, provider: r.provider });
    });
  } catch (e) {}
  const seen = new Set();
  return sources.filter(s => {
    const key = `${s.provider}:${s.api_key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Inserts a new API source without assuming a fixed column set — the live
// api_sources table predates the current schema and has accumulated NOT
// NULL columns (name, base_url, ...) that a fresh install won't have. This
// reads the table's real structure via PRAGMA table_info and fills in a
// sensible value for whatever it finds, instead of hardcoding columns.
export async function insertApiSource(env, label, apiKey, provider = 'greenhouse') {
  const { results: cols } = await env.DB.prepare(`PRAGMA table_info(api_sources)`).all();
  const knownValues = { label, name: label, api_key: apiKey, provider, active: 1 };
  const insertCols = [];
  const values = [];
  for (const col of (cols || [])) {
    if (col.name === 'id') continue;
    if (col.name === 'created_at' && col.dflt_value != null) continue;
    if (col.name in knownValues) {
      insertCols.push(col.name);
      values.push(knownValues[col.name]);
    } else if (col.notnull && col.dflt_value == null) {
      insertCols.push(col.name);
      values.push('');
    }
  }
  const placeholders = insertCols.map(() => '?').join(',');
  await env.DB.prepare(
    `INSERT INTO api_sources (${insertCols.join(',')}) VALUES (${placeholders})`
  ).bind(...values).run();
}

// ────────────────────────────────────────────────────────────────
// Retry / dedupe / save
// ────────────────────────────────────────────────────────────────

// Retrying is only worth it for transient failures (network blips, HTTP
// 5xx). A 402 (payment required) or 429 (rate limited) will not succeed on
// immediate retry — retrying it just burns 2-3x the subrequest budget for
// zero benefit, which is exactly what was starving other providers.
function isRetryable(err) {
  const match = err && typeof err.message === 'string' && err.message.match(/^HTTP (\d{3})/);
  if (match) return parseInt(match[1], 10) >= 500;
  return true; // network errors / timeouts are worth one retry
}

async function withRetry(fn, retries) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) break;
    }
  }
  throw lastErr;
}

// Groups repeated identical failures (e.g. the same HTTP 402/429 firing for
// every one of the 13 search keywords) into a single counted line instead
// of 13 near-identical rows. This is what was crowding out every other
// provider's diagnostic info in the dashboard — one noisy provider could
// fill the entire error list before a quieter provider's real error ever
// got a turn.
function createErrorLog() {
  const counts = new Map();
  return {
    add(provider, message, sample) {
      const key = `${provider}::${message}`;
      const entry = counts.get(key) || { count: 0, sample };
      entry.count++;
      counts.set(key, entry);
    },
    toArray(limit = 30) {
      return Array.from(counts.entries())
        .slice(0, limit)
        .map(([key, entry]) => {
          const [provider, message] = key.split('::');
          const sampleTxt = entry.sample ? ` (e.g. "${entry.sample}")` : '';
          return entry.count > 1
            ? `[${provider}] ${message}${sampleTxt} — ×${entry.count}`
            : `[${provider}] ${message}${sampleTxt}`;
        });
    },
  };
}

// Dedup key is the unique `url` column. Saving now happens in two phases
// per batch chunk instead of a single INSERT OR IGNORE:
//   Phase 1 — INSERT OR IGNORE the jobs that are genuinely new. changes>0
//   here is the ONLY source of the "inserted" counter, kept precise.
//   Phase 2 — UPDATE every job in the chunk that phase 1 did NOT insert
//   (i.e. it already existed) — refreshes mutable fields and, critically,
//   bumps updated_at/expires_at and revives status back to 'active'. This
//   is what makes the 30-day-stale cleanup job trustworthy: a job that's
//   still being returned by its source keeps its clock reset on every
//   sync, so only jobs the source has genuinely stopped sending age out.
//
// Both phases still use env.DB.batch() (one subrequest per chunk per
// phase, regardless of chunk size) — Cloudflare Workers caps the total
// number of subrequests per invocation, and one D1 call per individual
// job would blow through that budget long before a provider finished.
// D1's real per-QUERY limit is ~100 bound parameters in a single
// statement — this batch size is about the NUMBER OF STATEMENTS sent
// together in one env.DB.batch() call (each with its own small, fixed
// param count, ~15), which is a completely different constraint. Cloudflare
// counts one env.DB.batch() round-trip as ONE subrequest regardless of how
// many statements are inside it — so a LARGER batch size directly means
// FEWER subrequests per sync run. This was raised from 25 → 100 after a
// production incident where several active sources in one sync run
// collectively exceeded Cloudflare's "too many subrequests by a single
// Worker invocation" ceiling (see SUBREQUEST_BUDGET below for the other
// half of that fix).
const DB_BATCH_SIZE = 100;

async function saveJobs(env, jobs, counters, errorLog, providerId) {
  const validJobs = (jobs || []).filter((j) => j && j.url);
  counters.skipped += (jobs || []).length - validJobs.length;
  let batchesUsed = 0; // returned so the caller's subrequest budget stays accurate

  for (let i = 0; i < validJobs.length; i += DB_BATCH_SIZE) {
    const chunk = validJobs.slice(i, i + DB_BATCH_SIZE);

    const insertStmts = chunk.map((j) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,status,updated_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP,datetime('now','+45 days'))`
      ).bind(
        j.title || 'Unknown', j.company || 'Company', j.location || '', j.url,
        j.description || '', j.salary || '', j.remote_type || '',
        JSON.stringify(j.skills || []), j.seniority || '', j.employment_type || '', j.job_handle || '',
        providerId
      )
    );

    const insertedUrls = new Set();
    try {
      const results = await env.DB.batch(insertStmts);
      batchesUsed++;
      results.forEach((r, idx) => {
        if (r.meta?.changes > 0) { counters.inserted++; insertedUrls.add(chunk[idx].url); }
      });
    } catch (e) {
      errorLog.add(providerId, `DB insert: ${e.message.slice(0, 60)}`);
      continue; // phase 1 itself failed for this chunk — skip phase 2 too
    }

    const toUpdate = chunk.filter((j) => !insertedUrls.has(j.url));
    if (toUpdate.length) {
      const updateStmts = toUpdate.map((j) =>
        env.DB.prepare(
          `UPDATE jobs SET title=?,company=?,location=?,description=?,salary=?,remote_type=?,skills=?,seniority=?,employment_type=?,job_handle=?,source=?,status='active',updated_at=CURRENT_TIMESTAMP,expires_at=datetime('now','+45 days') WHERE url=?`
        ).bind(
          j.title || 'Unknown', j.company || 'Company', j.location || '',
          j.description || '', j.salary || '', j.remote_type || '',
          JSON.stringify(j.skills || []), j.seniority || '', j.employment_type || '', j.job_handle || '',
          providerId, j.url
        )
      );
      try {
        const results = await env.DB.batch(updateStmts);
        batchesUsed++;
        results.forEach((r) => { if (r.meta?.changes > 0) counters.updated++; });
      } catch (e) {
        errorLog.add(providerId, `DB update: ${e.message.slice(0, 60)}`);
      }
    }
  }
  return batchesUsed;
}

// ────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────

export async function syncJobs(env) {
  await ensureTable(env);
  const sources = await getActiveSources(env);
  // Run cheap, single-request providers (every provider currently
  // registered is ignoresQuery=true) before any future keyword-search
  // provider. Otherwise a provider that needs one subrequest could get
  // starved of budget by providers ahead of it that need 13+ each.
  sources.sort((a, b) => {
    const aCheap = PROVIDERS[a.provider]?.ignoresQuery ? 0 : 1;
    const bCheap = PROVIDERS[b.provider]?.ignoresQuery ? 0 : 1;
    return aCheap - bCheap;
  });
  const counters = { inserted: 0, updated: 0, skipped: 0 };
  const errorLog = createErrorLog();
  const providerStats = [];

  if (!sources.length) {
    const result = { inserted: 0, updated: 0, skipped: 0, errors: ['No job sources configured — add one under Admin → API Sources'] };
    await logSync(env, result);
    return result;
  }

  // See "WARM-UP GOVERNOR" note above — this is the one place the cap is
  // actually applied, right before jobs from a provider get saved.
  const governor = await getSyncGovernorConfig(env);
  const totalJobsBefore = await getTotalJobsCount(env);
  const warmupActive = totalJobsBefore < governor.warmupThreshold;
  const perRunCap = warmupActive ? governor.warmupCapPerProvider : governor.hardCapPerProvider;
  subrequestsUsed = 0; // reset per invocation — this module can be reused across a warm isolate

  for (const source of sources) {
    const provider = PROVIDERS[source.provider];
    if (!provider) { errorLog.add(source.provider, 'Unknown provider'); continue; }

    // SUBREQUEST BUDGET CHECK — stop picking up new sources once this
    // provider's estimated cost would risk exceeding Cloudflare's
    // per-invocation subrequest ceiling. The remaining sources are simply
    // deferred to the next cron run rather than causing a hard platform
    // abort mid-write.
    const estimatedCost = estimateSubrequests(perRunCap);
    if (subrequestsUsed + estimatedCost > SUBREQUEST_SAFETY_CEILING) {
      errorLog.add(source.provider, `Deferred to next run — this sync already used its safe subrequest budget (${subrequestsUsed}/${SUBREQUEST_SAFETY_CEILING})`, undefined);
      continue;
    }

    const startedAt = Date.now();
    const startInserted = counters.inserted;
    // Keyless/per-company providers don't support keyword search — call
    // once per sync instead of once per keyword.
    const runQueries = provider.ignoresQuery ? [null] : QUERIES;
    let providerBroken = false;
    let remainingCap = perRunCap;

    for (const q of runQueries) {
      if (providerBroken) break; // first failure already indicates an account/quota-level issue — trying the other 12 keywords would just waste subrequest budget other providers need
      if (remainingCap <= 0) break; // this provider has already hit its per-run cap
      try {
        let jobs = await withRetry(
          () => provider.fetchJobs({ apiKey: source.api_key, query: q, timeoutMs: TIMEOUT_MS }),
          RETRIES
        );
        subrequestsUsed += 1; // the fetch itself
        if (jobs.length > remainingCap) {
          jobs = jobs.slice(0, remainingCap);
          errorLog.add(source.provider, `Capped at ${perRunCap} jobs this run${warmupActive ? ' (warm-up mode)' : ''} — the rest will sync on a later run`, undefined);
        }
        const batchesUsed = await saveJobs(env, jobs, counters, errorLog, source.provider);
        subrequestsUsed += batchesUsed;
        remainingCap -= jobs.length;
      } catch (e) {
        errorLog.add(source.provider, e.message, q || undefined);
        providerBroken = true;
      }
      if (runQueries.length > 1) await sleep(DELAY_BETWEEN_QUERIES_MS);
    }

    providerStats.push({
      provider: source.provider,
      label: source.label,
      inserted: counters.inserted - startInserted,
      duration_ms: Date.now() - startedAt,
    });
  }

  const result = {
    inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped,
    errors: errorLog.toArray(), providerStats, warmupActive, perRunCap,
  };
  await logSync(env, result);
  return result;
}
