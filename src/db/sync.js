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
import { parseSalary, extractSalaryFromDescription } from '../lib/salary.js';
import { extractSkillsFromText } from '../lib/skill-extraction.js';

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
// fetch PER underlying identifier + up to 2 D1 batch() calls (insert +
// update) per DB_BATCH_SIZE chunk of its capped job count.
//
// "1 fetch" is only accurate for providers where api_key holds a single
// company/tenant. Greenhouse (and any future provider following the same
// pattern) supports comma-separated MULTIPLE board tokens in one source
// row, fanning out to one real HTTP request per token internally (see
// providers/greenhouse.js) — undercounting that here is exactly what let
// a single 20-company Greenhouse source blow the budget silently. Counting
// identifiers generically (split on comma) costs nothing for every other
// provider, which always has exactly one identifier per source anyway.
function estimateSubrequests(capForThisProvider, apiKey) {
  const identifierCount = Math.max(1, String(apiKey || '').split(',').map(s => s.trim()).filter(Boolean).length);
  const chunks = Math.ceil(capForThisProvider / DB_BATCH_SIZE);
  // Worst-case budget includes the initial fetch plus every retry. This is
  // intentionally conservative: a transiently failing source must not
  // consume headroom reserved for later sources in the same invocation.
  return identifierCount * (RETRIES + 1) + chunks * 2;
}

// ────────────────────────────────────────────────────────────────
// Sources (api_sources table)
// ────────────────────────────────────────────────────────────────

