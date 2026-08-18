// src/lib/applications.js
// Tracks a user's relationship to a job beyond "saved" — status
// progresses saved → applied → viewed/interview/rejected/hired.
// application_type is set once, at creation, from the job's own
// source_type ('provider' jobs and 'employer' jobs without an in-app
// apply form are always 'external'; see plan §18) — never guessed later.

export async function recordApplication(env, userId, jobId, { status = 'applied', application_type = 'external' } = {}) {
  await env.DB.prepare(
    `INSERT INTO applications (user_id, job_id, status, application_type) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP`
  ).bind(userId, jobId, status, application_type).run();
}

export async function updateApplicationStatus(env, userId, jobId, status) {
  await env.DB.prepare(`UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND job_id = ?`)
    .bind(status, userId, jobId).run();
}

export async function listApplications(env, userId, { limit = 50, offset = 0 } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, j.title, j.company, j.location, j.salary, j.url FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();
  return results || [];
}

export async function countApplications(env, userId) {
  const { results } = await env.DB.prepare(`SELECT COUNT(*) c FROM applications WHERE user_id = ?`).bind(userId).all();
  return results?.[0]?.c || 0;
}
