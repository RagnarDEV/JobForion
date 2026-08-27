// Admin Assistant — read-only operational guidance page.
import { escapeHtml } from '../../lib/entities.js';
import { getSettings } from '../../lib/settings.js';
import { isAiConfigured } from '../../lib/ai-service.js';

function plainText(value) {
  return escapeHtml(String(value || '')).replace(/\r?\n/g, '<br>');
}

export async function renderAdminAssistantContent(env, { question = '', answer = '', error = '' } = {}) {
  const settings = await getSettings(env);
  const enabled = settings.ai_enabled !== '0';
  const configured = isAiConfigured(env);
  return `<div class="adm-wrap">
    <div class="adm-hdr"><div><div class="adm-title">✦ Admin Assistant</div><div class="adm-sub">Read-only operational guidance for JobForion administrators</div></div><a href="/admin" class="adm-btn">Dashboard</a></div>
    ${error ? `<div style="padding:11px 14px;border-radius:9px;background:rgba(231,76,60,.10);border:1px solid rgba(231,76,60,.25);color:var(--coral);font-size:12px;margin-bottom:16px" role="alert">${escapeHtml(error)}</div>` : ''}
    <div class="adm-grid" style="margin-bottom:16px">
      <div class="adm-card" style="grid-column:span 2"><div class="adm-card-title">Operational questions</div><p style="font-size:12.5px;line-height:1.75;color:var(--ink2);margin:0 0 14px">Ask about the current JobForion snapshot, sync history, job lifecycle, salary normalization, or which existing admin page to review next. This assistant is deliberately read-only: it cannot run actions, change settings, delete data, send email, or make payment decisions.</p><div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--ink3)"><span style="padding:6px 9px;border-radius:7px;background:var(--surface2)">AI ${!enabled ? 'disabled' : configured ? 'binding ready' : 'not configured'}</span><span style="padding:6px 9px;border-radius:7px;background:var(--surface2)">Server-side only</span><span style="padding:6px 9px;border-radius:7px;background:var(--surface2)">No destructive actions</span></div></div>
      <div class="adm-card" style="grid-column:span 2"><form method="POST" action="/admin/assistant"><label class="adm-card-title" for="admin-assistant-question" style="display:block;margin-bottom:10px">Ask Admin Assistant</label><textarea id="admin-assistant-question" name="question" maxlength="1600" rows="5" required placeholder="Example: What should I review if active jobs are falling while salary backfill is pending?" style="width:100%;box-sizing:border-box;resize:vertical;padding:11px 12px;border:1px solid var(--border2);border-radius:9px;background:var(--surface2);color:var(--ink);font:inherit;font-size:13px;line-height:1.6">${escapeHtml(question)}</textarea><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px"><span style="font-size:10.5px;color:var(--ink3)">Do not include passwords, tokens, personal data, or secrets.</span><button class="adm-btn adm-btn-primary" type="submit" ${!enabled || !configured ? 'disabled' : ''}>Ask Assistant</button></div></form></div>
      ${answer ? `<div class="adm-card" style="grid-column:span 2;border-color:rgba(99,57,230,.25)"><div class="adm-card-title">Assistant response</div><div style="font-size:13px;line-height:1.8;color:var(--ink2);overflow-wrap:anywhere">${plainText(answer)}</div></div>` : ''}
    </div>
  </div>`;
}
