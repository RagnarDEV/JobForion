// src/pages/admin/affiliate.js
// Affiliate Manager screen: settings & placements, KPIs, programs, offers,
// conversions (manual + CSV), placement performance. Returns inner HTML only —
// adminShell() wraps it. Every dynamic value is escaped.

import { escapeHtml } from '../../lib/directory/entities.js';
import { getSettings } from '../../lib/platform/settings.js';
import {
  PLACEMENTS, PLACEMENT_KEYS, ICON_KEYS, CURRENCIES, CONVERSION_STATUSES,
  listPrograms, listOffers, getOfferById, listConversions, getAffiliateStats,
  formatMinor, earningsPerClick,
} from '../../lib/affiliate/affiliate.js';
import { iconPlus, iconTrash2, iconEdit3, iconExternalLink, iconMousePointerClick, iconCoins, iconTrendingUp, iconUpload, iconCheck } from '../../assets/icons.js';

const v = (x, d = '') => escapeHtml(x === null || x === undefined ? d : String(x));
const checked = (b) => (b ? ' checked' : '');
const selected = (b) => (b ? ' selected' : '');
const dateOnly = (x) => (x ? String(x).slice(0, 10) : '');

const CSS = `
.aff-wrap .aff-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.aff-wrap .aff-kpi{display:flex;flex-direction:column;gap:4px}
.aff-wrap .aff-kpi span{font-size:12px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:flex;align-items:center;gap:6px}
.aff-wrap .aff-kpi strong{font-family:'Space Grotesk',sans-serif;font-size:24px;color:var(--ink)}
.aff-wrap .aff-kpi small{font-size:12px;color:var(--ink3)}
.aff-wrap h2{font-size:16px;margin:0 0 4px;color:var(--ink)}
.aff-wrap .aff-sub{font-size:13px;color:var(--ink3);margin-bottom:14px;line-height:1.55}
.aff-wrap .aff-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.aff-wrap label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:700;color:var(--ink2)}
.aff-wrap .adm-input{width:100%;font-size:14px}
.aff-wrap textarea.adm-input{min-height:70px;resize:vertical}
.aff-wrap .aff-check{flex-direction:row;align-items:center;gap:8px;font-weight:600;color:var(--ink)}
.aff-wrap .aff-checks{display:flex;flex-wrap:wrap;gap:8px 18px;padding:2px 0}
.aff-wrap .aff-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.aff-wrap table{width:100%;border-collapse:collapse;font-size:13px}
.aff-wrap th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--ink3);padding:8px 6px;border-bottom:1.5px solid var(--border)}
.aff-wrap td{padding:10px 6px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--ink2)}
.aff-wrap td strong{color:var(--ink)}
.aff-wrap .aff-pill{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:20px;background:var(--surface2);color:var(--ink2)}
.aff-wrap .aff-pill.ok{background:rgba(45,173,105,.12);color:var(--green)}
.aff-wrap .aff-pill.warn{background:rgba(217,154,34,.14);color:var(--amber)}
.aff-wrap .aff-pill.off{background:var(--surface2);color:var(--ink3)}
.aff-wrap .aff-inline{display:inline}
.aff-wrap code{font-size:12px;background:var(--surface2);padding:2px 6px;border-radius:6px;word-break:break-all}
.aff-wrap .aff-card{margin-bottom:16px}
.aff-wrap .aff-scroll{overflow-x:auto}
`;

function statusPill(s, onLabel = 'active') { return `<span class="aff-pill ${s === onLabel || s === 'approved' ? 'ok' : s === 'pending' ? 'warn' : 'off'}">${v(s)}</span>`; }

