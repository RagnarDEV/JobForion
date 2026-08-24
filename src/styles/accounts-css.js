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
.auth-title{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:800;color:var(--ink);margin-bottom:6px}
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
.dash-shell{display:flex;min-height:70vh;max-width:1180px;margin:0 auto;background:#fff;border:1px solid #efedf5;border-radius:14px;overflow:hidden;box-shadow:var(--shadow-card)}
.dash-sidebar{width:224px;flex-shrink:0;padding:22px 13px;background:#fcfbff;border-right:1px solid #efedf5}
.dash-nav-link{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:700;color:var(--ink2);text-decoration:none;margin-bottom:3px}
.dash-nav-link:hover{background:var(--brand-soft);color:var(--brand)}
.dash-nav-link.active{background:var(--brand-soft);color:var(--brand)}
.dash-main{flex:1;min-width:0;padding:28px 28px 60px}
.dash-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px}
.dash-title{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:800;color:var(--ink)}
.dash-sub{font-size:13px;color:var(--ink3)}
.dash-mobile-nav{display:none;gap:8px;overflow-x:auto;padding:10px 16px;border-bottom:1px solid var(--border)}
.dash-mobile-nav a{flex-shrink:0;padding:7px 14px;border-radius:20px;background:var(--surface2);color:var(--ink2);font-size:12.5px;font-weight:700;text-decoration:none;white-space:nowrap}
.dash-mobile-nav a.active{background:var(--brand);color:#fff}
@media(max-width:860px){
  .dash-shell{flex-direction:column}
  .dash-sidebar{display:none}
  .dash-mobile-nav{display:flex}
  .dash-shell{border:0;border-radius:0;box-shadow:none;background:transparent}.dash-main{padding:16px 16px 84px}
}

.dash-card{background:#fff;border:1px solid #efedf5;border-radius:11px;padding:18px;box-shadow:0 5px 18px rgba(37,24,92,.04);margin-bottom:14px}
.dash-card-title{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:14px}
.dash-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
.dash-kpi{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:var(--shadow)}
.dash-kpi-label{font-size:10.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.dash-kpi-val{font-family:'Space Grotesk',sans-serif;font-size:24px;font-weight:800;color:var(--brand)}

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

  /* Account Experience V2 — public user surfaces only. Existing class names remain compatible with the company dashboard. */
  .dash-page{max-width:1180px!important;padding:28px 20px 86px!important}.dash-toast-host{position:fixed;bottom:22px;right:22px;z-index:999}.dash-userbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:16px;padding:15px 18px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-card)}.dash-userbar-copy{display:grid;gap:4px}.dash-kicker,.dash-sidebar-label{color:var(--ink3);font-size:9px;font-weight:800;letter-spacing:1.5px}.dash-userbar-name{color:var(--ink);font:800 17px 'Space Grotesk',sans-serif}.dash-userbar-actions{display:flex;align-items:center;gap:10px}.dash-avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--brand-soft);color:var(--brand);font:800 12px 'Space Grotesk',sans-serif}.dash-userbar-link{border:0;background:transparent;color:var(--ink2);font:800 11px inherit;text-decoration:none;cursor:pointer}.dash-userbar-link:hover{color:var(--brand)}.dash-logout-link{padding:0}.dash-sidebar-label{margin:0 12px 12px}.dash-shell{max-width:none;border-radius:16px}.dash-sidebar{width:230px;padding:24px 13px;background:linear-gradient(180deg,#fcfbff,#fff)}.dash-nav-link{min-height:40px;padding:10px 12px;border-radius:9px}.dash-main{padding:30px 32px 64px}.dash-title{font-size:26px;letter-spacing:-.6px}.dash-sub{margin:5px 0 0;line-height:1.5}.dash-kpi-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.dash-kpi{padding:17px;border-radius:13px;box-shadow:none}.dash-kpi-label{letter-spacing:1px}.dash-kpi-val{font-size:29px}.dash-card{padding:20px;border-radius:14px}.dash-card-title{font-size:14px}.dash-row{padding:13px 0}.dash-empty{padding:27px 10px}.dash-page .pj-row{gap:13px}.dash-page .pj-input,.dash-page .pj-textarea,.dash-page .pj-select{border-radius:9px}.dash-page .pj-submit{border-radius:9px}.account-section-heading{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:0 0 13px}.account-section-heading h2{margin:0;color:var(--ink);font:800 15px 'Space Grotesk',sans-serif}.account-section-heading p{margin:4px 0 0;color:var(--ink3);font-size:11px}.account-action-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:16px}.account-action-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--ink);text-decoration:none;transition:all .18s}.account-action-card:hover{border-color:#cfc4fa;box-shadow:var(--shadow);transform:translateY(-1px)}.account-action-card strong{display:block;font-size:12px}.account-action-card span{display:block;margin-top:3px;color:var(--ink3);font-size:10px}.account-action-arrow{color:var(--brand);font-weight:900}.profile-avatar-block{display:flex;align-items:center;gap:13px;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid var(--border)}.profile-avatar{display:grid;place-items:center;width:64px;height:64px;overflow:hidden;border-radius:50%;background:var(--brand-soft);color:var(--brand);font:800 21px 'Space Grotesk',sans-serif}.profile-avatar img{width:100%;height:100%;object-fit:cover}.profile-avatar-copy strong{display:block;color:var(--ink);font-size:13px}.profile-avatar-copy span{display:block;margin-top:3px;color:var(--ink3);font-size:11px}.profile-form-section{margin-top:22px;padding-top:18px;border-top:1px solid var(--border)}.profile-form-section h2{margin:0 0 12px;color:var(--ink);font:800 14px 'Space Grotesk',sans-serif}.profile-form-hint{margin:-5px 0 12px;color:var(--ink3);font-size:10.5px;line-height:1.5}.profile-list-input{min-height:84px}.profile-progress{height:7px;overflow:hidden;margin-top:8px;border-radius:9px;background:var(--surface2)}.profile-progress span{display:block;height:100%;border-radius:9px;background:var(--brand)}.profile-completion-copy{color:var(--ink3);font-size:10.5px}.account-inline-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.account-danger-card{border-color:rgba(255,92,122,.28)}.account-password-wrap{position:relative}.account-password-wrap .pj-input{padding-right:61px}.account-password-wrap button{position:absolute;right:7px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--brand);font:800 10px inherit;cursor:pointer;padding:6px}.account-password-wrap button:focus-visible{outline:3px solid var(--brand-soft);outline-offset:2px;border-radius:5px}.account-page-intro{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 15px}.account-page-intro h2{margin:5px 0 6px;color:var(--ink);font:800 24px/1.1 'Space Grotesk',sans-serif;letter-spacing:-.5px}.account-page-intro p{margin:0;color:var(--ink2);font-size:11.5px;line-height:1.55}.saved-job-count{display:flex;align-items:baseline;gap:6px;margin:0 0 12px;color:var(--ink3);font-size:11px}.saved-job-count strong{color:var(--brand);font:800 24px 'Space Grotesk',sans-serif}.saved-jobs-grid{display:grid;gap:12px}.saved-jobs-grid .job-card{margin:0}.application-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 0;border-bottom:1px solid var(--border)}.application-row:last-child{border-bottom:0}.application-main{min-width:0}.application-title{overflow:hidden;color:var(--ink);font-size:13px;font-weight:800;text-overflow:ellipsis;white-space:nowrap}.application-title a:hover{color:var(--brand)}.application-company{margin-top:4px;color:var(--ink2);font-size:11px}.application-meta{margin-top:5px;color:var(--ink3);font-size:10px}.alert-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid var(--border)}.alert-row:last-child{border-bottom:0}.alert-row-title{color:var(--ink);font-size:12px;font-weight:800}.alert-row-sub{margin-top:4px;color:var(--ink3);font-size:10.5px;text-transform:capitalize}.alert-row .account-inline-actions{justify-content:flex-end}.profile-editor-form{max-width:920px}.dash-page .text-link{color:var(--brand);font-size:10.5px;font-weight:800;text-decoration:none}.dash-page .text-link:hover{text-decoration:underline}
  @media(max-width:860px){.alert-row{grid-template-columns:minmax(0,1fr) auto}.alert-row .account-inline-actions{grid-column:1/-1;justify-content:flex-start}.application-row{align-items:flex-start}}
  @media(max-width:520px){.account-page-intro{align-items:flex-start;flex-direction:column}.account-page-intro .dash-btn{width:100%;justify-content:center}.application-row{display:block}.application-row .status-badge{margin-top:9px}.alert-row{display:block}.alert-row .status-badge{display:inline-flex;margin-top:8px}.alert-row .account-inline-actions{margin-top:10px}.alert-row .dash-btn{flex:1;justify-content:center}}

  /* Account Experience V2 — public user surfaces only. Existing class names remain compatible with the company dashboard. */.account-welcome{display:flex;align-items:end;justify-content:space-between;gap:18px;margin-bottom:17px;padding:22px 23px;border:1px solid #ded8ff;border-radius:15px;background:linear-gradient(120deg,#f6f3ff,#fff)}.account-welcome h2{margin:5px 0 7px;color:var(--ink);font:800 25px/1.1 'Space Grotesk',sans-serif;letter-spacing:-.6px}.account-welcome p{margin:0;color:var(--ink2);font-size:12px;line-height:1.55}.kpi-link{display:inline-block;margin-top:9px;color:var(--brand);font-size:10px;font-weight:800;text-decoration:none}.kpi-link:hover{text-decoration:underline}.account-dashboard-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(250px,1fr);gap:14px}.activity-list{display:grid}.activity-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:9px;padding:11px 0;border-bottom:1px solid var(--border);color:var(--ink);text-decoration:none}.activity-row:last-child{border-bottom:0}.activity-row:hover strong{color:var(--brand)}.activity-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--brand-soft);color:var(--brand)}.activity-row strong{display:block;overflow:hidden;color:var(--ink);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}.activity-row small{display:block;margin-top:3px;color:var(--ink3);font-size:10px}.activity-arrow{color:var(--brand);font-weight:900}.account-note{margin:10px 0 0;color:var(--ink3);font-size:10.5px;line-height:1.55}.account-note a{color:var(--brand);font-weight:800}.profile-mini-progress{margin-top:17px;padding-top:15px;border-top:1px solid var(--border)}.profile-mini-progress>strong{display:block;color:var(--ink);font-size:11.5px}.profile-mini-progress>span{display:block;margin-top:3px;color:var(--ink3);font-size:10px}.profile-mini-progress .dash-btn{margin-top:12px;font-size:10.5px}.profile-mini-progress .profile-progress{margin:8px 0 0}
  @media(max-width:860px){.account-dashboard-grid{grid-template-columns:1fr}.account-welcome{align-items:flex-start;flex-direction:column}.account-welcome .dash-btn{width:100%;justify-content:center}}
  @media(max-width:520px){.account-welcome{padding:18px 16px}.account-welcome h2{font-size:22px}}
  @media(max-width:860px){.dash-page{padding:20px 14px 86px!important}.dash-userbar{margin:0 -1px 12px}.dash-userbar-actions .dash-userbar-link{font-size:10px}.dash-shell{border-radius:14px}.dash-main{padding:22px 17px 54px}.dash-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.account-action-grid{grid-template-columns:1fr}.dash-mobile-nav{padding:10px 5px}}
  @media(max-width:520px){.dash-userbar{align-items:flex-start;padding:13px}.dash-userbar-actions{gap:7px}.dash-avatar{width:30px;height:30px}.dash-userbar-name{font-size:15px}.dash-title{font-size:22px}.dash-kpi{padding:13px}.dash-kpi-val{font-size:24px}.dash-main{padding-left:13px;padding-right:13px}.dash-card{padding:15px}.dash-page .pj-row{display:block}.dash-page .pj-group+.pj-group{margin-top:13px}.dash-row{align-items:flex-start}.account-section-heading{display:block}}
  `;
