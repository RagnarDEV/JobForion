// src/lib/users.js
// ════════════════════════════════════════════════════════════════
// USERS data-access layer. Every function here that returns a user row
// EXPLICITLY excludes password_hash from the SELECT — the hash never
// needs to leave this file except inside verifyCredentials(), which
// only ever returns a boolean + the safe row, never the hash itself, to
// its caller (routes/auth.router.js).
// ════════════════════════════════════════════════════════════════

import { hashPassword, verifyPassword } from './accounts/password.js';

const SAFE_USER_COLUMNS = 'id, email, email_verified, status, created_at, updated_at, last_login_at, email_notifications_enabled';

export async function findUserByEmail(env, email, { includeHash = false } = {}) {
  const cols = includeHash ? `${SAFE_USER_COLUMNS}, password_hash` : SAFE_USER_COLUMNS;
  const { results } = await env.DB.prepare(`SELECT ${cols} FROM users WHERE email = ? LIMIT 1`)
    .bind(String(email || '').trim().toLowerCase()).all();
  return results?.[0] || null;
}

export async function findUserById(env, id) {
  const { results } = await env.DB.prepare(`SELECT ${SAFE_USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`).bind(id).all();
  return results?.[0] || null;
}

export async function createUser(env, email, password) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const result = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, status) VALUES (?, ?, 'pending_verification')`
  ).bind(cleanEmail, passwordHash).run();
  const userId = result?.meta?.last_row_id;
  // Every user gets an empty profile row up front (1:1, see
  // ensureAccountTables) so every later profile read/update is a plain
  // UPDATE, never a "does a row exist yet" branch.
  await env.DB.prepare(`INSERT INTO user_profiles (user_id) VALUES (?)`).bind(userId).run();
  return userId;
}

// Returns the safe user row on success, or null on any failure
// (unknown email OR wrong password — deliberately indistinguishable to
// the caller, see plan §9's "don't reveal whether an email exists").
export async function verifyCredentials(env, email, password) {
  const user = await findUserByEmail(env, email, { includeHash: true });
  if (!user) { await verifyPassword(password, 'pbkdf2$100000$00$00'); return null; } // constant-time-ish decoy work
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  delete user.password_hash;
  return user;
}

export async function setUserStatus(env, userId, status) {
  await env.DB.prepare(`UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(status, userId).run();
}

export async function markEmailVerified(env, userId) {
  await env.DB.prepare(`UPDATE users SET email_verified = 1, status = CASE WHEN status = 'pending_verification' THEN 'active' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(userId).run();
}

export async function updateUserPassword(env, userId, newPassword) {
  const passwordHash = await hashPassword(newPassword);
  await env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(passwordHash, userId).run();
}

export async function updateUserEmail(env, userId, newEmail) {
  await env.DB.prepare(`UPDATE users SET email = ?, email_verified = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(String(newEmail || '').trim().toLowerCase(), userId).run();
}

export async function setEmailNotificationsEnabled(env, userId, enabled) {
  await env.DB.prepare(`UPDATE users SET email_notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(enabled ? 1 : 0, userId).run();
}

// Soft delete (plan §4 — "don't delete sensitive data directly if soft
// deletion is needed"): status flips to 'deleted' and the email is
// namespaced so the address becomes immediately reusable for a fresh
// registration, but the row (and its history — saved jobs, applications,
// company memberships) is retained rather than hard-deleted.
export async function softDeleteUser(env, userId) {
  const user = await findUserById(env, userId);
  if (!user) return;
  const anonymizedEmail = `deleted-${userId}-${Date.now()}@deleted.jobforion`;
  await env.DB.prepare(`UPDATE users SET status = 'deleted', email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(anonymizedEmail, userId).run();
  // AI conversations and matching output are user-private artifacts. They
  // must not survive account deletion even though the broader account policy
  // retains non-AI business history for audit/reporting purposes.
  const cleanup = [
    env.DB.prepare(`DELETE FROM career_assistant_messages WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM career_assistant_threads WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM user_job_matches WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM user_sessions WHERE user_id = ?`).bind(userId),
  ];
  if (typeof env.DB.batch === 'function') await env.DB.batch(cleanup);
  else for (const statement of cleanup) await statement.run();
}

// ── Profile ─────────────────────────────────────────────────────
export async function getUserProfile(env, userId) {
  const { results } = await env.DB.prepare(`SELECT * FROM user_profiles WHERE user_id = ? LIMIT 1`).bind(userId).all();
  const row = results?.[0] || null;
  if (!row) return null;
  for (const jsonCol of ['skills', 'experience', 'education', 'languages', 'job_preferences']) {
    try { row[jsonCol] = JSON.parse(row[jsonCol] || (jsonCol === 'job_preferences' ? '{}' : '[]')); }
    catch (e) { row[jsonCol] = jsonCol === 'job_preferences' ? {} : []; }
  }
  return row;
}

export async function updateUserProfile(env, userId, fields) {
  const {
    full_name, avatar_url, country, city, job_title, bio,
    skills, experience, education, languages, linkedin_url, portfolio_url, resume_url, job_preferences,
  } = fields;
  await env.DB.prepare(
    `UPDATE user_profiles SET
       full_name = ?, avatar_url = ?, country = ?, city = ?, job_title = ?, bio = ?,
       skills = ?, experience = ?, education = ?, languages = ?,
       linkedin_url = ?, portfolio_url = ?, resume_url = ?, job_preferences = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`
  ).bind(
    String(full_name || '').slice(0, 150), String(avatar_url || '').slice(0, 500),
    String(country || '').slice(0, 100), String(city || '').slice(0, 100),
    String(job_title || '').slice(0, 150), String(bio || '').slice(0, 2000),
    JSON.stringify((Array.isArray(skills) ? skills : []).slice(0, 50)),
    JSON.stringify((Array.isArray(experience) ? experience : []).slice(0, 30)),
    JSON.stringify((Array.isArray(education) ? education : []).slice(0, 20)),
    JSON.stringify((Array.isArray(languages) ? languages : []).slice(0, 20)),
    String(linkedin_url || '').slice(0, 300), String(portfolio_url || '').slice(0, 300), String(resume_url || '').slice(0, 500),
    JSON.stringify(job_preferences && typeof job_preferences === 'object' ? job_preferences : {}),
    userId
  ).run();
}
