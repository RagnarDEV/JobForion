// Shared job-card styling for homepage, directories, similar jobs, saved jobs and search pages.
// ONE responsive layout for every appearance of a job card:
//   • phone  (<640px)   — stacked: logo + text on top, meta / salary / save on a footer row
//   • tablet/desktop    — horizontal: text block on the left, salary + meta + save on the right
// Type scale is deliberately readable (title 15–16px, tags ≥ 11.5px) — the previous
// 9–12px sizes were below comfortable reading size on phones.
// Motion is minimal: colour/shadow transitions only, no entrance animation, no shimmer,
// no scaling; nothing moves on touch devices.
export const JOB_CARD_CSS = `
.jobs-list{display:flex;flex-direction:column;gap:12px}
.job-card{border:1px solid var(--border);border-radius:var(--r,12px);display:block;color:inherit;transition:border-color .15s ease,box-shadow .15s ease;position:relative;overflow:hidden;background:var(--surface);contain:layout paint style}
.job-card:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.card-inner{padding:calc(16px * var(--density-scale,1)) calc(18px * var(--density-scale,1));display:flex;flex-direction:column;gap:12px}
.card-row1{display:flex;align-items:flex-start;gap:14px;color:inherit;text-decoration:none;min-width:0;outline:none;-webkit-tap-highlight-color:transparent}
.card-row1:focus-visible{border-radius:8px;box-shadow:0 0 0 3px var(--brand-soft)}
.co-logo{width:52px;height:52px;border-radius:12px;background:#fff;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--brand);overflow:hidden;flex-shrink:0}
.co-logo img{width:100%;height:100%;object-fit:contain;padding:7px}
.card-body{flex:1;min-width:0}
.card-badges{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}
.cat-dot{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:var(--cat-color,var(--brand))}
.cat-dot .dot{width:6px;height:6px;border-radius:50%;background:var(--cat-color,var(--brand))}
.job-title-card{font-family:var(--font-heading,sans-serif);font-size:16px;font-weight:700;color:var(--ink);line-height:1.35;margin-bottom:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.job-card:hover .job-title-card{color:var(--brand)}
.job-co-card{font-size:13.5px;color:var(--ink2);font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:5px;min-width:0}
.verified-ico{display:inline-flex;color:var(--brand)}
.job-meta-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.card-right{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:12px;border-top:1px solid var(--border)}
.card-secondary-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;min-width:0;flex:1}
.card-time-corner,.job-location-v2{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--ink3);min-width:0}
.job-location-v2{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-time-corner{white-space:nowrap}
.salary-badge{font-family:var(--font-mono);font-size:12.5px;font-weight:800;color:var(--salary);background:rgba(45,173,105,.09);border:1px solid rgba(45,173,105,.18);padding:5px 10px;border-radius:8px;white-space:nowrap}
.act-btn{width:40px;height:40px;border-radius:10px;background:var(--surface);border:1px solid var(--border);color:var(--ink3);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s;position:relative;z-index:1;flex-shrink:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.act-btn:hover,.act-btn.saved{background:var(--brand-soft);border-color:var(--brand);color:var(--brand)}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;line-height:1.2;padding:4px 9px;border-radius:20px;font-weight:700;white-space:nowrap}
.tag-remote{background:rgba(45,173,105,.1);color:#1c7a4b;border:1px solid rgba(45,173,105,.2)}
.tag-hybrid{background:rgba(217,154,34,.12);color:#8f5d00;border:1px solid rgba(217,154,34,.22)}
.tag-onsite,.tag-type{background:var(--surface2);color:var(--ink2);border:1px solid var(--border)}
.tag-new,.tag-hot,.tag-pinned{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:1.2;padding:4px 9px;font-weight:800;letter-spacing:.2px;border-radius:20px;border:none}
.tag-new{background:var(--pastel-blue);color:var(--brand)}
.tag-hot{background:var(--pastel-yellow);color:#8f5d00}
.related-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r,12px);padding:14px 16px;display:flex;align-items:center;gap:14px;transition:border-color .15s,box-shadow .15s;text-decoration:none;-webkit-tap-highlight-color:transparent}
.related-card:hover{border-color:var(--brand);box-shadow:0 6px 16px rgba(48,31,121,.07)}
.related-logo{width:42px;height:42px;border-radius:10px;background:#fff;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--brand);overflow:hidden;flex-shrink:0}
.related-logo img{width:100%;height:100%;object-fit:contain;padding:5px}
.related-info{flex:1;min-width:0}
.related-jt{font-size:14.5px;font-weight:700;color:var(--ink);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.related-co{font-size:13px;color:var(--ink2)}
.related-sal{font-family:var(--font-mono);font-size:12.5px;font-weight:800;color:var(--salary);white-space:nowrap}
/* Admin-controlled Job Card Styles — values arrive as validated CSS variables. */
.job-card .job-title-card{color:var(--card-title-color,var(--ink))}.job-card:hover .job-title-card{color:var(--card-title-color,var(--brand))}.job-card .job-co-card{color:var(--card-company-color,#767184)}.job-card .card-time-corner,.job-card .job-location-v2{color:var(--card-meta-color,#8c879a)}.job-card .salary-badge{color:var(--card-salary-color,#2b9d68)}.job-card .card-right{border-top-color:color-mix(in srgb,var(--card-accent-color,var(--border)) 28%,var(--border))}.job-card .jt-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid transparent}.job-card .jt-badge-icon{width:12px;height:12px}.jt-mini-icon{display:inline-flex;align-items:center;justify-content:center;color:var(--card-accent-color,var(--brand));flex-shrink:0}.jct-template-classic{border-radius:var(--r,11px)}.jct-template-highlight{border-radius:var(--radius-card,var(--r,11px))}.jct-template-spotlight{border-radius:var(--radius-card,var(--r,11px));background-clip:border-box}.jct-template-promoted{border-radius:14px}.jct-template-promoted .job-title-card{letter-spacing:-.1px}.jct-accent-top:before,.jct-accent-left:before{content:'';position:absolute;pointer-events:none;background:var(--card-accent-color,var(--brand));z-index:1;opacity:.9}.jct-accent-top:before{left:0;right:0;top:0;height:4px}.jct-accent-left:before{left:0;top:0;bottom:0;width:4px}.jct-accent-both:before{content:'';position:absolute;pointer-events:none;inset:0;border-top:4px solid var(--card-accent-color,var(--brand));border-left:4px solid var(--card-accent-color,var(--brand));z-index:1;opacity:.9}.jct-hover-none:hover{transform:none!important;box-shadow:inherit!important}.jct-hover-lift:hover{transform:translateY(-1px)}.jct-hover-glow:hover{border-color:var(--card-accent-color,var(--brand));box-shadow:0 12px 28px color-mix(in srgb,var(--card-accent-color,var(--brand)) 20%,transparent);transform:translateY(-1px)}.jct-template-spotlight .co-logo,.jct-template-promoted .co-logo{box-shadow:0 0 0 3px color-mix(in srgb,var(--card-accent-color,var(--brand)) 13%,transparent)}.jct-template-spotlight .jt-badge,.jct-template-promoted .jt-badge{font-weight:850}.jct-template-highlight .jt-badge{box-shadow:0 2px 8px color-mix(in srgb,var(--card-accent-color,var(--brand)) 12%,transparent)}.related-card .related-info>div:first-child{color:var(--card-title-color,var(--ink))!important}.related-card .related-info>div:nth-child(2) span{color:var(--card-company-color,var(--brand))!important}.related-card .related-info .salary-tier-badge{color:inherit!important}.related-card .related-jt,.related-card .related-co{color:var(--card-title-color,var(--ink))}.related-card .jt-mini-icon{color:var(--card-accent-color,var(--brand))}

/* ── Desktop / tablet: text block left, salary + meta + save right ── */
@media(min-width:768px){
  .card-inner{flex-direction:row;align-items:center;gap:22px}
  .card-inner>.card-row1{flex:1;min-width:0}
  .card-right{flex:0 0 auto;flex-direction:column;align-items:flex-end;justify-content:center;gap:10px;padding-top:0;border-top:0;min-width:176px}
  .card-secondary-meta{flex:0 0 auto;justify-content:flex-end;flex-direction:column;align-items:flex-end;gap:4px}
  .job-location-v2{max-width:190px}
  .card-right .act-btn{width:36px;height:36px}
}
/* ── Phone ── */
@media(max-width:640px){
  .jobs-list{gap:10px}
  .card-inner{padding:14px;gap:10px}
  .card-row1{gap:12px}
  .co-logo{width:46px!important;height:46px!important}
  .job-title-card{font-size:15px}
  .job-co-card{font-size:13px;margin-bottom:6px}
  .card-right{padding-top:10px}
  .card-secondary-meta{gap:4px 12px}
  .job-location-v2{max-width:100%}
  .salary-badge{font-size:12px;padding:5px 9px}
  .related-card{padding:12px}
  .related-sal{display:none}
  .related-jt{font-size:14px}
}
/* Hover lift only where a real pointer exists, and never when motion is reduced. */
@media (hover:hover) and (pointer:fine){.job-card:hover{border-color:var(--brand);box-shadow:0 8px 20px rgba(48,31,121,.08)}}
@media (hover:none){.jct-hover-lift:hover,.jct-hover-glow:hover{transform:none!important}}
@media (prefers-reduced-motion:reduce){.job-card,.related-card,.act-btn{transition:none!important}.jct-hover-lift:hover,.jct-hover-glow:hover{transform:none!important}}
`;
