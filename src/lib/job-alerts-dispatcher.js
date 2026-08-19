// src/lib/job-alerts-dispatcher.js
// ════════════════════════════════════════════════════════════════
// JOB ALERTS DISPATCHER — the piece that was missing: job_alerts rows
// were being created and stored (lib/job-alerts.js) but nothing ever
// actually matched them against new jobs or sent an email. This file is
// that missing piece, called from a dedicated daily cron (see
// index.js's scheduled() + wrangler.toml's new "0 8 * * *" trigger).
//
// Design, matching the plan's request (§19 "Frequency"):
//   - 'instant' and 'daily' alerts are both checked on this SAME daily
//     cron run (Cloudflare's free-tier cron budget doesn't comfortably
//     support a true instant/hourly dispatch on top of the 3 crons
//     already running); 'weekly' alerts are only checked once every 7
//     days. This is a deliberate, documented simplification — upgrading
//     'instant' to genuinely near-real-time later just means adding one
//     more cron trigger and one more frequency branch here, nothing else
//     changes.
//   - Each alert only ever gets emailed jobs created AFTER its own
//     last_notified_at (or, for a brand-new alert, jobs from the last
//     24h) — this is what makes "never re-send the same job twice" true
//     without a separate seen-jobs join table.
//   - A run that finds zero new matches for an alert does NOT send an
//     empty "no new jobs" email and does NOT touch last_notified_at —
//     so a quiet week doesn't reset the clock and cause a burst of
//     already-seen jobs once one finally matches.
// ════════════════════════════════════════════════════════════════

import { sendEmail } from './accounts/email.js';
import { logActivity } from './activity-log.js';
import { escapeHtml } from './entities.js';
import { BASE_URL } from '../config/constants.js';

const MAX_JOBS_PER_EMAIL = 10;
const DUE_WINDOW = { daily: 1, instant: 1, weekly: 7 };

function buildMatchQuery(alert, sinceIso) {
  const conditions = [`j.created_at > ?`, `j.status = 'active'`];
  const params = [sinceIso];

  if (alert.keywords) {
    conditions.push(`(LOWER(j.title) LIKE ? OR LOWER(j.company) LIKE ?)`);
    const kw = `%${alert.keywords.toLowerCase()}%`;
    params.push(kw, kw);
  }
  if (alert.category) { conditions.push(`LOWER(j.title) LIKE ?`); params.push(`%${alert.category.toLowerCase()}%`); }
  if (alert.skills) {
    conditions.push(`LOWER(j.skills) LIKE ?`);
    params.push(`%${alert.skills.toLowerCase()}%`);
  }
  if (alert.country) { conditions.push(`LOWER(j.location) LIKE ?`); params.push(`%${alert.country.toLowerCase()}%`); }
  if (alert.remote_type) { conditions.push(`j.remote_type = ?`); params.push(alert.remote_type); }
  if (alert.employment_type) { conditions.push(`j.employment_type = ?`); params.push(alert.employment_type); }
  if (alert.salary_min) {
    conditions.push(`CAST(REPLACE(REPLACE(j.salary,'$',''),'k','') AS INTEGER) >= ?`);
    params.push(alert.salary_min);
  }

  const sql = `SELECT j.* FROM jobs j WHERE ${conditions.join(' AND ')} ORDER BY j.id DESC LIMIT ${MAX_JOBS_PER_EMAIL}`;
  return { sql, params };
}

function digestEmailContent(alert, jobs) {
  const label = alert.keywords || alert.category || alert.country || 'your saved criteria';
  const subject = `${jobs.length} new remote job${jobs.length === 1 ? '' : 's'} matching "${label}"`;
  const rows = jobs.map(j =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #E6E9F0">
       <a href="${BASE_URL}/job/${j.id}" style="color:#3556FF;font-weight:700;text-decoration:none">${escapeHtml(j.title)}</a>
       <div style="color:#525A72;font-size:13px">${escapeHtml(j.company)}${j.location ? ' · ' + escapeHtml(j.location) : ''}${j.salary ? ' · ' + escapeHtml(j.salary) : ''}</div>
     </td></tr>`
  ).join('');
  const textLines = jobs.map(j => `- ${j.title} at ${j.company}: ${BASE_URL}/job/${j.id}`).join('\n');

  return {
    subject,
    text: `New jobs matching your alert (${label}):\n\n${textLines}\n\nManage your alerts: ${BASE_URL}/user/job-alerts`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#12162B">New jobs matching your alert</h2>
      <p style="color:#525A72">Matching: <strong>${escapeHtml(label)}</strong></p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <p style="margin-top:20px"><a href="${BASE_URL}/user/job-alerts" style="color:#8890A4;font-size:12px">Manage your job alerts</a></p>
    </div>`,
  };
}

export async function runJobAlertsDispatch(env) {
  let sent = 0, skipped = 0, failed = 0;

  let alerts;
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.*, u.email FROM job_alerts a JOIN users u ON u.id = a.user_id WHERE a.active = 1 AND u.status = 'active' AND u.email_notifications_enabled = 1`
    ).all();
    alerts = results || [];
  } catch (e) {
    await logActivity(env, 'job_alerts_dispatch_failed', '', { reason: String(e.message || e).slice(0, 200) });
    return { sent: 0, skipped: 0, failed: 0, error: true };
  }

  for (const alert of alerts) {
    try {
      const frequency = ['daily', 'weekly', 'instant'].includes(alert.frequency) ? alert.frequency : 'daily';
      const windowDays = DUE_WINDOW[frequency];

      // Respect the alert's own cadence: skip if it was already notified
      // more recently than its window requires.
      if (alert.last_notified_at) {
        const lastNotified = new Date(alert.last_notified_at.replace(' ', 'T') + 'Z');
        const daysSince = (Date.now() - lastNotified.getTime()) / 86400000;
        if (daysSince < windowDays) { skipped++; continue; }
      }

      const sinceIso = alert.last_notified_at || new Date(Date.now() - windowDays * 86400000).toISOString();
      const { sql, params } = buildMatchQuery(alert, sinceIso);
      const { results: jobs } = await env.DB.prepare(sql).bind(...params).all();

      if (!jobs || !jobs.length) { skipped++; continue; } // no new matches — last_notified_at NOT touched, see file header

      const { subject, text, html } = digestEmailContent(alert, jobs);
      const result = await sendEmail(env, { to: alert.email, subject, text, html });

      // Only advance the clock on a real send — if the provider isn't
      // configured yet (send returns sent:false) we want the SAME jobs
      // to be picked up and actually emailed once it is, not silently
      // skipped forever.
      if (result.sent) {
        await env.DB.prepare(`UPDATE job_alerts SET last_notified_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(alert.id).run();
        sent++;
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      await logActivity(env, 'job_alert_dispatch_error', alert.email || '', { alertId: alert.id, reason: String(e.message || e).slice(0, 200) });
    }
  }

  await logActivity(env, 'job_alerts_dispatch_completed', '', { sent, skipped, failed, totalAlerts: alerts.length });
  return { sent, skipped, failed, totalAlerts: alerts.length };
}
