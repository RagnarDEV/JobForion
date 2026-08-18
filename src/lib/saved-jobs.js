// src/lib/saved-jobs.js
export async function isJobSaved(env, userId, jobId) {
  const { results } = await env.DB.prepare(`SELECT id FROM saved_jobs WHERE user_id = ? AND job_id = ? LIMIT 1`).bind(userId, jobId).all();
  return !!(results && results.length);
}

export async function saveJob(env, userId, jobId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO saved_jobs (user_id, job_id) VALUES (?, ?)`).bind(userId, jobId).run();
}

export async function unsaveJob(env, userId, jobId) {
  await env.DB.prepare(`DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?`).bind(userId, jobId).run();
}

export async function listSavedJobs(env, userId, { limit = 50, offset = 0 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT j.*, sj.created_at as saved_at FROM saved_jobs sj JOIN jobs j ON j.id = sj.job_id
     WHERE sj.user_id = ? ORDER BY sj.created_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();
  return results || [];
}

export async function countSavedJobs(env, userId) {
  const { results } = await env.DB.prepare(`SELECT COUNT(*) c FROM saved_jobs WHERE user_id = ?`).bind(userId).all();
  return results?.[0]?.c || 0;
}