function settingsCard(s) {
  const placementChecks = PLACEMENT_KEYS.map((k) => `<label class="aff-check"><input type="checkbox" name="${PLACEMENTS[k].settingKey}" value="1"${checked(s[PLACEMENTS[k].settingKey] === '1')}> ${v(PLACEMENTS[k].label)}</label>`).join('');
  return `<form class="adm-card aff-card" method="POST" action="/admin/affiliate/settings">
    <h2>Display settings</h2>
    <p class="aff-sub">Nothing is shown to visitors until the master switch is on <b>and</b> an active offer targets an enabled placement. Switch placements on or off at any time — no redeploy.</p>
    <label class="aff-check"><input type="checkbox" name="affiliate_enabled" value="1"${checked(s.affiliate_enabled === '1')}> <b>Enable affiliate offers site-wide</b></label>
    <div class="aff-checks" style="margin-top:12px">${placementChecks}</div>
    <div class="aff-grid" style="margin-top:12px">
      <label>Offers per placement<input class="adm-input" type="number" name="aff_max_offers_per_placement" min="1" max="4" value="${v(s.aff_max_offers_per_placement, 2)}"></label>
      <label>Click-detail rows per day (write budget)<input class="adm-input" type="number" name="aff_detail_clicks_per_day" min="0" max="20000" value="${v(s.aff_detail_clicks_per_day, 2000)}"></label>
      <label>Keep click detail (days)<input class="adm-input" type="number" name="aff_detail_retention_days" min="7" max="365" value="${v(s.aff_detail_retention_days, 90)}"></label>
    </div>
    <label style="margin-top:12px">Disclosure line (shown under every offer block)<textarea class="adm-input" name="affiliate_disclosure" maxlength="300">${v(s.affiliate_disclosure)}</textarea></label>
    <div class="aff-actions"><button class="adm-btn adm-btn-primary" type="submit">Save settings</button></div>
  </form>`;
}

function programForm(p = null) {
  return `<form class="adm-card aff-card" method="POST" action="/admin/affiliate/programs/save">
    <input type="hidden" name="program_id" value="${v(p?.id)}">
    <h2>${p ? 'Edit program' : 'Add a program'}</h2>
    <p class="aff-sub">A program is one partner account (Amazon Associates, an Impact / CJ / ShareASale advertiser, a direct deal). Offers belong to a program; pausing a program pauses all its offers.</p>
    <div class="aff-grid">
      <label>Name<input class="adm-input" name="name" required maxlength="80" value="${v(p?.name)}" placeholder="Coursera via Impact"></label>
      <label>Network<input class="adm-input" name="network" maxlength="60" value="${v(p?.network)}" placeholder="Impact, CJ, direct …"></label>
      <label>Commission note<input class="adm-input" name="commission_note" maxlength="200" value="${v(p?.commission_note)}" placeholder="e.g. 20% first purchase, 30-day cookie"></label>
      <label>Status<select class="adm-input" name="status"><option value="active"${selected(!p || p.status === 'active')}>Active</option><option value="inactive"${selected(p?.status === 'inactive')}>Inactive</option></select></label>
    </div>
    <div class="aff-actions"><button class="adm-btn adm-btn-primary" type="submit">${iconPlus({ size: 14 })} ${p ? 'Save program' : 'Add program'}</button>${p ? '<a class="adm-btn" href="/admin/affiliate">Cancel</a>' : ''}</div>
  </form>`;
}

