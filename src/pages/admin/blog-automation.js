// src/pages/admin/blog-automation.js
// Blog Automation admin page: stats cards, a dedicated partial settings
// form (posts to /admin/blog-automation/update so it can never overwrite
// unrelated Site/SEO feature flags), a "Generate Article Now" trigger for
// on-demand testing, and a recent activity log sourced from
// lib/blog-automation/logger.js.

import { escapeHtml } from '../../lib/entities.js';
import { getSettings, SETTINGS_DEFAULTS, WEEKDAY_OPTIONS } from '../../lib/settings.js';
import { getBlogAutomationStats, getRecentBlogEvents, BLOG_EVENT_LABELS } from '../../lib/blog-automation/logger.js';
import { TEMPLATES } from '../../lib/blog-automation/templates/index.js';

function field(label, name, value, opts = {}) {
  const { type = 'text', placeholder = '', hint = '', full = false } = opts;
  return `<label style="display:block;${full ? 'grid-column:1 / -1;' : ''}">
    <span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">${label}</span>
    <input class="adm-input" style="width:100%" type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
    ${hint ? `<span style="font-size:11px;color:var(--ink3);display:block;margin-top:4px">${hint}</span>` : ''}
  </label>`;
}

function toggle(name, label, value, hint) {
  const on = value !== '0';
  return `<label style="display:flex;align-items:flex-start;gap:9px;padding:8px 0;cursor:pointer">
    <input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''} style="width:17px;height:17px;margin-top:1px;flex-shrink:0">
    <span>
      <span style="font-size:12.5px;font-weight:700;color:var(--ink);display:block">${label}</span>
      ${hint ? `<span style="font-size:10.5px;color:var(--ink3)">${hint}</span>` : ''}
    </span>
  </label>`;
}

