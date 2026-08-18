// src/lib/job-alerts.js
export async function listJobAlerts(env, userId) {
  const { results } = await env.DB.prepare(`SELECT * FROM job_alerts WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all();
  return results || [];
}

export async function createJobAlert(env, userId, fields) {
  const { keywords, category, skills, country, remote_type, employment_type, salary_min, frequency } = fields;
  await env.DB.prepare(
    `INSERT INTO job_alerts (user_id, keywords, category, skills, country, remote_type, employment_type, salary_min, frequency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, String(keywords || '').slice(0, 200), String(category || '').slice(0, 60),
    String(skills || '').slice(0, 200), String(country || '').slice(0, 100),
    String(remote_type || '').slice(0, 40), String(employment_type || '').slice(0, 40),
    salary_min ? parseInt(salary_min, 10) : null, String(frequency || 'daily').slice(0, 20)
  ).run();
}

// userId included in the WHERE clause on every mutation below — the
// same IDOR-prevention pattern as lib/accounts/session.js's
// destroySessionById: a user can only ever touch their OWN alert id,
// even if they guess or enumerate another user's alert id.
export async function updateJobAlert(env, userId, alertId, fields) {
  const { keywords, category, skills, country, remote_type, employment_type, salary_min, frequency, active } = fields;
  await env.DB.prepare(
    `UPDATE job_alerts SET keywords=?, category=?, skills=?, country=?, remote_type=?, employment_type=?, salary_min=?, frequency=?, active=?, updated_at=CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`
  ).bind(
    String(keywords || '').slice(0, 200), String(category || '').slice(0, 60), String(skills || '').slice(0, 200),
    String(country || '').slice(0, 100), String(remote_type || '').slice(0, 40), String(employment_type || '').slice(0, 40),
    salary_min ? parseInt(salary_min, 10) : null, String(frequency || 'daily').slice(0, 20), active ? 1 : 0,
    alertId, userId
  ).run();
}

export async function deleteJobAlert(env, userId, alertId) {
  await env.DB.prepare(`DELETE FROM job_alerts WHERE id = ? AND user_id = ?`).bind(alertId, userId).run();
}
