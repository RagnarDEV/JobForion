// src/pages/admin/accounts.js
// Admin management for the new Identity & Accounts system: Users
// (suspend/restore) and Company Accounts (verify/reject/suspend).
//
// NAMING NOTE: deliberately called "Company Accounts" in the nav/UI, NOT
// "Companies" — /admin/companies already exists (pages/admin/companies.js)
// and does something completely different (hiding spam company NAMES
// from the free-text `jobs.company` column via the hidden_companies
// table). That tool is untouched; this page manages the new, real
// `companies` entity table (db/schema.js's ensureAccountTables) with
// actual owners, members, and a verification workflow.

import { escapeHtml } from '../../lib/entities.js';

const PAGE_SIZE = 40;

const USER_STATUS_CLASS = { active: 'health-ok', pending_verification: 'health-warn', suspended: 'health-err', deleted: 'health-off' };
const COMPANY_STATUS_CLASS = { active: 'health-ok', pending: 'health-warn', rejected: 'health-err', suspended: 'health-err' };

// ── Users ───────────────────────────────────────────────────────
export async function renderAdminUsersContent(env, params) {
  const q = (params.get('q') || '').trim();
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where = q ? `WHERE email LIKE ?` : '';
  const binds = q ? [`%${q.toLowerCase()}%`] : [];

  const { results: users } = await env.DB.prepare(
    `SELECT id, email, email_verified, status, created_at, last_login_at FROM users ${where} ORDER BY id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`
  ).bind(...binds).all();
  const { results: countRows } = await env.DB.prepare(`SELECT COUNT(*) c FROM users ${where}`).bind(...binds).all();
  const total = countRows?.[0]?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = (users || []).map(u => `<tr>
    <td style="font-size:12.5px;color:var(--ink)">${escapeHtml(u.email)}</td>
    <td><span class="health-dot ${USER_STATUS_CLASS[u.status] || 'health-off'}"></span><span style="font-size:11.5px;color:var(--ink2)">${escapeHtml(u.status)}</span></td>
    <td style="font-size:11.5px;color:var(--ink2)">${u.email_verified ? '✓ Verified' : '— Unverified'}</td>
    <td style="font-size:11px;color:var(--ink3)">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
    <td style="font-size:11px;color:var(--ink3)">${u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</td>
    <td>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        ${u.status === 'suspended'
          ? `<form method="POST" action="/admin/accounts/users/restore"><input type="hidden" name="id" value="${u.id}"><button class="adm-btn-sm adm-btn-approve" type="submit">Restore</button></form>`
          : u.status !== 'deleted' ? `<form method="POST" action="/admin/accounts/users/suspend" onsubmit="return confirm('Suspend this user?')"><input type="hidden" name="id" value="${u.id}"><button class="adm-btn-sm" type="submit">Suspend</button></form>` : ''}
      </div>
    </td>
  </tr>`).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div><div class="adm-title">👤 Users</div><div class="adm-sub">${total.toLocaleString()} registered accounts</div></div>
    </div>
    <div class="adm-card" style="margin-bottom:14px">
      <form method="GET" action="/admin/accounts/users" style="display:flex;gap:8px">
        <input class="adm-input" name="q" placeholder="Search by email…" value="${escapeHtml(q)}" style="flex:1">
        <button class="adm-btn adm-btn-primary" type="submit">Search</button>
        ${q ? `<a href="/admin/accounts/users" class="adm-btn">Clear</a>` : ''}
      </form>
    </div>
    <div class="adm-card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="text-align:left;border-bottom:1.5px solid var(--border)">
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Email</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Status</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Email</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Joined</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Last Login</th>
          <th style="padding:8px 6px;color:var(--ink3);font-size:10.5px;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--ink3)">No users found</td></tr>`}</tbody>
      </table>
    </div>
    ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:8px;margin-top:16px">
      ${page > 1 ? `<a class="adm-btn" href="/admin/accounts/users?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}">← Prev</a>` : ''}
      <span class="adm-btn" style="cursor:default">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a class="adm-btn" href="/admin/accounts/users?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}">Next →</a>` : ''}
    </div>` : ''}
  </div>`;
}