function offerForm(programs, o = null) {
  const places = new Set(String(o?.placements || '').split(',').filter(Boolean));
  const placementChecks = PLACEMENT_KEYS.map((k) => `<label class="aff-check"><input type="checkbox" name="placements" value="${k}"${checked(o ? places.has(k) : true)}> ${v(PLACEMENTS[k].label)}</label>`).join('');
  if (!programs.length) return `<div class="adm-card aff-card"><h2>Add an offer</h2><p class="aff-sub">Create a program first, then add offers to it.</p></div>`;
  return `<form class="adm-card aff-card" method="POST" action="/admin/affiliate/offers/save">
    <input type="hidden" name="offer_id" value="${v(o?.id)}">
    <h2>${o ? 'Edit offer' : 'Add an offer'}</h2>
    <p class="aff-sub">The <b>destination</b> holds your affiliate id and stays private — visitors only ever see <code>/go/your-slug</code>. You may use <code>{click_id}</code>, <code>{offer}</code>, <code>{placement}</code> in it (e.g. <code>?subid={click_id}</code>) so the network reports which click produced a sale.</p>
    <div class="aff-grid">
      <label>Program<select class="adm-input" name="program_id" required>${programs.map((p) => `<option value="${p.id}"${selected(Number(o?.program_id) === Number(p.id))}>${v(p.name)}</option>`).join('')}</select></label>
      <label>Title (shown to visitors)<input class="adm-input" name="title" required maxlength="90" value="${v(o?.title)}" placeholder="Python for Everybody — free to start"></label>
      <label>Slug (/go/…)<input class="adm-input" name="slug" maxlength="80" value="${v(o?.slug)}" placeholder="python-course"></label>
      <label>Badge (optional)<input class="adm-input" name="badge" maxlength="24" value="${v(o?.badge)}" placeholder="Course"></label>
      <label>Button text<input class="adm-input" name="cta_label" maxlength="28" value="${v(o?.cta_label, 'Learn more')}"></label>
      <label>Icon<select class="adm-input" name="icon_key">${ICON_KEYS.map((k) => `<option value="${k}"${selected((o?.icon_key || 'tag') === k)}>${k}</option>`).join('')}</select></label>
    </div>
    <label style="margin-top:12px">Short description<textarea class="adm-input" name="description" maxlength="220">${v(o?.description)}</textarea></label>
    <label style="margin-top:12px">Destination URL (with your affiliate id)<input class="adm-input" name="destination_url" required maxlength="1000" value="${v(o?.destination_url)}" placeholder="https://partner.example/course?aff=YOURID&subid={click_id}"></label>
    <div style="margin-top:12px"><div style="font-size:12.5px;font-weight:700;color:var(--ink2);margin-bottom:6px">Show on</div><div class="aff-checks">${placementChecks}</div></div>
    <div class="aff-grid" style="margin-top:12px">
      <label>Only for categories (optional, comma-separated keys)<input class="adm-input" name="category_keys" value="${v(o?.category_keys)}" placeholder="developer, data"></label>
      <label>Only for skills (optional, comma-separated)<input class="adm-input" name="skill_keys" value="${v(o?.skill_keys)}" placeholder="python, sql"></label>
      <label>Weight (1–10, higher shows more)<input class="adm-input" type="number" name="weight" min="1" max="10" value="${v(o?.weight, 1)}"></label>
      <label>Status<select class="adm-input" name="status"><option value="active"${selected(!o || o.status === 'active')}>Active</option><option value="paused"${selected(o?.status === 'paused')}>Paused</option></select></label>
      <label>Starts (optional)<input class="adm-input" type="date" name="starts_at" value="${v(dateOnly(o?.starts_at))}"></label>
      <label>Ends (optional)<input class="adm-input" type="date" name="ends_at" value="${v(dateOnly(o?.ends_at))}"></label>
    </div>
    <p class="aff-sub" style="margin:10px 0 0">Leave category and skill fields empty to show the offer on every matching page; fill them to show it only where it is relevant (relevant offers are boosted 4×).</p>
    <div class="aff-actions"><button class="adm-btn adm-btn-primary" type="submit">${iconCheck({ size: 14 })} ${o ? 'Save offer' : 'Add offer'}</button>${o ? '<a class="adm-btn" href="/admin/affiliate">Cancel</a>' : ''}</div>
  </form>`;
}