export async function getActiveSources(env, { onlyProvider = null } = {}) {
  const sources = [];
  try {
    const { results } = await env.DB.prepare(`SELECT id, label, api_key, provider FROM api_sources WHERE active = 1`).all();
    (results || []).forEach(r => {
      if (r.api_key && r.provider && (!onlyProvider || r.provider === onlyProvider)) sources.push({ id: r.id, label: r.label, api_key: r.api_key, provider: r.provider });
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
// PER-PROVIDER CONCURRENCY LOCK (plan §14) — the scheduled cron and a
// manual "Sync Now" click (see routes/api.router.js) are two separate
// Worker invocations that can genuinely overlap in time. Without a lock,
// both could fetch + write the same provider's boards concurrently:
// wasted subrequest budget (two full fetches of the same data), noisy
// interleaved sync_logs, and — since two invocations mean two separate
// in-memory `counters` objects — misleading per-run stats even though
// jobs.url's UNIQUE constraint keeps the DATA itself safe either way.
//
// Reuses the existing `site_settings` key-value table (see
// lib/settings.js) rather than a new table — these keys are internal
// system state, never rendered in the Settings UI, so they're written
// directly here rather than through setSettings()'s SETTINGS_KEYS
// allow-list (which exists specifically to keep admin-facing settings
// separate from things like this).
const LOCK_STALE_MS = 5 * 60 * 1000; // a lock older than this is treated as abandoned (crashed invocation) rather than genuinely in-progress

async function acquireProviderLock(env, providerId) {
  const key = `_sync_lock_${providerId}`;
  try {
    // The freshness check and claim must be one SQLite operation. A separate
    // SELECT followed by an UPSERT lets two cron/manual invocations both see
    // an old lock and then both claim it before either write is committed.
    const now = Date.now();
    const staleBefore = String(now - LOCK_STALE_MS);
    const result = await env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
       WHERE CAST(site_settings.value AS INTEGER) < ?`
    ).bind(key, String(now), staleBefore).run();
    return (result.meta?.changes || 0) > 0;
  } catch (e) {
    return true; // fail OPEN — a broken lock table must never permanently block syncing
  }
}

async function releaseProviderLock(env, providerId) {
  try { await env.DB.prepare(`DELETE FROM site_settings WHERE key = ?`).bind(`_sync_lock_${providerId}`).run(); } catch (e) {}
}

// ────────────────────────────────────────────────────────────────
// Per-source health persistence (plan §3) — called once per source after
// EVERY attempt, success or failure, so api_sources always reflects real,
// current status instead of it having to be re-derived from the latest
// sync_logs row on every dashboard render.
// ────────────────────────────────────────────────────────────────
async function recordSourceOutcome(env, sourceId, { success, errorType, errorMessage }) {
  try {
    if (success) {
      await env.DB.prepare(
        `UPDATE api_sources SET last_synced_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP, last_error = NULL, last_error_type = NULL, consecutive_failures = 0 WHERE id = ?`
      ).bind(sourceId).run();
    } else {
      await env.DB.prepare(
        `UPDATE api_sources SET last_synced_at = CURRENT_TIMESTAMP, last_error = ?, last_error_type = ?, consecutive_failures = consecutive_failures + 1 WHERE id = ?`
      ).bind((errorMessage || '').slice(0, 300), errorType || 'UNKNOWN', sourceId).run();
    }
  } catch (e) { /* health bookkeeping must never fail the actual sync */ }
}

// ────────────────────────────────────────────────────────────────
// Retry / dedupe / save
// ────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────
// Error classification (plan §5) — every provider's fetchJobs() throws a
// plain Error with a message like "HTTP 429" or a native network/abort
// exception; this turns that into a stable, machine-readable category
// used for (a) deciding retry behavior below, (b) the human-readable
// label persisted to api_sources.last_error_type, and (c) clearer sync
// log lines than a bare "HTTP 429" ever was.
// ────────────────────────────────────────────────────────────────
function classifyError(err) {
  const msg = err && typeof err.message === 'string' ? err.message : String(err || 'Unknown error');
  const httpMatch = msg.match(/^HTTP (\d{3})/);
  if (httpMatch) {
    const code = parseInt(httpMatch[1], 10);
    if (code === 429) return { type: 'RATE_LIMITED', retryable: true, label: 'Rate limited (429)' };
    if (code === 401) return { type: 'UNAUTHORIZED', retryable: false, label: 'Unauthorized (401)' };
    if (code === 403) return { type: 'FORBIDDEN', retryable: false, label: 'Forbidden (403)' };
    if (code === 404) return { type: 'NOT_FOUND', retryable: false, label: 'Not found (404) — check the company identifier' };
    if (code === 400) return { type: 'BAD_REQUEST', retryable: false, label: 'Bad request (400)' };
    if (code >= 500) return { type: 'SERVER_ERROR', retryable: true, label: `Provider server error (${code})` };
    return { type: 'HTTP_ERROR', retryable: false, label: `HTTP ${code}` };
  }
  if (err && err.name === 'AbortError') return { type: 'TIMEOUT', retryable: true, label: 'Request timed out' };
  if (msg.includes('Unexpected token') || msg.includes('JSON')) return { type: 'INVALID_RESPONSE', retryable: false, label: 'Invalid/unparseable response' };
  if (msg.startsWith('DB ')) return { type: 'DATABASE_ERROR', retryable: false, label: msg };
  // Native fetch() network failures (DNS, connection reset, TLS, etc.)
  // don't carry a structured code — treated as retryable, same as before.
  return { type: 'NETWORK_ERROR', retryable: true, label: msg.slice(0, 100) };
}

// Retrying is only worth it for transient failures: network blips,
// timeouts, HTTP 5xx, and now HTTP 429 (plan §7 — rate limits ARE worth
// retrying, just not immediately). A 401/403/404/400 or invalid job data
// will not succeed on immediate retry — retrying those just burns 2-3x
// the subrequest budget for zero benefit, which is exactly what was
// starving other providers before this classification existed.
function isRetryable(err) {
  return classifyError(err).retryable;
}

// BACKOFF (plan §6/§7): previously every retry fired immediately with no
// delay at all, which for a 5xx is marginal and for a 429 specifically is
// close to useless — hitting the same rate limit again a few
// milliseconds later. Exponential backoff (500ms, then 1500ms) gives a
// rate-limited provider a real chance to recover between attempts while
// staying well inside a single Worker invocation's execution time
// budget even in the worst case (2 providers × 2 retries × ~2s ≈ a few
// seconds total, not minutes). Reuses the same `sleep` helper defined
// near the top of this file for DELAY_BETWEEN_QUERIES_MS.
const RETRY_BACKOFF_MS = [500, 1500];

async function withRetry(fn, retries) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) break;
      if (attempt < retries) await sleep(RETRY_BACKOFF_MS[attempt] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
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

// ROOT-CAUSE FIX for empty salary/skills on job cards (see the header
// comments in lib/salary.js's extractSalaryFromDescription() and
// lib/skill-extraction.js's extractSkillsFromText() for the full
// explanation): 8 of 9 ATS providers never return a structured salary or
// skills field at all — src/providers/*.js hardcodes `salary: ''` and
// `skills: []` because the raw API genuinely has nothing there. This
// mines the SAME free-text description every provider already fetches,
// as a fallback ONLY when the provider itself didn't supply the field —
// a provider that DOES give real structured data (e.g. Recruitee's
// `tags` for skills) is never overridden by a guess.
function enrichJobFromDescription(j) {
  if (j.salary && j.skills && j.skills.length) return j; // provider already gave us both — nothing to mine
  const enriched = { ...j };
  if (!enriched.salary) {
    const extracted = extractSalaryFromDescription(enriched.description);
    if (extracted) enriched.salary = extracted;
  }
  if (!enriched.skills || !enriched.skills.length) {
    const extractedSkills = extractSkillsFromText(enriched.description);
    if (extractedSkills.length) enriched.skills = extractedSkills;
  }
  return enriched;
}

async function saveJobs(env, jobs, counters, errorLog, providerId) {
  const validJobs = (jobs || []).filter((j) => j && j.url).map(enrichJobFromDescription);
  const skippedCount = (jobs || []).length - validJobs.length;
  counters.skipped += skippedCount;
  let batchesUsed = 0; // returned so the caller's subrequest budget stays accurate
  // Per-call breakdown (plan §4: Jobs Fetched/Added/Updated/Skipped per
  // PROVIDER, not just globally across the whole run) — `counters` above
  // stays as the run-wide total every existing caller already relies on;
  // this is purely additive, returned alongside batchesUsed so
  // syncJobs()'s providerStats entries can be accurate per-source.
  const own = { fetched: (jobs || []).length, inserted: 0, updated: 0, skipped: skippedCount, failed: 0 };

  for (let i = 0; i < validJobs.length; i += DB_BATCH_SIZE) {
    const chunk = validJobs.slice(i, i + DB_BATCH_SIZE);

    const insertStmts = chunk.map((j) => {
      const sal = parseSalary(j.salary);
      return env.DB.prepare(
        `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,status,updated_at,expires_at,salary_min_usd,salary_max_usd)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP,datetime('now','+45 days'),?,?)`
      ).bind(
        j.title || 'Unknown', j.company || 'Company', j.location || '', j.url,
        j.description || '', j.salary || '', j.remote_type || '',
        JSON.stringify(j.skills || []), j.seniority || '', j.employment_type || '', j.job_handle || '',
        providerId, sal.annualMinUsd, sal.annualMaxUsd
      );
    });

    const insertedUrls = new Set();
    try {
      const results = await env.DB.batch(insertStmts);
      batchesUsed++;
      results.forEach((r, idx) => {
        if (r.meta?.changes > 0) { counters.inserted++; own.inserted++; insertedUrls.add(chunk[idx].url); }
      });
    } catch (e) {
      errorLog.add(providerId, `DB insert: ${e.message.slice(0, 60)}`);
      own.failed += chunk.length;
      continue; // phase 1 itself failed for this chunk — skip phase 2 too
    }

    const toUpdate = chunk.filter((j) => !insertedUrls.has(j.url));
    if (toUpdate.length) {
      const updateStmts = toUpdate.map((j) => {
        const sal = parseSalary(j.salary);
        return env.DB.prepare(
          `UPDATE jobs SET title=?,company=?,location=?,description=?,salary=?,remote_type=?,skills=?,seniority=?,employment_type=?,job_handle=?,source=?,status='active',updated_at=CURRENT_TIMESTAMP,expires_at=datetime('now','+45 days'),salary_min_usd=?,salary_max_usd=? WHERE url=?`
        ).bind(
          j.title || 'Unknown', j.company || 'Company', j.location || '',
          j.description || '', j.salary || '', j.remote_type || '',
          JSON.stringify(j.skills || []), j.seniority || '', j.employment_type || '', j.job_handle || '',
          providerId, sal.annualMinUsd, sal.annualMaxUsd, j.url
        );
      });
      try {
        const results = await env.DB.batch(updateStmts);
        batchesUsed++;
        results.forEach((r) => { if (r.meta?.changes > 0) { counters.updated++; own.updated++; } });
      } catch (e) {
        errorLog.add(providerId, `DB update: ${e.message.slice(0, 60)}`);
        own.failed += toUpdate.length;
      }
    }
  }
  return { batchesUsed, ...own };
}

// ROTATING WINDOW CAP — the fix for a real bug: capping via a fixed
// `jobs.slice(0, cap)` always keeps the SAME first N jobs every run,
// because providers return jobs in a stable order. Once those first N are
// already saved, every later run re-fetches and re-slices the exact same
// N — genuinely new postings sitting anywhere past position N in the
// list are never reached, ever. This makes the cap window rotate over
// time (same hour-based technique as providers/greenhouse.js's board
// rotation) so every job in a large result eventually gets its turn to be
// saved across a handful of runs, instead of a permanent stall at "+0".
function rotatingCapSlice(jobs, cap) {
  if (jobs.length <= cap) return jobs;
  const hourSlot = Math.floor(Date.now() / (1000 * 60 * 60));
  const start = (hourSlot * cap) % jobs.length;
  const end = start + cap;
  return end <= jobs.length ? jobs.slice(start, end) : jobs.slice(start).concat(jobs.slice(0, end - jobs.length));
}

// ────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────

export async function syncJobs(env, { onlyProvider = null } = {}) {
  await ensureTable(env);
  const sources = await getActiveSources(env, { onlyProvider });
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
    const result = {
      inserted: 0, updated: 0, skipped: 0,
      errors: [onlyProvider ? `No active sources found for provider "${onlyProvider}"` : 'No job sources configured — add one under Admin → API Sources'],
    };
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

  // Providers actually attempted this run vs skipped for still holding a
  // lock — locks are acquired/released per PROVIDER ID (not per source
  // row), since multiple sources of the same provider are already
  // processed sequentially within one JS loop iteration and can never
  // race each other; the real race is this whole invocation vs a
  // DIFFERENT overlapping invocation reaching the same provider.
  const lockedProviders = new Set();

  for (const source of sources) {
    const provider = PROVIDERS[source.provider];
    if (!provider) { errorLog.add(source.provider, 'Unknown provider'); continue; }

    if (!lockedProviders.has(source.provider)) {
      const acquired = await acquireProviderLock(env, source.provider);
      subrequestsUsed += 2; // SELECT + write — conservative, see estimateSubrequests' philosophy above
      if (!acquired) {
        errorLog.add(source.provider, 'Skipped — already syncing in another run (concurrent sync prevented)', undefined);
        continue;
      }
      lockedProviders.add(source.provider);
    }

    // SUBREQUEST BUDGET CHECK — stop picking up new sources once this
    // provider's estimated cost would risk exceeding Cloudflare's
    // per-invocation subrequest ceiling. The remaining sources are simply
    // deferred to the next cron run rather than causing a hard platform
    // abort mid-write.
    const identifierCount = Math.max(1, String(source.api_key || '').split(',').map(s => s.trim()).filter(Boolean).length);
    const estimatedCost = estimateSubrequests(perRunCap, source.api_key);
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
    let sourceErr = null; // last error for THIS source, used for recordSourceOutcome below
    const own = { fetched: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };

    for (const q of runQueries) {
      if (providerBroken) break; // first failure already indicates an account/quota-level issue — trying the other 12 keywords would just waste subrequest budget other providers need
      if (remainingCap <= 0) break; // this provider has already hit its per-run cap
      try {
        let jobs = await withRetry(
          async () => {
            // Count every attempt, including failed retries, against the
            // invocation budget. The previous accounting only incremented
            // after a successful fetch, so repeated timeouts/429s could make
            // the governor believe there was more headroom than Cloudflare
            // actually had.
            subrequestsUsed += identifierCount;
            return provider.fetchJobs({ apiKey: source.api_key, query: q, timeoutMs: TIMEOUT_MS });
          },
          RETRIES
        );
        if (jobs.length > remainingCap) {
          const total = jobs.length;
          jobs = rotatingCapSlice(jobs, remainingCap);
          errorLog.add(source.provider, `Capped at ${perRunCap} of ${total} jobs this run (rotating window)${warmupActive ? ' (warm-up mode)' : ''} — the rest will sync on a later run`, undefined);
        }
        const saved = await saveJobs(env, jobs, counters, errorLog, source.provider);
        subrequestsUsed += saved.batchesUsed;
        remainingCap -= jobs.length;
        own.fetched += saved.fetched; own.inserted += saved.inserted; own.updated += saved.updated; own.skipped += saved.skipped; own.failed += saved.failed;
      } catch (e) {
        const cls = classifyError(e);
        errorLog.add(source.provider, `${cls.label}${cls.type === 'HTTP_ERROR' || cls.type === 'NETWORK_ERROR' ? '' : ` (${cls.type})`}`, q || undefined);
        sourceErr = { type: cls.type, message: e.message || String(e) };
        providerBroken = true;
      }
      if (runQueries.length > 1) await sleep(DELAY_BETWEEN_QUERIES_MS);
    }

    if (source.id) {
      await recordSourceOutcome(env, source.id, sourceErr
        ? { success: false, errorType: sourceErr.type, errorMessage: sourceErr.message }
        : { success: true });
    }

    providerStats.push({
      provider: source.provider,
      label: source.label,
      inserted: counters.inserted - startInserted,
      fetched: own.fetched, updated: own.updated, skipped: own.skipped, failed: own.failed,
      duration_ms: Date.now() - startedAt,
    });
  }

  for (const providerId of lockedProviders) await releaseProviderLock(env, providerId);

  const result = {
    inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped,
    errors: errorLog.toArray(), providerStats, warmupActive, perRunCap,
  };
  await logSync(env, result);
  return result;
}

// ────────────────────────────────────────────────────────────────
// Salary backfill — existing jobs (synced before salary_min_usd/
// salary_max_usd existed) have those columns NULL until their provider
// naturally re-syncs them. Rather than wait an unpredictable amount of
// time for that to happen organically, this lets an admin trigger it
// directly (see the "Backfill Salary Data" button on /admin/jobs).
//
// Bounded to `batchSize` rows per call — same philosophy as everything
// else in this file: never try to process an unbounded amount of work in
// one Worker invocation. An admin clicks the button repeatedly (or it can
// be wired to auto-continue client-side) until `remaining` reaches 0.
// ────────────────────────────────────────────────────────────────
export async function backfillSalaryUsd(env, { batchSize = 300 } = {}) {
  await ensureTable(env);
  const { results: rows } = await env.DB.prepare(
    `SELECT id, salary FROM jobs WHERE salary IS NOT NULL AND salary != '' AND salary_min_usd IS NULL LIMIT ?`
  ).bind(batchSize).all();

  let processed = 0;
  if (rows && rows.length) {
    const stmts = rows.map((r) => {
      const sal = parseSalary(r.salary);
      // Jobs whose salary text genuinely can't be parsed (e.g.
      // "Competitive") get salary_min_usd = -1 as a sentinel — NOT NULL,
      // so this same backfill query never picks them up again on the next
      // batch, without falsely claiming they have a real numeric salary.
      const min = sal.annualMinUsd ?? -1;
      const max = sal.annualMaxUsd ?? -1;
      return env.DB.prepare('UPDATE jobs SET salary_min_usd = ?, salary_max_usd = ? WHERE id = ?').bind(min, max, r.id);
    });
    await env.DB.batch(stmts);
    processed = rows.length;
  }

  const { results: remainingRows } = await env.DB.prepare(
    `SELECT COUNT(*) c FROM jobs WHERE salary IS NOT NULL AND salary != '' AND salary_min_usd IS NULL`
  ).all();
  return { processed, remaining: remainingRows?.[0]?.c || 0 };
}
