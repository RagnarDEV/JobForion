// src/db/sync.js
// Thin orchestrator ONLY. Every provider is keyless — admins add companies
// (their public career-site slug), never API keys or URLs. Each sync run
// pulls a small, bounded batch of companies — oldest-synced-first — so a
// single Worker invocation never comes close to Cloudflare's free-plan
// 50-subrequest ceiling, no matter how many companies are registered in
// total. Companies simply take turns across successive cron runs.

import { ensureTable } from './schema.js';
import { logSync } from './analytics.js';
import { PROVIDERS } from '../providers/index.js';

const RETRIES = 1;
const TIMEOUT_MS = 12000;
const MAX_BULK_LINES = 500; // hard ceiling on a single bulk-add submission

// Retrying is only worth it for transient failures (network blips, 5xx).
// A 404/410/etc will not succeed on immediate retry.
function isRetryable(err) {
  const match = err && typeof err.message === 'string' && err.message.match(/^HTTP (\d{3})/);
  if (match) return parseInt(match[1], 10) >= 500;
  return true; // network errors / timeouts / provider-specific throws are worth one retry
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

// ────────────────────────────────────────────────────────────────
// Sync configuration — single-row settings, admin-editable from the
// dashboard. sourcesPerRun is the main Cloudflare-free-plan safety knob:
// each source costs roughly 1 fetch + up to 2 D1 batch calls, so the
// default of 12 leaves comfortable headroom under the 50-subrequest cap.
// ────────────────────────────────────────────────────────────────
export async function getSyncConfig(env) {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM sync_config WHERE id = 1').all();
    const row = results && results[0];
    return {
      sourcesPerRun: row?.sources_per_run ?? 12,
      jobsPerCompanyCap: row?.jobs_per_company_cap ?? 20,
    };
  } catch (e) {
    return { sourcesPerRun: 12, jobsPerCompanyCap: 20 };
  }
}

export async function updateSyncConfig(env, { sourcesPerRun, jobsPerCompanyCap } = {}) {
  const spr = Math.min(30, Math.max(1, parseInt(sourcesPerRun, 10) || 12));
  const cap = Math.min(100, Math.max(1, parseInt(jobsPerCompanyCap, 10) || 20));
  await env.DB.prepare(
    `INSERT INTO sync_config (id, sources_per_run, jobs_per_company_cap, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET sources_per_run = excluded.sources_per_run, jobs_per_company_cap = excluded.jobs_per_company_cap, updated_at = CURRENT_TIMESTAMP`
  ).bind(spr, cap).run();
  return { sourcesPerRun: spr, jobsPerCompanyCap: cap };
}

// ────────────────────────────────────────────────────────────────
// Provider companies — the api_sources table is reused as-is (it already
// has label/api_key/provider/active columns); `label` now holds the
// display name and `api_key` holds the company's career-site slug. It is
// never a real API key or secret, so nothing here needs to be masked.
// ────────────────────────────────────────────────────────────────

export async function getActiveSources(env, { limit } = {}) {
  const sql = limit
    ? `SELECT * FROM api_sources WHERE active = 1 ORDER BY (last_synced_at IS NULL) DESC, last_synced_at ASC LIMIT ?`
    : `SELECT * FROM api_sources WHERE active = 1 ORDER BY (last_synced_at IS NULL) DESC, last_synced_at ASC`;
  const { results } = limit ? await env.DB.prepare(sql).bind(limit).all() : await env.DB.prepare(sql).all();
  return results || [];
}

export async function countActiveSources(env) {
  const { results } = await env.DB.prepare('SELECT COUNT(*) c FROM api_sources WHERE active = 1').all();
  return results?.[0]?.c || 0;
}

