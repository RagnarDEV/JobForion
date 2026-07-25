// src/styles/shared-css.js
// Design tokens + component CSS shared by every server-rendered page.

export const SHARED_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#F6F7FB;--bg2:#F0F2F8;--surface:#FFFFFF;--surface2:#FAFBFD;
  --border:#E6E9F0;--border2:#D8DEEA;
  --ink:#12162B;--ink2:#525A72;--ink3:#8890A4;
  --brand:#3556FF;--brand2:#7C3AED;--brand-soft:#EEF1FF;
  --navy:#0B1220;--navy2:#141D34;--navy-border:#22304F;--navy-ink2:#9AA6C4;
  --green:#0FAE79;--amber:#F5A623;--coral:#FF5C7A;--cyan:#0EA5C4;--pink:#D6489B;
  --pastel-blue:#E9F1FF;--pastel-yellow:#FFF6DC;--pastel-pink:#FDEBF4;--pastel-green:#E8F9F1;
  --salary:#0FAE79;
  --r:14px;--shadow:0 2px 10px rgba(18,22,43,.05);--shadow-lg:0 16px 40px rgba(18,22,43,.12);
}
html{scroll-behavior:smooth}
body{font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;line-height:1.6;-webkit-font-smoothing:antialiased}
h1,h2,h3,.font-display{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800}
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:var(--bg2)}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
a{color:inherit;text-decoration:none}
button{font-family:inherit}
@keyframes pulse-dot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.6)}}
@keyframes fadeInUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes skeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes toast-bar{from{width:100%}to{width:0%}}
@keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}