function statCard(label, value, color = 'var(--brand)', sub = '') {
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:var(--shadow)">
    <div style="font-size:10.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${label}</div>
    <div style="font-family:var(--font-heading,sans-serif);font-size:24px;font-weight:800;color:${color}">${value}</div>
    ${sub ? `<div style="font-size:11px;color:var(--ink3);margin-top:2px">${sub}</div>` : ''}
  </div>`;
}

const EVENT_COLOR = {
  article_published: 'var(--green)',
  article_expired: 'var(--ink3)',
  generation_failed: 'var(--coral)',
  duplicate_detected: 'var(--amber)',
  insufficient_data: 'var(--amber)',
  generation_skipped: 'var(--ink3)',
  generation_started: 'var(--brand)',
  topic_selected: 'var(--brand)',
};

function logRow(entry) {
  const label = BLOG_EVENT_LABELS[entry.event] || entry.event;
  const color = EVENT_COLOR[entry.event] || 'var(--ink3)';
  const m = entry.meta || {};
  const bits = [];
  if (m.title) bits.push(escapeHtml(m.title));
  if (m.template) bits.push(`template: ${escapeHtml(m.template)}`);
  if (m.topicKey) bits.push(escapeHtml(m.topicKey));
  if (m.reason) bits.push(escapeHtml(typeof m.reason === 'string' ? m.reason : JSON.stringify(m.reason)));
  if (m.reasons) bits.push(escapeHtml(Array.isArray(m.reasons) ? m.reasons.join('; ') : String(m.reasons)));
  if (m.jobCount !== undefined) bits.push(`${m.jobCount} jobs`);
  return `<div class="adm-row" style="align-items:flex-start;flex-direction:column;gap:3px">
    <div style="display:flex;justify-content:space-between;width:100%;gap:10px">
      <span style="font-size:12px;font-weight:700;color:${color}">${escapeHtml(label)}</span>
      <span style="font-size:11px;color:var(--ink3);white-space:nowrap">${entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>
    </div>
    ${bits.length ? `<div style="font-size:11px;color:var(--ink2)">${bits.join(' · ')}</div>` : ''}
  </div>`;
}

export async function renderBlogAutomationContent(env) {
  const s = await getSettings(env);
  const [stats, recentEvents] = await Promise.all([
    getBlogAutomationStats(env),
    getRecentBlogEvents(env, 25),
  ]);

  const perWeek = parseInt(s.blog_auto_articles_per_week || '4', 10);

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">🤖 Blog Automation</div>
        <div class="adm-sub">Data-driven articles generated from real job listings — no AI, fully rule-based</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <form method="POST" action="/admin/blog-automation/run-now" onsubmit="return confirm('Generate one article right now, ignoring the schedule and weekly limit?')" style="display:inline">
          <button class="adm-btn adm-btn-primary" type="submit">▶ Generate Article Now</button>
        </form>
        <form method="POST" action="/admin/blog-automation/expire-now" onsubmit="return confirm('Run expiration cleanup now? This permanently deletes any due auto-generated articles.')" style="display:inline">
          <button class="adm-btn" type="submit" style="border-color:var(--coral);color:var(--coral)">🧹 Run Expiration Now</button>
        </form>
        <a href="/admin/blog" class="adm-btn">📝 View in Blog CMS</a>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
      ${statCard('This Week', `${stats.publishedThisWeek} / ${perWeek}`, 'var(--brand)', 'Articles published')}
      ${statCard('This Month', stats.publishedThisMonth, 'var(--green)', 'Auto-generated')}
      ${statCard('Expiring Soon', stats.expiringSoon, 'var(--amber)', 'Within 7 days')}
      ${statCard('Deleted (All Time)', stats.deletedTotal, 'var(--ink3)', 'Expired & removed')}
      ${statCard('Skipped (7d)', stats.skippedRecent, 'var(--amber)', 'Duplicate / insufficient data')}
      ${statCard('Failed (7d)', stats.failedRecent, stats.failedRecent > 0 ? 'var(--coral)' : 'var(--ink3)', 'Generation errors')}
    </div>

    <form method="POST" action="/admin/blog-automation/update" style="display:flex;flex-direction:column;gap:16px">

      <div class="adm-card">
        <div class="adm-card-title">General</div>
        <div style="margin-bottom:6px">
          ${toggle('blog_auto_enabled', 'Enable Automation', s.blog_auto_enabled, 'Master switch — when off, the scheduled generation cron skips every run.')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:6px">
          ${field('Articles per Week', 'blog_auto_articles_per_week', s.blog_auto_articles_per_week, { type: 'number', hint: 'Hard cap — automation stops once this many auto-generated posts publish in a rolling 7 days.' })}
          ${field('Article Lifetime (days)', 'blog_auto_lifetime_days', s.blog_auto_lifetime_days, { type: 'number', hint: 'expires_at = published_at + this many days.' })}
          ${field('Minimum Jobs Required', 'blog_auto_min_jobs', s.blog_auto_min_jobs, { type: 'number', hint: 'A topic is only eligible once it has at least this many matching open jobs.' })}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px">
          ${toggle('blog_auto_publish', 'Auto Publish', s.blog_auto_publish, 'On = goes live immediately. Off = saved as a draft in the Blog CMS for manual review.')}
          ${toggle('blog_auto_delete', 'Auto Delete Expired Articles', s.blog_auto_delete, 'Global switch for the 45-day (or custom) auto-expiration lifecycle.')}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">📅 Schedule</div>
        <div style="font-size:12px;color:var(--ink2);margin-bottom:10px">Publishing days (checked on the daily generation cron — see wrangler.toml). Times are UTC.</div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:14px">
          ${WEEKDAY_OPTIONS.map(d => {
            const days = String(s.blog_auto_schedule_days || '').split(',').map(x => x.trim());
            const checked = days.includes(String(d.value));
            return `<label style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ink2);cursor:pointer">
              <input type="checkbox" name="blog_auto_schedule_days_${d.value}" data-day="${d.value}" ${checked ? 'checked' : ''} onchange="document.getElementById('scheduleDaysField').value = Array.from(document.querySelectorAll('[data-day]:checked')).map(el=>el.dataset.day).join(',')">
              ${d.label}
            </label>`;
          }).join('')}
        </div>
        <input type="hidden" id="scheduleDaysField" name="blog_auto_schedule_days" value="${escapeHtml(s.blog_auto_schedule_days || '')}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${field('Generation Check Hour (UTC)', 'blog_auto_schedule_hour', s.blog_auto_schedule_hour, { type: 'number', hint: 'Informational — the cron trigger itself runs daily at 09:00 UTC (wrangler.toml).' })}
          ${field('Timezone Label', 'blog_auto_timezone_label', s.blog_auto_timezone_label, { hint: 'Display only.' })}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">🗂️ Topics <span style="font-weight:400;color:var(--ink3);font-size:12px">— which article types the topic engine may choose from</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px">
          ${TEMPLATES.map(t => toggle(t.settingsKey, t.label, s[t.settingsKey])).join('')}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">✍️ Content</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${field('Minimum Length (words)', 'blog_auto_min_content_length', s.blog_auto_min_content_length, { type: 'number' })}
          ${field('Maximum Length (words)', 'blog_auto_max_content_length', s.blog_auto_max_content_length, { type: 'number' })}
          ${field('Jobs Listed per Article', 'blog_auto_jobs_per_article', s.blog_auto_jobs_per_article, { type: 'number' })}
          ${field('Companies Listed per Article', 'blog_auto_companies_per_article', s.blog_auto_companies_per_article, { type: 'number' })}
        </div>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">🔁 Duplicate Protection &amp; Expiration</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          ${field('Duplicate Cooldown (days)', 'blog_auto_duplicate_cooldown_days', s.blog_auto_duplicate_cooldown_days, { type: 'number', hint: 'The same topic (e.g. "Remote Developer Jobs") will not be regenerated within this many days.' })}
          ${field('Default Lifetime (days)', 'blog_auto_lifetime_days', s.blog_auto_lifetime_days, { type: 'number', hint: 'Same value as General above — shown here for reference.' })}
        </div>
        <p style="font-size:11.5px;color:var(--ink3);margin-top:10px">Permanent posts are supported: uncheck "Auto Delete" on any article from the <a href="/admin/blog" style="color:var(--brand)">Blog CMS</a> edit screen to exempt it from expiration regardless of this setting.</p>
      </div>

      <div>
        <button class="adm-btn adm-btn-primary" type="submit">Save Blog Automation Settings</button>
      </div>
    </form>

    <div class="adm-card" style="margin-top:16px">
      <div class="adm-card-title">Recent Activity</div>
      ${recentEvents.length ? recentEvents.map(logRow).join('') : '<div class="adm-empty">No generation activity yet — it will appear here after the next scheduled run or a manual "Generate Article Now".</div>'}
    </div>
  </div>`;
}