// Inserts a single company row without assuming a fixed column set — some
// deployments of api_sources predate the current schema and carry extra
// NOT NULL columns (name, base_url, ...). Reads the live schema via
// PRAGMA table_info and fills in a sensible value for whatever it finds.
export async function insertApiSource(env, label, company, provider) {
  const { results: cols } = await env.DB.prepare(`PRAGMA table_info(api_sources)`).all();
  const knownValues = { label, name: label, api_key: company, provider, active: 1 };
  const insertCols = [];
  const values = [];
  for (const col of (cols || [])) {
    if (col.name === 'id') continue;
    if (col.name === 'created_at' && col.dflt_value != null) continue;
    if (['last_synced_at', 'last_job_count', 'last_error'].includes(col.name)) continue;
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

// Bulk add: one company per line (or comma-separated), with an optional
// "slug|Display Name" format per line. Skips companies already registered
// under the same provider so re-pasting a list is always safe.
export async function bulkInsertApiSources(env, provider, rawText) {
  const allLines = String(rawText || '')
    .split(/[\n,]+/)
    .map(l => l.trim())
    .filter(Boolean);
  const lines = allLines.slice(0, MAX_BULK_LINES);
  if (!lines.length) return { added: 0, skipped: 0, truncated: false };

  const { results: existing } = await env.DB.prepare(
    'SELECT LOWER(api_key) k FROM api_sources WHERE provider = ?'
  ).bind(provider).all();
  const existingSlugs = new Set((existing || []).map(r => r.k));

  let added = 0, skipped = 0;
  for (const line of lines) {
    let slug = line, label = line;
    if (line.includes('|')) {
      const [s, l] = line.split('|').map(part => part.trim());
      slug = s;
      label = l || s;
    }
    slug = slug.replace(/\s+/g, '');
    if (!slug || existingSlugs.has(slug.toLowerCase())) { skipped++; continue; }
    await insertApiSource(env, (label || slug).slice(0, 100), slug.slice(0, 200), provider);
    existingSlugs.add(slug.toLowerCase());
    added++;
  }
  return { added, skipped, truncated: allLines.length > MAX_BULK_LINES };
}

export async function updateApiSource(env, id, { label, company, active }) {
  await env.DB.prepare(
    `UPDATE api_sources SET label = ?, name = ?, api_key = ?, active = ? WHERE id = ?`
  ).bind(label, label, company, active ? 1 : 0, id).run();
}

// ────────────────────────────────────────────────────────────────
// Save — two-phase insert/update against the unique `url` column.
// Phase 1 — INSERT OR IGNORE the genuinely new jobs (changes>0 is the
// only source of the "inserted" counter). Phase 2 — UPDATE whatever
// phase 1 didn't insert, refreshing mutable fields and bumping
// updated_at/expires_at so still-active jobs never get swept by the
// 30-day-stale cleanup job. Both phases use env.DB.batch() — one
// subrequest per chunk per phase, regardless of chunk size.
// ────────────────────────────────────────────────────────────────
const DB_BATCH_SIZE = 25;

function createErrorLog() {
  const list = [];
  return {
    add(provider, message) { list.push(`[${provider}] ${String(message).slice(0, 160)}`); },
    toArray(limit = 30) { return list.slice(0, limit); },
  };
}

async function saveJobs(env, jobs, counters, errorLog, providerId) {
  const validJobs = (jobs || []).filter((j) => j && j.url);
  counters.skipped += (jobs || []).length - validJobs.length;

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
      results.forEach((r, idx) => {
        if (r.meta?.changes > 0) { counters.inserted++; insertedUrls.add(chunk[idx].url); }
      });
    } catch (e) {
      errorLog.add(providerId, `DB insert: ${e.message.slice(0, 60)}`);
      continue;
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
        results.forEach((r) => { if (r.meta?.changes > 0) counters.updated++; });
      } catch (e) {
        errorLog.add(providerId, `DB update: ${e.message.slice(0, 60)}`);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Main entry point — processes a bounded batch of companies per run,
// oldest-synced-first. This is self-healing and needs no separate cursor
// state: newly added companies (last_synced_at IS NULL) always sort
// first, and once synced they naturally fall to the back of the queue.
// ────────────────────────────────────────────────────────────────
export async function syncJobs(env) {
  await ensureTable(env);
  const config = await getSyncConfig(env);
  const totalActive = await countActiveSources(env);
  const sources = await getActiveSources(env, { limit: config.sourcesPerRun });

  const counters = { inserted: 0, updated: 0, skipped: 0 };
  const errorLog = createErrorLog();
  const providerStats = [];
  const statusUpdates = [];

  if (!sources.length) {
    const result = { inserted: 0, updated: 0, skipped: 0, errors: ['لا توجد شركات مفعّلة بعد — أضف شركات لأحد المزودين من لوحة التحكم'] };
    await logSync(env, result);
    return result;
  }

  for (const source of sources) {
    const provider = PROVIDERS[source.provider];
    if (!provider) { errorLog.add(source.provider, 'Unknown provider'); continue; }

    const startedAt = Date.now();
    const startInserted = counters.inserted;
    let jobCount = 0;
    let errMsg = null;

    try {
      const jobs = await withRetry(
        () => provider.fetchJobs({ company: source.api_key, timeoutMs: TIMEOUT_MS }),
        RETRIES
      );
      const capped = jobs.slice(0, config.jobsPerCompanyCap);
      jobCount = capped.length;
      await saveJobs(env, capped, counters, errorLog, source.provider);
    } catch (e) {
      errMsg = String(e.message || e).slice(0, 200);
      errorLog.add(source.provider, errMsg);
    }

    statusUpdates.push(
      env.DB.prepare(`UPDATE api_sources SET last_synced_at = CURRENT_TIMESTAMP, last_job_count = ?, last_error = ? WHERE id = ?`)
        .bind(jobCount, errMsg, source.id)
    );

    providerStats.push({
      provider: source.provider,
      label: source.label,
      inserted: counters.inserted - startInserted,
      duration_ms: Date.now() - startedAt,
    });
  }

  // One batched write for every source's status, instead of one query per
  // source — keeps the per-run subrequest count predictable regardless of
  // how many companies were just processed.
  if (statusUpdates.length) {
    try { await env.DB.batch(statusUpdates); } catch (e) {}
  }

  const remaining = Math.max(0, totalActive - sources.length);
  const result = {
    inserted: counters.inserted,
    updated: counters.updated,
    skipped: counters.skipped,
    errors: errorLog.toArray(),
    providerStats,
    sourcesProcessed: sources.length,
    sourcesRemaining: remaining,
  };
  await logSync(env, result);
  return result;
}