/* ── NAV (dark navy, site-wide) ── */
.nav{background:var(--navy);border-bottom:1px solid var(--navy-border);padding:0 24px;height:66px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:200}
.nav-logo{font-family:'Plus Jakarta Sans',sans-serif;font-size:21px;font-weight:800;letter-spacing:-.5px;color:#fff;display:flex;align-items:center;gap:7px}
.nav-logo img{width:26px;height:26px;border-radius:7px}
.nav-logo .dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(15,174,121,.25)}
.nav-links{display:flex;align-items:center;gap:2px}
.nav-link{padding:9px 14px;border-radius:9px;font-size:14px;font-weight:600;color:var(--navy-ink2);transition:all .2s;border:none;background:none;cursor:pointer;font-family:inherit}
.nav-link:hover{color:#fff;background:rgba(255,255,255,.06)}
.nav-cta{background:var(--coral);color:#fff;border:none;border-radius:24px;padding:10px 20px;font-size:14px;font-weight:700;transition:all .2s;cursor:pointer;margin-left:10px;box-shadow:0 4px 14px rgba(255,92,122,.35)}
.nav-cta:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(255,92,122,.45)}
@media(max-width:860px){.nav-links .nav-link{display:none}}

/* ── MOBILE HEADER + MENU (shared, replaces old bottom tab bar) ── */
.mob-hdr{display:none;padding:0 16px;height:60px;background:var(--navy);align-items:center;justify-content:space-between;position:sticky;top:0;z-index:200;gap:10px}
.mob-logo{font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;font-weight:800;color:#fff;display:flex;align-items:center;gap:6px}
.mob-logo img{width:24px;height:24px;border-radius:6px}
.mob-btns{display:flex;gap:8px;align-items:center}
.mob-cta{background:var(--coral);color:#fff;border:none;border-radius:20px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer}
.mob-burger{width:36px;height:36px;border-radius:9px;border:1px solid var(--navy-border);background:rgba(255,255,255,.06);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px}
.mob-menu{display:none;position:sticky;top:60px;z-index:199;background:var(--navy2);border-bottom:1px solid var(--navy-border);padding:8px;animation:slideDown .2s ease}
.mob-menu.open{display:block}
.mob-menu a,.mob-menu button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:12px 14px;border-radius:9px;color:#fff;font-size:14px;font-weight:600;border:none;background:none;cursor:pointer;font-family:inherit}
.mob-menu a:active,.mob-menu button:active{background:rgba(255,255,255,.08)}
@media(max-width:860px){.mob-hdr{display:flex}.nav{display:none !important}}

/* ── FOOTER (dark navy, multi-column, site-wide) ── */
.site-footer{background:var(--navy);color:var(--navy-ink2);padding:52px 24px 28px;margin-top:40px}
.sf-inner{max-width:1180px;margin:0 auto}
.sf-top{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:32px;padding-bottom:36px;border-bottom:1px solid var(--navy-border)}
.sf-brand{display:flex;align-items:center;gap:8px;font-family:'Plus Jakarta Sans',sans-serif;font-size:20px;font-weight:800;color:#fff;margin-bottom:14px}
.sf-brand img{width:26px;height:26px;border-radius:7px}
.sf-desc{font-size:13px;line-height:1.75;max-width:280px;margin-bottom:18px}
.sf-social{display:flex;gap:10px}
.sf-social a{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid var(--navy-border);display:flex;align-items:center;justify-content:center;transition:all .2s}
.sf-social a:hover{background:var(--brand);border-color:var(--brand)}
.sf-social svg{width:15px;height:15px;fill:#fff}
.sf-col-title{font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#fff;margin-bottom:16px}
.sf-col a{display:block;font-size:13px;color:var(--navy-ink2);margin-bottom:12px;transition:color .2s}
.sf-col a:hover{color:#fff}
.sf-bottom{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding-top:22px;font-size:12px}
@media(max-width:768px){.sf-top{grid-template-columns:1fr 1fr;gap:26px}.sf-brand{margin-top:0}}
@media(max-width:480px){.sf-top{grid-template-columns:1fr}}

/* ── AD PLACEHOLDER SLOTS (no live ad code — instructions only) ── */
.ad-slot{border:1.5px dashed var(--border2);border-radius:12px;padding:14px;text-align:center;margin:16px 0;background:var(--surface2)}
.ad-slot-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink3);margin-bottom:4px}
.ad-slot-hint{font-size:11px;color:var(--ink3)}
.ad-slot-live{border:none;padding:0;background:transparent;display:flex;justify-content:center;overflow:hidden}

/* ── PINNED BADGE (shared across every job-card renderer) ── */
.tag-pinned{background:var(--brand-soft);color:var(--brand);border:none;font-size:10px;padding:3px 9px;font-weight:800;letter-spacing:.3px;border-radius:20px}

/* ── POST A JOB MODAL (shared, works on every page) ── */
.pj-overlay{display:none;position:fixed;inset:0;background:rgba(11,18,32,.6);backdrop-filter:blur(3px);z-index:500;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto}
.pj-overlay.open{display:flex;animation:fadeIn .2s ease}
.pj-modal{background:var(--surface);border-radius:18px;max-width:560px;width:100%;padding:28px 26px 26px;box-shadow:var(--shadow-lg);position:relative;margin:auto}
.pj-close{position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:9px;border:1px solid var(--border2);background:var(--surface2);color:var(--ink2);cursor:pointer;font-size:15px}
.pj-title{font-family:'Plus Jakarta Sans',sans-serif;font-size:21px;font-weight:700;color:var(--ink);margin-bottom:4px}
.pj-sub{font-size:13px;color:var(--ink3);margin-bottom:20px}
.pj-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pj-group{margin-bottom:14px}
.pj-label{font-size:11px;font-weight:700;color:var(--ink2);margin-bottom:6px;display:block;letter-spacing:.4px;text-transform:uppercase}
.pj-input,.pj-select,.pj-textarea{width:100%;background:var(--surface2);border:1.5px solid var(--border2);border-radius:10px;padding:11px 13px;color:var(--ink);font-size:13.5px;font-family:inherit;outline:none;transition:all .2s}
.pj-input:focus,.pj-select:focus,.pj-textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.pj-textarea{resize:vertical;min-height:80px}
.pj-submit{width:100%;background:var(--brand);color:#fff;padding:13px;border-radius:10px;font-size:14.5px;font-weight:700;border:none;cursor:pointer;margin-top:6px;transition:all .2s}
.pj-submit:hover{background:#2842e0}
.pj-submit:disabled{opacity:.6;cursor:default}
.pj-success{text-align:center;padding:20px 0}
.pj-success .ico{font-size:44px;margin-bottom:10px}
@media(max-width:480px){.pj-row{grid-template-columns:1fr}}
`;
