// src/styles/job-card-css.js
// The rich job-card styling (jobCardSSR in components/job-card.js) was
// previously only defined inline inside pages/home.js's own <style>
// block — meaning every other page that renders job cards through
// baseLayout() (job-page.js's "Similar Jobs", and every seo-pages.js
// directory/detail/search page) had no matching CSS at all, and would
// have rendered jobCardSSR's markup completely unstyled.
//
// Extracted here as the single source of truth so home.js and
// base-layout.js can both include the exact same rules — job cards look
// pixel-identical everywhere on the site, not just on the homepage.
export const JOB_CARD_CSS = `
.jobs-list{display:flex;flex-direction:column;gap:9px}
.job-card{border:1px solid var(--border);border-radius:13px;display:block;text-decoration:none;color:inherit;transition:all .2s;position:relative;overflow:hidden}
.job-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cat-color,var(--brand));opacity:.55;transition:opacity .2s,width .2s}
.job-card:hover{border-color:var(--cat-color,var(--brand));box-shadow:var(--shadow-lg);transform:translateY(-2px)}
.job-card:hover::before{opacity:1;width:5px}
.card-inner{padding:13px 14px}
.card-row1{display:flex;align-items:flex-start;gap:11px}
.co-logo{width:54px;height:54px;border-radius:12px;background:var(--brand-soft);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--brand);overflow:hidden;flex-shrink:0}
.co-logo img{width:100%;height:100%;object-fit:contain;padding:8px}
.card-body{flex:1;min-width:0}
.card-badges{display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap}
.cat-dot{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:var(--cat-color,var(--brand))}
.cat-dot .dot{width:6px;height:6px;border-radius:50%;background:var(--cat-color,var(--brand))}
.job-title-card{font-size:14px;font-weight:700;color:var(--ink);line-height:1.3;margin-bottom:3px;transition:color .2s}
.job-card:hover .job-title-card{color:var(--cat-color,var(--brand))}
.job-co-card{font-size:11.5px;color:var(--ink2);font-weight:600;margin-bottom:7px;display:flex;align-items:center;gap:5px}
.verified-ico{font-size:11px}
.job-meta-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.tag-loc{background:var(--surface2);color:var(--ink2);border:1px solid var(--border2)}
.card-right{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(18,22,43,.06)}
.card-time-corner{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:var(--ink3)}
.salary-badge{font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--salary);background:rgba(15,174,121,.08);border:1px solid rgba(15,174,121,.18);padding:4px 11px;border-radius:8px;white-space:nowrap}
.act-btn{width:30px;height:30px;border-radius:8px;background:rgba(255,255,255,.6);border:1px solid var(--border2);color:var(--ink3);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;position:relative;z-index:1}
.act-btn:hover{background:var(--brand-soft);color:var(--brand);transform:scale(1.08)}
.act-btn.saved{background:rgba(245,166,35,.12);border-color:var(--amber);color:var(--amber)}
`;
