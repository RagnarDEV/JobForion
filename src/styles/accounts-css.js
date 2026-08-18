// src/styles/accounts-css.js
// Styles for the new public-facing account system: /login, /register,
// /forgot-password, /reset-password, /verify-email, /user/*, /company/*.
// Deliberately built ONLY from the design tokens already defined in
// styles/shared-css.js's :root (--brand, --ink, --surface, --border,
// --shadow, etc.) — no new colors, no new font. Auth FORM fields reuse
// the site's existing .pj-input/.pj-label/.pj-group/.pj-submit classes
// (originally the "Post a Job" modal's form styling, shared-css.js) so
// every text field on the site looks identical; this file only adds
// what didn't already exist: a dashboard shell (sidebar + content), stat
// cards, session/member list rows, and role badges. Included in
// layout/base-layout.js exactly like styles/job-card-css.js already is.

export const ACCOUNTS_CSS = `
.auth-wrap{max-width:420px;margin:56px auto;padding:0 20px 60px}
.auth-card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:32px 28px;box-shadow:var(--shadow-lg)}
.auth-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:var(--ink);margin-bottom:6px}
.auth-sub{font-size:13px;color:var(--ink3);margin-bottom:22px}
.auth-err{background:rgba(255,92,122,.1);border:1px solid rgba(255,92,122,.25);color:var(--coral);font-size:13px;padding:10px 12px;border-radius:9px;margin-bottom:16px}
.auth-ok{background:rgba(15,174,121,.1);border:1px solid rgba(15,174,121,.25);color:var(--green);font-size:13px;padding:10px 12px;border-radius:9px;margin-bottom:16px}
.auth-foot{font-size:12.5px;color:var(--ink3);margin-top:18px;text-align:center}
.auth-foot a{color:var(--brand);font-weight:700}
.auth-links{display:flex;justify-content:space-between;font-size:12px;margin-top:-6px;margin-bottom:14px}
.auth-links a{color:var(--brand)}

/* ── Dashboard shell (User + Company) — mirrors the Admin shell's
   sidebar/content split (pages/admin/shell.js) so logged-in users get a
   visually consistent "app" feel without copying admin-only styling. ── */
.dash-shell{display:flex;min-height:70vh;max-width:1180px;margin:0 auto}
.dash-sidebar{width:220px;flex-shrink:0;padding:24px 14px;border-right:1px solid var(--border)}
.dash-nav-link{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600;color:var(--ink2);text-decoration:none;margin-bottom:2px}
.dash-nav-link:hover{background:var(--surface2)}
.dash-nav-link.active{background:var(--brand);color:#fff}
.dash-main{flex:1;min-width:0;padding:24px 24px 60px}
.dash-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.dash-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:var(--ink)}
.dash-sub{font-size:13px;color:var(--ink3)}
.dash-mobile-nav{display:none;gap:8px;overflow-x:auto;padding:10px 16px;border-bottom:1px solid var(--border)}
.dash-mobile-nav a{flex-shrink:0;padding:7px 14px;border-radius:20px;background:var(--surface2);color:var(--ink2);font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap}
.dash-mobile-nav a.active{background:var(--brand);color:#fff}
@media(max-width:860px){
  .dash-shell{flex-direction:column}
  .dash-sidebar{display:none}
  .dash-mobile-nav{display:flex}
  .dash-main{padding:16px 16px 50px}
}

.dash-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:var(--shadow);margin-bottom:14px}
.dash-card-title{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:14px}
.dash-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.dash-kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:var(--shadow)}
.dash-kpi-label{font-size:10.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.dash-kpi-val{font-family:'Plus Jakarta Sans',sans-serif;font-size:24px;font-weight:800;color:var(--brand)}

.dash-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);gap:10px;flex-wrap:wrap}
.dash-row:last-child{border-bottom:none}
.dash-row-main{font-size:13px;font-weight:700;color:var(--ink)}
.dash-row-sub{font-size:11.5px;color:var(--ink3)}
.dash-empty{font-size:12.5px;color:var(--ink3);padding:14px 0;text-align:center}

.role-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;padding:3px 9px;border-radius:20px}
.role-badge-admin{background:var(--brand-soft);color:var(--brand)}
.role-badge-recruiter{background:rgba(15,174,121,.1);color:var(--green)}
.role-badge-member{background:var(--surface2);color:var(--ink3)}
.status-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;padding:3px 9px;border-radius:20px}
.status-pending{background:rgba(245,166,35,.12);color:var(--amber)}
.status-active{background:rgba(15,174,121,.12);color:var(--green)}
.status-suspended,.status-rejected{background:rgba(255,92,122,.12);color:var(--coral)}

.dash-btn{padding:9px 16px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);color:var(--ink2);font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.dash-btn-primary{background:var(--brand);border-color:var(--brand);color:#fff}
.dash-btn-danger{border-color:var(--coral);color:var(--coral)}
.dash-btn-sm{padding:6px 12px;border-radius:7px;font-size:11px}

.switch-pill{display:inline-flex;background:var(--surface2);border:1px solid var(--border2);border-radius:20px;padding:3px;gap:2px}
.switch-pill a{padding:6px 14px;border-radius:16px;font-size:12px;font-weight:700;color:var(--ink2);text-decoration:none}
.switch-pill a.active{background:var(--brand);color:#fff}
`;