// ── Company Accounts ────────────────────────────────────────────
export async function renderAdminCompanyAccountsContent(env, params) {
  const statusFilter = params.get('status') || '';
  const where = statusFilter ? `WHERE c.status = ?` : '';
  const binds = statusFilter ? [statusFilter] : [];

  const { results: companies } = await env.DB.prepare(
    `SELECT c.*, u.email as creator_email,
       (SELECT COUNT(*) FROM company_members WHERE company_id = c.id) as member_count,
       (SELECT COUNT(*) FROM jobs WHERE company_id = c.id) as job_count
     FROM companies c LEFT JOIN users u ON u.id = c.created_by_user_id
     ${where} ORDER BY c.created_at DESC LIMIT 100`
  ).bind(...binds).all();

  const { results: pendingCountRows } = await env.DB.prepare(`SELECT COUNT(*) c FROM companies WHERE status = 'pending'`).all();
  const pendingCount = pendingCountRows?.[0]?.c || 0;

  const rows = (companies || []).map(c => `<div class="pp-row">
    <div class="pp-info">
      <div class="pp-title">${escapeHtml(c.name)} <span class="health-dot ${COMPANY_STATUS_CLASS[c.status] || 'health-off'}"></span></div>
      <div class="pp-meta">${escapeHtml(c.creator_email || 'Unknown')} · ${c.member_count} member${c.member_count === 1 ? '' : 's'} · ${c.job_count} job${c.job_count === 1 ? '' : 's'} · Created ${new Date(c.created_at).toLocaleDateString()}</div>
      <a href="/companies/${escapeHtml(c.slug)}" target="_blank" style="font-size:11px;color:var(--brand)">/companies/${escapeHtml(c.slug)}</a>
    </div>
    <div class="pp-actions">
      ${c.status !== 'active' ? `<form method="POST" action="/admin/accounts/companies/verify"><input type="hidden" name="id" value="${c.id}"><button class="adm-btn-sm adm-btn-approve" type="submit">✓ Verify</button></form>` : ''}
      ${c.status === 'pending' ? `<form method="POST" action="/admin/accounts/companies/reject"><input type="hidden" name="id" value="${c.id}"><button class="adm-btn-sm" type="submit" onclick="return confirm('Reject this company?')">✕ Reject</button></form>` : ''}
      ${c.status === 'active' ? `<form method="POST" action="/admin/accounts/companies/suspend"><input type="hidden" name="id" value="${c.id}"><button class="adm-btn-sm" type="submit" onclick="return confirm('Suspend this company? Its published jobs stay live but it can\\'t post new ones or verify again without admin action.')">Suspend</button></form>` : ''}
    </div>
  </div>`).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div><div class="adm-title">🏢 Company Accounts</div><div class="adm-sub">${pendingCount} awaiting verification</div></div>
    </div>
    <div class="adm-card" style="margin-bottom:14px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/admin/accounts/companies" class="adm-btn ${!statusFilter ? 'adm-btn-primary' : ''}">All</a>
        <a href="/admin/accounts/companies?status=pending" class="adm-btn ${statusFilter === 'pending' ? 'adm-btn-primary' : ''}">Pending</a>
        <a href="/admin/accounts/companies?status=active" class="adm-btn ${statusFilter === 'active' ? 'adm-btn-primary' : ''}">Verified</a>
        <a href="/admin/accounts/companies?status=rejected" class="adm-btn ${statusFilter === 'rejected' ? 'adm-btn-primary' : ''}">Rejected</a>
        <a href="/admin/accounts/companies?status=suspended" class="adm-btn ${statusFilter === 'suspended' ? 'adm-btn-primary' : ''}">Suspended</a>
      </div>
    </div>
    <div class="adm-card">
      ${rows || `<div class="adm-empty">No companies found${statusFilter ? ` with status "${escapeHtml(statusFilter)}"` : ''}.</div>`}
    </div>
  </div>`;
}