function offersTable(offers, statsByOffer) {
  if (!offers.length) return `<div class="adm-card aff-card"><h2>Offers</h2><p class="aff-sub">No offers yet.</p></div>`;
  const rows = offers.map((o) => {
    const st = statsByOffer.get(o.id) || { clicks: 0, approved: 0, pending: 0, earned: {} };
    const earned = Object.entries(st.earned).map(([c, m]) => formatMinor(m, c)).join(' + ') || '—';
    const places = String(o.placements || '').split(',').filter(Boolean).map((p) => PLACEMENTS[p]?.label || p).join(', ') || '—';
    const live = o.status === 'active' && o.program_status === 'active';
    return `<tr>
      <td><strong>${v(o.title)}</strong><br><small>${v(o.program_name)} · <code>/go/${v(o.slug)}</code></small></td>
      <td>${statusPill(live ? 'active' : (o.status === 'active' ? 'program off' : o.status))}</td>
      <td><small>${v(places)}${o.category_keys || o.skill_keys ? `<br>Targets: ${v([o.category_keys, o.skill_keys].filter(Boolean).join(' · '))}` : ''}</small></td>
      <td>${st.clicks.toLocaleString('en-US')}</td>
      <td>${st.approved} <small>(+${st.pending} pending)</small></td>
      <td>${v(earned)}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap">
        <a class="adm-btn-sm" style="color:var(--ink2)" href="/go/${v(o.slug)}" target="_blank" rel="noopener" title="Opens the live redirect (your admin clicks are not counted)">${iconExternalLink({ size: 13 })} Test</a>
        <a class="adm-btn-sm" style="color:var(--brand)" href="/admin/affiliate?edit_offer=${o.id}#offer-form">${iconEdit3({ size: 13 })} Edit</a>
        <form class="aff-inline" method="POST" action="/admin/affiliate/offers/status"><input type="hidden" name="id" value="${o.id}"><input type="hidden" name="status" value="${o.status === 'active' ? 'paused' : 'active'}"><button class="adm-btn-sm" style="color:var(--ink2)" type="submit">${o.status === 'active' ? 'Pause' : 'Resume'}</button></form>
        <form class="aff-inline" method="POST" action="/admin/affiliate/offers/delete" onsubmit="return confirm('Delete this offer? Its link /go/${v(o.slug)} will stop working.')"><input type="hidden" name="id" value="${o.id}"><button class="adm-btn-sm" type="submit">${iconTrash2({ size: 13 })}</button></form>
      </div></td></tr>`;
  }).join('');
  return `<div class="adm-card aff-card aff-scroll"><h2>Offers</h2><p class="aff-sub">Clicks and earnings for the selected period.</p>
    <table><thead><tr><th>Offer</th><th>Status</th><th>Placements</th><th>Clicks</th><th>Sales</th><th>Earned</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function programsTable(programs, offers) {
  if (!programs.length) return '';
  const count = (id) => offers.filter((o) => Number(o.program_id) === Number(id)).length;
  const rows = programs.map((p) => `<tr>
    <td><strong>${v(p.name)}</strong><br><small>${v(p.network || '—')}${p.commission_note ? ` · ${v(p.commission_note)}` : ''}</small></td>
    <td>${statusPill(p.status)}</td><td>${count(p.id)}</td>
    <td><div style="display:flex;gap:6px;flex-wrap:wrap">
      <a class="adm-btn-sm" style="color:var(--brand)" href="/admin/affiliate?edit_program=${p.id}#program-form">${iconEdit3({ size: 13 })} Edit</a>
      <form class="aff-inline" method="POST" action="/admin/affiliate/programs/delete" onsubmit="return confirm('Delete this program?')"><input type="hidden" name="id" value="${p.id}"><button class="adm-btn-sm" type="submit">${iconTrash2({ size: 13 })}</button></form>
    </div></td></tr>`).join('');
  return `<div class="adm-card aff-card aff-scroll"><h2>Programs</h2><table><thead><tr><th>Program</th><th>Status</th><th>Offers</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function conversionsCard(offers, conversions) {
  const offerOptions = offers.map((o) => `<option value="${o.id}">${v(o.title)}</option>`).join('');
  const rows = conversions.map((c) => `<tr>
    <td>${v(String(c.occurred_at || '').slice(0, 10))}</td><td>${v(c.offer_title || '—')}${c.click_id ? `<br><small><code>${v(c.click_id)}</code></small>` : ''}</td>
    <td><strong>${v(formatMinor(c.amount_minor, c.currency))}</strong></td><td>${statusPill(c.status)}</td><td><small>${v(c.note)}</small></td>
    <td><div style="display:flex;gap:6px;flex-wrap:wrap">${CONVERSION_STATUSES.filter((s) => s !== c.status).map((s) => `<form class="aff-inline" method="POST" action="/admin/affiliate/conversions/status"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="status" value="${s}"><button class="adm-btn-sm" style="color:var(--ink2)" type="submit">${v(s)}</button></form>`).join('')}
    <form class="aff-inline" method="POST" action="/admin/affiliate/conversions/delete" onsubmit="return confirm('Delete this record?')"><input type="hidden" name="id" value="${c.id}"><button class="adm-btn-sm" type="submit">${iconTrash2({ size: 13 })}</button></form></div></td></tr>`).join('');
  return `<div class="adm-card aff-card"><h2>Conversions &amp; earnings</h2>
    <p class="aff-sub">The site never invents earnings: record a sale from your network's dashboard (or import its CSV). Only <b>approved</b> amounts count as earnings.</p>
    <form method="POST" action="/admin/affiliate/conversions/add">
      <div class="aff-grid">
        <label>Offer<select class="adm-input" name="offer_id"><option value="">— from click ID —</option>${offerOptions}</select></label>
        <label>Click ID (optional)<input class="adm-input" name="click_id" maxlength="40" placeholder="matches {click_id}"></label>
        <label>Amount<input class="adm-input" name="amount" required inputmode="decimal" placeholder="12.50"></label>
        <label>Currency<select class="adm-input" name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label>Status<select class="adm-input" name="status">${CONVERSION_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></label>
        <label>Date<input class="adm-input" type="date" name="occurred_at"></label>
      </div>
      <label style="margin-top:12px">Note<input class="adm-input" name="note" maxlength="140"></label>
      <div class="aff-actions"><button class="adm-btn adm-btn-primary" type="submit">${iconCoins({ size: 14 })} Record conversion</button></div>
    </form>
    <hr style="border:0;border-top:1px solid var(--border);margin:18px 0">
    <form method="POST" action="/admin/affiliate/conversions/import" enctype="multipart/form-data">
      <p class="aff-sub" style="margin-bottom:8px"><b>Import CSV</b> — header row with <code>amount</code> and <code>click_id</code> or <code>offer</code> (slug); optional <code>currency, status, note, date</code>. Up to 500 rows.</p>
      <input class="adm-input" type="file" name="csv_file" accept=".csv,text/csv">
      <textarea class="adm-input" name="csv_text" placeholder="…or paste CSV here" style="margin-top:8px"></textarea>
      <div class="aff-actions"><button class="adm-btn" type="submit">${iconUpload({ size: 14 })} Import</button></div>
    </form>
    ${conversions.length ? `<div class="aff-scroll" style="margin-top:18px"><table><thead><tr><th>Date</th><th>Offer</th><th>Amount</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  </div>`;
}

function placementTable(stats) {
  if (!stats.byPlacement.length) return '';
  const max = Math.max(1, ...stats.byPlacement.map((p) => p.clicks));
  return `<div class="adm-card aff-card"><h2>Clicks by placement</h2>${stats.byPlacement.map((p) => `<div style="display:flex;align-items:center;gap:10px;margin:8px 0"><span style="width:150px;font-size:13px;color:var(--ink2);font-weight:600">${v(PLACEMENTS[p.placement]?.label || p.placement)}</span><div style="flex:1;background:var(--surface2);border-radius:6px;height:14px;overflow:hidden"><div style="width:${Math.round((p.clicks / max) * 100)}%;height:100%;background:var(--brand)"></div></div><b style="width:60px;text-align:right;font-size:13px">${p.clicks.toLocaleString('en-US')}</b></div>`).join('')}</div>`;
}

export async function renderAffiliateContent(env, url) {
  const days = [7, 30, 90].includes(parseInt(url.searchParams.get('days'), 10)) ? parseInt(url.searchParams.get('days'), 10) : 30;
  const [settings, programs, offers, conversions, stats] = await Promise.all([
    getSettings(env), listPrograms(env), listOffers(env), listConversions(env, 25), getAffiliateStats(env, days),
  ]);
  const editOffer = url.searchParams.get('edit_offer') ? await getOfferById(env, url.searchParams.get('edit_offer')) : null;
  const editProgram = programs.find((p) => String(p.id) === String(url.searchParams.get('edit_program'))) || null;
  const statsByOffer = new Map(stats.byOffer.map((r) => [r.offer_id, r]));
  const earningsText = Object.entries(stats.earnings).map(([c, m]) => formatMinor(m, c)).join(' + ') || '—';
  const epc = earningsPerClick(stats.totalClicks, stats.earnings);
  const liveOffers = offers.filter((o) => o.status === 'active' && o.program_status === 'active').length;

  return `<div class="adm-wrap aff-wrap"><style>${CSS}</style>
    <div class="adm-hdr"><div><div class="adm-title">Affiliate Manager</div><div class="adm-sub">Programs, offers, tracked links and earnings — all controlled from here.</div></div>
      <div style="display:flex;gap:6px">${[7, 30, 90].map((d) => `<a class="adm-btn${d === days ? ' adm-btn-primary' : ''}" href="/admin/affiliate?days=${d}">${d}d</a>`).join('')}</div></div>
    <div class="aff-kpis">
      <div class="adm-card aff-kpi"><span>${iconMousePointerClick({ size: 14 })} Clicks</span><strong>${stats.totalClicks.toLocaleString('en-US')}</strong><small>last ${days} days</small></div>
      <div class="adm-card aff-kpi"><span>${iconCoins({ size: 14 })} Approved earnings</span><strong>${v(earningsText)}</strong><small>${stats.approvedCount} approved sale${stats.approvedCount === 1 ? '' : 's'}</small></div>
      <div class="adm-card aff-kpi"><span>${iconTrendingUp({ size: 14 })} Earnings per click</span><strong>${v(epc || '—')}</strong><small>needs one currency</small></div>
      <div class="adm-card aff-kpi"><span>Live offers</span><strong>${liveOffers}</strong><small>${settings.affiliate_enabled === '1' ? 'site-wide display is ON' : 'site-wide display is OFF'}</small></div>
    </div>
    ${settingsCard(settings)}
    ${offersTable(offers, statsByOffer)}
    <div id="offer-form">${offerForm(programs, editOffer)}</div>
    ${placementTable(stats)}
    ${conversionsCard(offers, conversions)}
    ${programsTable(programs, offers)}
    <div id="program-form">${programForm(editProgram)}</div>
  </div>`;
}
