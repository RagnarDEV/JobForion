// src/pages/admin/live.js
// Live Analytics page content. adminShell() wraps it (see routes/admin/live.router.js).
//
// i18n: every string the browser script shows is declared ONCE below as a
// hidden text node, so the existing admin Arabic layer (lib/admin-i18n) can
// translate it server-side — the script just reads the translated text.
// Add the Arabic for new strings in src/lib/admin-i18n/ar/live.js.

import { LIVE_CSS, liveClientScript } from '../../components/admin/live-charts.js';
import {
  iconActivity, iconBriefcase, iconEye, iconGlobe, iconMonitor, iconMousePointerClick,
  iconPause, iconPlay, iconRefreshCw, iconSearch, iconSmartphone, iconTablet, iconUsers, iconZap,
} from '../../assets/icons.js';

const size = (fn, px = 14) => fn({ size: px });

// Client-side strings: key → English text (translated by the admin i18n layer).
const STRINGS = {
  loading: 'Loading…', no_data: 'No data yet', no_activity: 'No matching activity yet', unknown: 'Unknown',
  zero_results: 'zero-result', no_searches: 'No searches yet', window_since: 'Window since', window_capped: 'Latest events since',
  chart_label: 'Traffic over time', series_pv: 'Page views', series_jv: 'Job views', series_ap: 'Apply clicks',
  devices: 'Devices', dev_desktop: 'Desktop', dev_mobile: 'Mobile', dev_tablet: 'Tablet', dev_unknown: 'Unknown device',
  job: 'Job', views_short: 'views', applies_short: 'applies',
  ev_page_view: 'Page view', ev_job_view: 'Job view', ev_job_apply_click: 'Apply click', ev_search: 'Search',
  clear_filter: 'Clear filter',
  meter_sync: 'Job sync writes today', meter_events: 'Analytics rows written (estimate)', meter_polls: 'Live polls this session',
  sys_tracking: 'Tracking · sample rate', sys_db: 'Last query time', sys_sync: 'Last job sync', never: 'Never', on: 'On', off: 'Off',
  pause: 'Pause', resume: 'Resume', live_on: 'Live', paused: 'Paused', session_end: 'Stopped after 30 minutes — press Resume',
  signed_out: 'Signed out — reload and sign in again', retrying: 'Connection issue — retrying', load_failed: 'Could not load live data',
  note_live: 'Counted from the latest tracked events; updates every 15 seconds.',
  note_daily: 'Daily totals from the hourly aggregation; today may lag by up to an hour.',
};

