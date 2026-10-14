// src/db/sync.js
// Thin orchestrator ONLY. It does not know how to talk to any specific
// job-board API — that logic lives entirely in src/providers/*.js. This
// file's job is: read active sources -> pick the right provider module ->
// call it -> dedupe -> save -> log. Adding a new provider never requires
// touching this file (see src/providers/index.js).

import { ensureTable } from './schema.js';
import { logSync } from './telemetry.js';
import { PROVIDERS } from '../providers/index.js';
import { getSettings } from '../lib/platform/settings.js';
import { parseSalary, extractSalaryFromDescription } from '../lib/jobs/salary.js';
import { classifySalaryFromParsed, salaryClassificationForJob } from '../lib/jobs/salary-tier.js';
import { extractSkillsFromText } from '../lib/jobs/skill-extraction.js';
import { cappedCount } from '../lib/platform/job-window.js';
import { syncSlot, pickRotatingWindow } from '../lib/platform/rotation.js';
import { WRITE_COST, parseDailyBudget, runAllowance, loadSyncState, saveSyncState } from '../lib/platform/write-budget.js';

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

// ROW-READ BUDGET: the warm-up governor only needs to know whether the catalogue
// has reached `cap` jobs — never the exact total. The count stops at `cap` rows
// (default 150) instead of scanning every job on each sync.
async function getTotalJobsCount(env, cap) {
  try {
    return await cappedCount(env, 'jobs', '', [], Math.max(1, cap || 150));
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
// Free-plan ceiling is 50; overridable (env.SYNC_SUBREQUEST_CEILING) for the
// paid plan, where Cloudflare allows 1000 and a run can cover far more sources.
const DEFAULT_SUBREQUEST_CEILING = 40;
// Calls every run makes AFTER the source loop: one batched health write, one
// state write, one sync log and one batched lock release.
const TAIL_SUBREQUESTS = 5;

function subrequestCeiling(env) {
  const n = parseInt(env && env.SYNC_SUBREQUEST_CEILING, 10);
  return Number.isFinite(n) ? Math.min(900, Math.max(20, n)) : DEFAULT_SUBREQUEST_CEILING;
}

// Conservative estimate of the subrequests one source can use: one fetch per
// identifier (retries included) + two D1 calls (read existing + write) per
// SELECT_CHUNK chunk of its capped job count.
//
// A provider that fans out over many identifiers in one source row but only
// fetches a rotating subset per run (Greenhouse: MAX_BOARDS_PER_RUN) must be
// costed by that subset. Costing ALL identifiers made a 20-board source look
// like 60+ subrequests, so it was "deferred" on every single run and never synced.
function estimateSubrequests(capForThisProvider, apiKey, provider) {
  const listed = Math.max(1, String(apiKey || '').split(',').map(s => s.trim()).filter(Boolean).length);
  const perRun = Number(provider && provider.MAX_BOARDS_PER_RUN) || Infinity;
  const identifierCount = Math.min(listed, perRun);
  const chunks = Math.ceil(capForThisProvider / SELECT_CHUNK);
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
// lib/platform/settings.js) rather than a new table — these keys are internal
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

async function releaseProviderLocks(env, providerIds) {
  const ids = [...providerIds];
  if (!ids.length) return;
  try {
    await env.DB.batch(ids.map((id) => env.DB.prepare(`DELETE FROM site_settings WHERE key = ?`).bind(`_sync_lock_${id}`)));
  } catch (e) {}
}

// ────────────────────────────────────────────────────────────────
// Per-source health persistence (plan §3) — called once per source after
// EVERY attempt, success or failure, so api_sources always reflects real,
// current status instead of it having to be re-derived from the latest
// sync_logs row on every dashboard render.
// ────────────────────────────────────────────────────────────────
// Builds (does not run) the health UPDATE for one source. syncJobs() collects
// them and flushes ALL of them in a single env.DB.batch() at the end of the run
// — one subrequest instead of one per source.
function sourceOutcomeStatement(env, sourceId, { success, errorType, errorMessage }) {
  if (success) {
    return env.DB.prepare(
      `UPDATE api_sources SET last_synced_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP, last_error = NULL, last_error_type = NULL, consecutive_failures = 0 WHERE id = ?`
    ).bind(sourceId);
  }
  return env.DB.prepare(
    `UPDATE api_sources SET last_synced_at = CURRENT_TIMESTAMP, last_error = ?, last_error_type = ?, consecutive_failures = consecutive_failures + 1 WHERE id = ?`
  ).bind((errorMessage || '').slice(0, 300), errorType || 'UNKNOWN', sourceId);
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

// ────────────────────────────────────────────────────────────────
// SAVE — read-before-write, so unchanged jobs cost ZERO written rows.
//
// The old flow INSERT-OR-IGNOREd every fetched job and then UPDATEd every one
// that already existed, rewriting the full row (description included) and its
// ~14 index entries on EVERY run — roughly 6 written rows per job per sync,
// which is what drained the 100k/day D1 write allowance.
//
// Now, per chunk of ≤ SELECT_CHUNK urls:
//   1. ONE read: url, content_hash, status, "is the lifecycle stale?" (cheap —
//      served by the unique url index, reads are a separate 5M/day allowance).
//   2. Each job is classified:
//        new                      → INSERT           (~15 written rows)
//        changed content          → full UPDATE       (~6)
//        same content, but stale
//          or not 'active'        → TOUCH (dates only) (~4)
//        same content, fresh      → nothing            (0)
//        admin-edited ('manual')  → never overwritten; touch only
//        legacy row (no hash yet) → "adopt": store the hash, touch if stale (~1-4)
//   3. ONE env.DB.batch() carries every write of the chunk.
// The daily write budget (lib/platform/write-budget.js) is charged per applied
// statement; once exhausted, remaining NEW jobs are deferred to a later run (they
// are still new then) instead of overshooting the plan limit.
// ────────────────────────────────────────────────────────────────
const SELECT_CHUNK = 90; // + 1 bound modifier ≤ D1's 100 parameters per statement

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

// Fingerprint of every field the sync writes from a provider. Two independent
// 32-bit FNV-1a passes + length make an accidental collision (a changed job
// silently skipped) vanishingly unlikely for this use.
export function jobContentHash(j) {
  const payload = [j.title, j.company, j.location, j.description, j.salary, j.remote_type,
    JSON.stringify(j.skills || []), j.seniority, j.employment_type, j.job_handle]
    .map((v) => String(v ?? '')).join('\u241f');
  return fnv1a(payload, 2166136261).toString(16).padStart(8, '0')
    + fnv1a(payload, 0x9747b28c).toString(16).padStart(8, '0')
    + payload.length.toString(36);
}

// ROOT-CAUSE FIX for empty salary/skills on job cards (see lib/jobs/salary.js's
// extractSalaryFromDescription() and lib/jobs/skill-extraction.js): most ATS
// providers never return structured salary/skills, so they are mined from the
// description as a fallback ONLY when the provider did not supply the field.
function enrichJobFromDescription(j) {
  if (j.salary && j.skills && j.skills.length) return j;
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

const LIFECYCLE_SQL = `status='active',updated_at=CURRENT_TIMESTAMP,expires_at=datetime('now','+45 days')`;

// budget = { remaining } — estimated written rows this run may still spend.
export async function saveJobs(env, jobs, counters, errorLog, providerId, settings = {}, budget = { remaining: Infinity }) {
  const seenUrls = new Set();
  const validJobs = [];
  for (const raw of (jobs || [])) {
    if (!raw || !raw.url || seenUrls.has(raw.url)) continue;
    seenUrls.add(raw.url);
    validJobs.push(enrichJobFromDescription(raw));
  }
  const skippedCount = (jobs || []).length - validJobs.length;
  counters.skipped += skippedCount;
  let batchesUsed = 0;
  const own = { fetched: (jobs || []).length, inserted: 0, updated: 0, touched: 0, unchanged: 0, deferred: 0, skipped: skippedCount, failed: 0 };
  const touchDays = Math.min(25, Math.max(3, parseInt(settings.sync_touch_interval_days, 10) || 10));
  const staleModifier = `-${touchDays} day`;

  for (let i = 0; i < validJobs.length; i += SELECT_CHUNK) {
    const chunk = validJobs.slice(i, i + SELECT_CHUNK);

    // ── 1. read what already exists ──
    let existing = new Map();
    try {
      const placeholders = chunk.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT url, content_hash, status,
                CASE WHEN updated_at IS NULL OR updated_at < datetime('now', ?) THEN 1 ELSE 0 END AS stale
           FROM jobs WHERE url IN (${placeholders})`
      ).bind(staleModifier, ...chunk.map((j) => j.url)).all();
      batchesUsed++;
      existing = new Map((results || []).map((r) => [r.url, r]));
    } catch (e) {
      batchesUsed++;
      errorLog.add(providerId, `DB read: ${String(e.message || e).slice(0, 60)}`);
      own.failed += chunk.length;
      continue;
    }

    // ── 2. classify ──
    const stmts = [];
    const kinds = [];
    for (const j of chunk) {
      const hash = jobContentHash(j);
      const row = existing.get(j.url);
      const sal = parseSalary(j.salary);
      const salaryTier = classifySalaryFromParsed(sal, settings);

      if (!row) {
        if (budget.remaining < WRITE_COST.insert) { own.deferred++; continue; }
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO jobs (title,company,location,url,description,salary,remote_type,skills,seniority,employment_type,job_handle,source,status,updated_at,expires_at,salary_min_usd,salary_max_usd,salary_tier,salary_tier_confidence,content_hash)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP,datetime('now','+45 days'),?,?,?,?,?)`
        ).bind(
          j.title || 'Unknown', j.company || 'Company', j.location || '', j.url,
          j.description || '', j.salary || '', j.remote_type || '',
          JSON.stringify(j.skills || []), j.seniority || '', j.employment_type || '', j.job_handle || '',
          providerId, sal.annualMinUsd, sal.annualMaxUsd, salaryTier.tier, salaryTier.confidence, hash
        ));
        kinds.push('insert');
        budget.remaining -= WRITE_COST.insert; // refunded below if the row turns out to exist
        continue;
      }

      const needsLifecycle = row.status !== 'active' || Number(row.stale) === 1;
      const manual = row.content_hash === 'manual';
      const legacy = !row.content_hash;
      const same = row.content_hash === hash;

      if (manual || same || legacy) {
        if (!needsLifecycle && !legacy) { own.unchanged++; continue; }
        const cost = legacy ? (needsLifecycle ? WRITE_COST.touch : 1) : WRITE_COST.touch;
        if (budget.remaining < cost) { own.deferred++; continue; }
        if (legacy) {
          stmts.push(env.DB.prepare(
            needsLifecycle
              ? `UPDATE jobs SET content_hash=?,${LIFECYCLE_SQL} WHERE url=? AND content_hash IS NULL`
              : `UPDATE jobs SET content_hash=? WHERE url=? AND content_hash IS NULL`
          ).bind(hash, j.url));
        } else {
          stmts.push(env.DB.prepare(`UPDATE jobs SET ${LIFECYCLE_SQL} WHERE url=?`).bind(j.url));
        }
        kinds.push(legacy && !needsLifecycle ? 'unchanged' : 'touch');
        budget.remaining -= cost;
        continue;
      }

      // content changed at the source → full refresh
      if (budget.remaining < WRITE_COST.update) { own.deferred++; continue; }
      stmts.push(env.DB.prepare(
        `UPDATE jobs SET title=?,company=?,location=?,description=?,salary=?,remote_type=?,skills=?,seniority=?,employment_type=?,job_handle=?,source=?,content_hash=?,${LIFECYCLE_SQL},salary_min_usd=?,salary_max_usd=?,salary_tier=?,salary_tier_confidence=? WHERE url=?`
      ).bind(
        j.title || 'Unknown', j.company || 'Company', j.location || '',
        j.description || '', j.salary || '', j.remote_type || '',
        JSON.stringify(j.skills || []), j.seniority || '', j.employment_type || '', j.job_handle || '',
        providerId, hash, sal.annualMinUsd, sal.annualMaxUsd, salaryTier.tier, salaryTier.confidence, j.url
      ));
      kinds.push('update');
      budget.remaining -= WRITE_COST.update;
    }

    if (!stmts.length) continue;

    // ── 3. one batch for the whole chunk ──
    try {
      const results = await env.DB.batch(stmts);
      batchesUsed++;
      results.forEach((r, idx) => {
        const applied = (r.meta?.changes || 0) > 0;
        const kind = kinds[idx];
        if (kind === 'insert') {
          if (applied) { counters.inserted++; own.inserted++; } else budget.remaining += WRITE_COST.insert;
        } else if (kind === 'update') {
          if (applied) { counters.updated++; own.updated++; } else budget.remaining += WRITE_COST.update;
        } else if (kind === 'touch') {
          if (applied) own.touched++; else budget.remaining += WRITE_COST.touch;
        } else if (kind === 'unchanged') {
          own.unchanged++;
        }
      });
    } catch (e) {
      batchesUsed++;
      errorLog.add(providerId, `DB write: ${String(e.message || e).slice(0, 60)}`);
      own.failed += stmts.length;
    }
  }
  counters.touched = (counters.touched || 0) + own.touched;
  counters.unchanged = (counters.unchanged || 0) + own.unchanged;
  counters.deferred = (counters.deferred || 0) + own.deferred;
  return { batchesUsed, ...own };
}

// ────────────────────────────────────────────────────────────────
// DIVERSITY — when a source returns more jobs than the per-run cap, the old
// code kept a contiguous slice of whatever order the provider used, so one
// company could fill the entire window. Jobs are first interleaved
// round-robin BY COMPANY, then a rotating window (advanced once per 3-hour run,
// see lib/platform/rotation.js) is taken: every run saves a few jobs from
// many companies, and every job still gets its turn across runs.
// ────────────────────────────────────────────────────────────────
export function interleaveByCompany(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = String(job.company || '').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  const lists = [...groups.values()];
  if (lists.length <= 1) return jobs;
  const out = [];
  for (let round = 0; out.length < jobs.length; round++) {
    for (const list of lists) if (round < list.length) out.push(list[round]);
  }
  return out;
}

function capJobs(jobs, cap, slot) {
  if (jobs.length <= cap) return jobs;
  return pickRotatingWindow(interleaveByCompany(jobs), cap, slot);
}

// Sources in a stable order (by id), starting from the persisted cursor, so
// every source gets its turn even when one run's budget only covers a few.
export function orderSourcesFairly(sources, cursor) {
  const sorted = [...sources].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  if (sorted.length <= 1) return sorted;
  const start = ((Number(cursor) || 0) % sorted.length + sorted.length) % sorted.length;
  const rotated = sorted.slice(start).concat(sorted.slice(0, start));
  // keyword-search providers (none registered today) are costlier: stable cheap-first
  const cheap = rotated.filter((s) => PROVIDERS[s.provider]?.ignoresQuery);
  const costly = rotated.filter((s) => !PROVIDERS[s.provider]?.ignoresQuery);
  return cheap.concat(costly);
}


// ────────────────────────────────────────────────────────────────
// SELF-HEAL: the sync depends on jobs.content_hash. That column is created by the
// schema migration (SCHEMA_VERSION gate), which only runs when the version string
// changes. If a deploy ever ships the new sync code WITHOUT the migration having
// run yet, every read would fail with "no such column" and the site would silently
// stop importing jobs (this actually happened once: v2.5.0 forgot to bump the
// version). So the sync verifies the column itself — one cheap probe per isolate —
// and adds it when missing. ALTER TABLE ADD COLUMN is idempotent here (guarded by
// the probe) and never touches existing rows.
// ────────────────────────────────────────────────────────────────
let contentHashColumnReady = false;
export async function ensureContentHashColumn(env) {
  if (contentHashColumnReady) return { ok: true, calls: 0 };
  try {
    await env.DB.prepare('SELECT content_hash FROM jobs LIMIT 1').all();
    contentHashColumnReady = true;
    return { ok: true, calls: 1 };
  } catch (probeError) {
    if (!/no such column|content_hash/i.test(String(probeError && probeError.message))) return { ok: false, calls: 1, error: String(probeError && probeError.message || probeError) };
    try {
      await env.DB.prepare('ALTER TABLE jobs ADD COLUMN content_hash TEXT').run();
      contentHashColumnReady = true;
      return { ok: true, calls: 2, healed: true };
    } catch (alterError) {
      // "duplicate column name" = another run added it first — that is success.
      if (/duplicate column/i.test(String(alterError && alterError.message))) { contentHashColumnReady = true; return { ok: true, calls: 2 }; }
      return { ok: false, calls: 2, error: String(alterError && alterError.message || alterError) };
    }
  }
}
export function resetContentHashColumnProbe() { contentHashColumnReady = false; } // tests only

// ────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────

export async function syncJobs(env, { onlyProvider = null } = {}) {
  await ensureTable(env);
  const columnCheck = await ensureContentHashColumn(env);
  if (!columnCheck.ok) {
    const result = { inserted: 0, updated: 0, skipped: 0, errors: [`[schema] jobs.content_hash is unavailable: ${String(columnCheck.error || '').slice(0, 120)} — run Admin → System → Repair schema`] };
    await logSync(env, result);
    return result;
  }
  const settings = await getSettings(env);
  const allSources = await getActiveSources(env, { onlyProvider });
  const counters = { inserted: 0, updated: 0, skipped: 0 };
  const errorLog = createErrorLog();
  const providerStats = [];

  if (!allSources.length) {
    const result = {
      inserted: 0, updated: 0, skipped: 0,
      errors: [onlyProvider ? `No active sources found for provider "${onlyProvider}"` : 'No job sources configured — add one under Admin → API Sources'],
    };
    await logSync(env, result);
    return result;
  }

  // ── pacing: daily D1 write budget + fair source rotation ──
  const now = Date.now();
  const ceiling = subrequestCeiling(env);
  let subrequestsUsed = 2 + columnCheck.calls; // settings + sync state reads + column probe
  const state = await loadSyncState(env, now);
  const dailyBudget = parseDailyBudget(settings.sync_daily_write_budget);
  const allowance = runAllowance({ dailyBudget, usedToday: state.used, now });
  if (allowance < WRITE_COST.touch) {
    const result = {
      inserted: 0, updated: 0, skipped: 0, touched: 0, unchanged: 0, deferred: 0,
      errors: [`[budget] Daily write budget reached (~${state.used.toLocaleString('en-US')} of ${dailyBudget.toLocaleString('en-US')} rows today) — sync resumes after 00:00 UTC. Raise it under Admin → Settings → Job Sync.`],
      budget: { dailyBudget, usedToday: state.used, allowance },
    };
    await logSync(env, result);
    return result;
  }
  const budget = { remaining: allowance };

  const sources = orderSourcesFairly(allSources, state.cursor);
  const sortedCount = allSources.length;
  const startIdx = sortedCount ? (((Number(state.cursor) || 0) % sortedCount) + sortedCount) % sortedCount : 0;

  // See "WARM-UP GOVERNOR" above — the per-source cap is applied right before saving.
  const governor = await getSyncGovernorConfig(env);
  const totalJobsBefore = await getTotalJobsCount(env, governor.warmupThreshold);
  subrequestsUsed += 1;
  const warmupActive = totalJobsBefore < governor.warmupThreshold;
  const perRunCap = warmupActive ? governor.warmupCapPerProvider : governor.hardCapPerProvider;
  const slot = syncSlot(now);

  const lockedProviders = new Set();
  const outcomeStatements = [];
  let processedSources = 0;

  for (const source of sources) {
    const provider = PROVIDERS[source.provider];
    if (!provider) { errorLog.add(source.provider, 'Unknown provider'); processedSources++; continue; }

    if (!lockedProviders.has(source.provider)) {
      const acquired = await acquireProviderLock(env, source.provider);
      subrequestsUsed += 1;
      if (!acquired) {
        errorLog.add(source.provider, 'Skipped — already syncing in another run (concurrent sync prevented)', undefined);
        processedSources++;
        continue;
      }
      lockedProviders.add(source.provider);
    }

    // SUBREQUEST BUDGET — stop at the first source that no longer fits. It is the
    // FIRST source of the next run (the cursor is not advanced past it), so
    // nothing starves and the order stays fair.
    const identifierCount = Math.max(1, Math.min(
      String(source.api_key || '').split(',').map(s => s.trim()).filter(Boolean).length,
      Number(provider.MAX_BOARDS_PER_RUN) || Infinity
    ));
    const estimatedCost = estimateSubrequests(perRunCap, source.api_key, provider);
    if (subrequestsUsed + estimatedCost > ceiling - TAIL_SUBREQUESTS) {
      errorLog.add(source.provider, `Deferred to next run — this sync already used its safe subrequest budget (${subrequestsUsed}/${ceiling})`, undefined);
      break;
    }
    if (budget.remaining < WRITE_COST.touch) break; // today's write budget is spent for this run

    const startedAt = Date.now();
    const startInserted = counters.inserted;
    const runQueries = provider.ignoresQuery ? [null] : QUERIES;
    let providerBroken = false;
    let remainingCap = perRunCap;
    let sourceErr = null;
    const own = { fetched: 0, inserted: 0, updated: 0, touched: 0, unchanged: 0, deferred: 0, skipped: 0, failed: 0 };

    for (const q of runQueries) {
      if (providerBroken) break;
      if (remainingCap <= 0) break;
      try {
        let jobs = await withRetry(
          async () => {
            // every attempt counts, including failed retries
            subrequestsUsed += identifierCount;
            return provider.fetchJobs({ apiKey: source.api_key, query: q, timeoutMs: TIMEOUT_MS });
          },
          RETRIES
        );
        if (jobs.length > remainingCap) {
          const total = jobs.length;
          jobs = capJobs(jobs, remainingCap, slot);
          errorLog.add(source.provider, `Capped at ${perRunCap} of ${total} jobs this run (rotating window across companies)${warmupActive ? ' (warm-up mode)' : ''} — the rest will sync on a later run`, undefined);
        }
        const saved = await saveJobs(env, jobs, counters, errorLog, source.provider, settings, budget);
        subrequestsUsed += saved.batchesUsed;
        remainingCap -= jobs.length;
        for (const k of Object.keys(own)) own[k] += saved[k] || 0;
      } catch (e) {
        const cls = classifyError(e);
        errorLog.add(source.provider, `${cls.label}${cls.type === 'HTTP_ERROR' || cls.type === 'NETWORK_ERROR' ? '' : ` (${cls.type})`}`, q || undefined);
        sourceErr = { type: cls.type, message: e.message || String(e) };
        providerBroken = true;
      }
      if (runQueries.length > 1) await sleep(DELAY_BETWEEN_QUERIES_MS);
    }

    if (source.id) {
      outcomeStatements.push(sourceOutcomeStatement(env, source.id, sourceErr
        ? { success: false, errorType: sourceErr.type, errorMessage: sourceErr.message }
        : { success: true }));
    }
    processedSources++;

    providerStats.push({
      provider: source.provider,
      label: source.label,
      inserted: counters.inserted - startInserted,
      fetched: own.fetched, updated: own.updated, touched: own.touched, unchanged: own.unchanged,
      deferred: own.deferred, skipped: own.skipped, failed: own.failed,
      duration_ms: Date.now() - startedAt,
    });
  }

  // ── tail: ≤ 4 D1 calls, all batched ──
  if (outcomeStatements.length) { try { await env.DB.batch(outcomeStatements); } catch (e) { /* health bookkeeping never fails a sync */ } }
  await releaseProviderLocks(env, lockedProviders);

  const spent = Math.max(0, allowance - Math.max(0, budget.remaining));
  await saveSyncState(env, {
    day: state.day,
    used: state.used + spent,
    // a provider-filtered manual run must not disturb the fair rotation
    cursor: onlyProvider ? state.cursor : (startIdx + processedSources) % Math.max(1, sortedCount),
  });

  if (counters.deferred > 0) {
    errorLog.add('budget', `${counters.deferred} job(s) deferred to a later run — daily write budget pacing (${dailyBudget.toLocaleString('en-US')} rows/day)`, undefined);
  }

  const result = {
    inserted: counters.inserted, updated: counters.updated, skipped: counters.skipped,
    touched: counters.touched || 0, unchanged: counters.unchanged || 0, deferred: counters.deferred || 0,
    errors: errorLog.toArray(), providerStats, warmupActive, perRunCap,
    budget: { dailyBudget, usedToday: state.used + spent, allowance, spent },
    sourcesProcessed: processedSources, sourcesTotal: sortedCount,
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
  const safeBatchSize = Math.max(1, Math.min(300, Number.isFinite(Number(batchSize)) ? Math.floor(Number(batchSize)) : 300));
  const settings = await getSettings(env);
  // ROW-READ BUDGET (severe, see the idx_jobs_salary_tier_pending migration in
  // db/schema/account-tables.js for the full explanation): explicitly forced
  // to the partial index so this NEVER silently regresses back to scanning
  // every already-backfilled row before reaching the next pending batch.
  let rows;
  try {
    ({ results: rows } = await env.DB.prepare(
      `SELECT id, salary, description, salary_min_usd, salary_max_usd
         FROM jobs INDEXED BY idx_jobs_salary_tier_pending
        WHERE salary_tier IS NULL
        ORDER BY id ASC
        LIMIT ?`
    ).bind(safeBatchSize).all());
  } catch (e) {
    // Narrow post-deploy window before the resumable migration has reached
    // this index yet — fall back rather than fail the whole request.
    ({ results: rows } = await env.DB.prepare(
      `SELECT id, salary, description, salary_min_usd, salary_max_usd
         FROM jobs
        WHERE salary_tier IS NULL
        ORDER BY id ASC
        LIMIT ?`
    ).bind(safeBatchSize).all());
  }

  const stats = { processed: 0, high: 0, good: 0, standard: 0, unknown: 0, errors: 0 };
  if (rows && rows.length) {
    const prepared = rows.map((row) => {
      // salaryClassificationForJob uses persisted normalized values when
      // available and otherwise performs the single canonical parse (with
      // the same description fallback used by ingestion).
      const classified = salaryClassificationForJob(row, settings);
      const min = classified.parsed?.annualMinUsd ?? -1;
      const max = classified.parsed?.annualMaxUsd ?? -1;
      return { row, classified, stmt: env.DB.prepare(
        `UPDATE jobs
            SET salary_min_usd = ?, salary_max_usd = ?, salary_tier = ?, salary_tier_confidence = ?
          WHERE id = ? AND salary_tier IS NULL`
      ).bind(min, max, classified.tier, classified.confidence, row.id) };
    });
    try {
      const results = await env.DB.batch(prepared.map((entry) => entry.stmt));
      results.forEach((result, index) => {
        if (result.meta?.changes > 0) {
          stats.processed++;
          const tierKey = prepared[index].classified.tier.toLowerCase();
          if (tierKey in stats) stats[tierKey]++;
        }
      });
    } catch (error) {
      // Keep salary_tier NULL when the batch fails so the next invocation can
      // safely retry it; no row is falsely counted as processed.
      stats.errors = rows.length;
    }
  }

  // ROW-READ BUDGET: this used to be an UNBOUNDED `COUNT(*) WHERE salary_tier
  // IS NULL` — on a catalogue where most jobs haven't been backfilled yet (e.g.
  // right after this feature shipped, or after a large sync), that is hundreds
  // of thousands of rows, on EVERY click of "Backfill Salary Data". This is
  // exactly the kind of unbounded live aggregate the rest of this project's D1
  // row-read-budget work eliminated everywhere else — this one was missed.
  // Capped: "20,000+ remaining" is exactly as actionable as an exact count for
  // a progress indicator, at a small fraction of the cost.
  const remaining = await cappedCount(env, 'jobs', 'salary_tier IS NULL', [], 20000, 'idx_jobs_salary_tier_pending');
  return { ...stats, remaining };
}
