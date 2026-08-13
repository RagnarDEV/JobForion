// src/pages/admin/security.js
// Admin & Security — the full activity log, a simple brute-force signal
// on top of the rate limiter already blocking excess attempts (see
// lib/rate-limit.js), and honest documentation of how password rotation
// actually works in this architecture.
//
// DELIBERATELY NOT HERE: a "change password" form that writes to D1.
// ADMIN_PASSWORD is a Cloudflare Workers *secret* (wrangler secret put),
// which is by design never readable OR writable by the Worker's own
// running code — that's the whole point of using a secret instead of a
// settings-table value. Faking a password-change form here would either
// do nothing (silently misleading) or require storing the password
// somewhere the Worker CAN read it, which would be a real regression in
// how the credential is protected. See the note rendered below instead.

import { escapeHtml } from '../../lib/entities.js';
import { getRecentActivity, countRecentLoginFailures, ACTION_LABELS } from '../../lib/activity-log.js';

export async function renderSecurityContent(env) {
  const [log, failedLogins] = await Promise.all([
    getRecentActivity(env, 100),
    countRecentLoginFailures(env, 15),
  ]);

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🛡️ Admin &amp; Security</div>
        <div class="adm-sub">Activity log, sign-in attempts, and account security</div>
      </div>
      <a href="/admin" class="adm-btn">← Dashboard</a>
    </div>

    <div class="adm-grid" style="margin-bottom:16px">
      <div class="adm-card">
        <div class="adm-card-title">Account</div>
        <div class="adm-row"><span class="adm-row-label">Admin password</span><span class="adm-row-val">Cloudflare secret</span></div>
        <div class="adm-row"><span class="adm-row-label">Session length</span><span class="adm-row-val">24 hours</span></div>
        <div class="adm-row"><span class="adm-row-label">Login rate limit</span><span class="adm-row-val">5 attempts / 15 min per IP</span></div>
        <div style="font-size:11.5px;color:var(--ink2);line-height:1.75;margin-top:12px;background:var(--surface2);border-radius:10px;padding:11px 13px">
          To rotate the admin password, run <code style="background:var(--surface);border:1px solid var(--border2);padding:1px 6px;border-radius:5px">wrangler secret put ADMIN_PASSWORD</code> from your machine, then redeploy. This can't be a button in this panel — Cloudflare secrets are intentionally unreadable and unwritable from the Worker's own running code, which is exactly what keeps the password safe even if the admin panel itself were ever compromised.
        </div>
      </div>
      <div class="adm-card">
        <div class="adm-card-title">Sign-in Activity</div>
        <div class="adm-row"><span class="adm-row-label">Failed attempts, last 15 min</span><span class="adm-row-val" style="color:${failedLogins > 3 ? 'var(--coral)' : 'var(--ink)'}">${failedLogins}</span></div>
        ${failedLogins > 3
          ? `<div style="font-size:11px;color:var(--coral);margin-top:10px">⚠ Repeated failed attempts detected. The rate limiter is actively slowing these down (max 5 / 15 min per IP) — if this continues, rotate the password using the command above.</div>`
          : `<div style="font-size:11px;color:var(--ink3);margin-top:10px">No unusual activity right now.</div>`}
      </div>
    </div>

    <div class="adm-card">
      <div class="adm-card-title">Activity Log <span style="font-weight:400;color:var(--ink3);font-size:12px">— most recent 100 admin actions</span></div>
      ${log.length ? log.map(l => `<div class="adm-row">
        <span class="adm-row-label" style="max-width:65%">${escapeHtml(ACTION_LABELS[l.action] || l.action)}${l.target ? ` — <span style="color:var(--ink3);font-weight:500">${escapeHtml(l.target)}</span>` : ''}</span>
        <span class="adm-row-val" style="font-weight:500;color:var(--ink3);font-size:11px">${l.created_at ? new Date(l.created_at).toLocaleString() : ''}</span>
      </div>`).join('') : '<div class="adm-empty">No activity recorded yet — actions taken from now on will appear here.</div>'}
    </div>
  </div>`;
}