function escText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderLiveContent() {
  const icons = {
    pv: size(iconEye), jv: size(iconBriefcase), ap: size(iconMousePointerClick), se: size(iconSearch), other: size(iconZap),
    desktop: size(iconMonitor), mobile: size(iconSmartphone), tablet: size(iconTablet), unknown: size(iconGlobe),
    pause: size(iconPause), play: size(iconPlay),
  };
  const textNodes = Object.entries(STRINGS).map(([k, v]) => `<span data-k="${k}">${escText(v)}</span>`).join('');
  const kpi = (id, label, icon, note = '', noteId = '') =>
    `<div class="lv-kpi"><span>${icon}${label}</span><strong id="${id}">—</strong><small${noteId ? ` id="${noteId}"` : ''}>${note}</small></div>`;

  return `<div class="admin-page lv-page"><style>${LIVE_CSS}</style>
  <div class="lv-head">
    <div>
      <div class="adm-eyebrow">REAL-TIME</div>
      <h1>${size(iconActivity, 22)} Live Analytics <span class="lv-badge off" id="lvBadge"><i></i>LIVE</span></h1>
      <p>What visitors are doing right now, built from the privacy-first tracking events the site already collects. Nothing new is stored for this view, and it stops polling when the tab is hidden or after 30 minutes.</p>
    </div>
    <div class="lv-tools">
      <span class="lv-status" id="lvStatus">Loading…</span>
      <button class="adm-btn" id="lvToggle" type="button">${size(iconPause)} Pause</button>
      <button class="adm-btn" id="lvRefresh" type="button">${size(iconRefreshCw)} Refresh</button>
    </div>
  </div>

  <div class="lv-kpis">
    ${kpi('kActive', 'Active now', size(iconUsers), 'Distinct sessions, last 5 min')}
    ${kpi('kRate', 'Views / min', size(iconActivity), 'Average, last 5 min')}
    ${kpi('kPv', 'Page views', size(iconEye), 'Last 24 h', '')}
    ${kpi('kJv', 'Job views', size(iconBriefcase), 'Last 24 h')}
    ${kpi('kAp', 'Apply clicks', size(iconMousePointerClick), 'Last 24 h')}
    ${kpi('kSe', 'Searches', size(iconSearch), '', 'kSeNote')}
  </div>

  <div class="lv-grid">
    <section class="adm-card lv-card lv-c8">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <div><h2>Traffic</h2><p style="margin:0" id="lvChartNote">Counted from the latest tracked events; updates every 15 seconds.</p></div>
        <div class="lv-seg" id="lvRange" role="group" aria-label="Range">
          <button type="button" data-r="1h" aria-pressed="true">1h</button>
          <button type="button" data-r="24h" aria-pressed="false">24h</button>
          <button type="button" data-r="7d" aria-pressed="false">7d</button>
          <button type="button" data-r="30d" aria-pressed="false">30d</button>
        </div>
      </div>
      <div class="lv-legend">
        <button type="button" class="lv-leg" data-s="pv" aria-pressed="true"><i class="lv-sw" style="background:var(--brand,#3556FF)"></i>Page views</button>
        <button type="button" class="lv-leg" data-s="jv" aria-pressed="true"><i class="lv-sw" style="background:var(--cyan,#0EA5C4)"></i>Job views</button>
        <button type="button" class="lv-leg" data-s="ap" aria-pressed="false"><i class="lv-sw" style="background:var(--green,#0FAE79)"></i>Apply clicks</button>
      </div>
      <div class="lv-chart-wrap" dir="ltr"><div id="lvChart"></div><div class="lv-tip" id="lvTip"></div></div>
      <div class="lv-note" id="lvWindow"></div>
    </section>

    <section class="adm-card lv-card lv-c4">
      <h2>Devices</h2><p>Page views by device, last 24 h.</p>
      <div class="lv-donut" id="lvDonut" dir="ltr"></div>
    </section>

    <section class="adm-card lv-card lv-c6">
      <h2>Live feed</h2><p>Newest activity first. Tap a page or country on the right to filter.</p>
      <div class="lv-chips" id="lvChips" role="group" aria-label="Filter">
        <button type="button" class="lv-chip" data-f="all" aria-pressed="true">All</button>
        <button type="button" class="lv-chip" data-f="pv" aria-pressed="false">Page views</button>
        <button type="button" class="lv-chip" data-f="jv" aria-pressed="false">Job views</button>
        <button type="button" class="lv-chip" data-f="ap" aria-pressed="false">Apply clicks</button>
        <button type="button" class="lv-chip" data-f="se" aria-pressed="false">Searches</button>
        <button type="button" class="lv-chip" id="lvClear" style="display:none"></button>
      </div>
      <div class="lv-feed" id="lvFeed" dir="ltr"></div>
    </section>

    <section class="adm-card lv-card lv-c6">
      <h2>Top pages</h2><p>Select a page to filter the live feed.</p>
      <div class="lv-bars" id="lvPages"></div>
      <div style="height:14px"></div>
      <h2>Top countries</h2><p>Select a country to filter the live feed.</p>
      <div class="lv-bars" id="lvCountries"></div>
    </section>

    <section class="adm-card lv-card lv-c4">
      <h2>Traffic sources</h2><p>Where page views come from, last 24 h.</p>
      <div class="lv-bars" id="lvSources"></div>
    </section>

    <section class="adm-card lv-card lv-c4">
      <h2>Searches</h2><p>What visitors look for.</p>
      <div class="lv-bars" id="lvTerms"></div>
      <div style="height:12px"></div>
      <h2>Searches with no results</h2><p>Gaps worth filling with new jobs or categories.</p>
      <div class="lv-bars" id="lvZero"></div>
    </section>

    <section class="adm-card lv-card lv-c4">
      <h2>Jobs in demand</h2><p>Most viewed and applied-to jobs, last 24 h.</p>
      <div class="lv-jobs" id="lvJobs"></div>
    </section>

    <section class="adm-card lv-card lv-c12">
      <h2>Usage and limits</h2><p>Estimates only — check Cloudflare for exact figures. This page itself writes nothing to the database.</p>
      <div class="lv-grid" style="margin-top:0">
        <div class="lv-c4"><div class="lv-meter" id="lvMeterSync"></div></div>
        <div class="lv-c4"><div class="lv-meter" id="lvMeterEvents"></div></div>
        <div class="lv-c4"><div class="lv-meter" id="lvMeterPolls"></div></div>
      </div>
      <div class="lv-sys" id="lvSys"></div>
      <div class="lv-note">Analytics rows are estimated at about 4 written rows per tracked event (the event plus its indexes) against the 100,000 daily free-plan limit; job sync uses its own budget from System settings.</div>
    </section>
  </div>
  <div id="lvText" hidden>${textNodes}</div>
  <script>${liveClientScript(icons)}</script>
</div>`;
}
