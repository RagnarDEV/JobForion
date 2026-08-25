// src/pages/admin/blog-cms.js
// Blog management: list, create, edit, publish/draft/schedule, delete.
// See lib/blog-cms.js for the data layer. Category and tags are kept as
// free text (matching how the original hardcoded BLOG_POSTS worked) —
// a full separate blog-taxonomy CRUD is intentionally out of scope here
// to keep this shippable; categories/tags typed consistently still work
// fine for grouping and filtering.

import { escapeHtml } from '../../lib/entities.js';
import { getPosts } from '../../lib/blog-cms.js';
import { richEditorHtml } from '../../components/rich-editor.js';
import { getContentAnalysis } from '../../lib/content-intelligence.js';

const STATUS_BADGE = {
  published: '<span style="font-size:10px;font-weight:800;color:var(--green);background:rgba(15,174,121,.1);padding:2px 8px;border-radius:20px">● PUBLISHED</span>',
  draft: '<span style="font-size:10px;font-weight:800;color:var(--ink3);background:var(--surface2);padding:2px 8px;border-radius:20px">○ DRAFT</span>',
  scheduled: '<span style="font-size:10px;font-weight:800;color:var(--amber);background:rgba(245,166,35,.12);padding:2px 8px;border-radius:20px">◷ SCHEDULED</span>',
};

export async function renderBlogListContent(env) {
  const posts = await getPosts(env, { includeUnpublished: true, limit: 200 });

  const AUTO_BADGE = '<span style="font-size:10px;font-weight:800;color:var(--brand);background:var(--brand-soft);padding:2px 8px;border-radius:20px;margin-left:4px">🤖 AUTO</span>';

  const rows = posts.map(p => `
    <div class="pp-row">
      <div class="pp-info">
        <div class="pp-title">${escapeHtml(p.title)} ${STATUS_BADGE[p.status] || ''}${p.auto_generated ? AUTO_BADGE : ''}</div>
        <div class="pp-meta">${escapeHtml(p.category || 'General')} · /blog/${escapeHtml(p.slug || p.id)} · ${p.published_at ? new Date(p.published_at).toLocaleDateString() : ''}${p.status === 'scheduled' && p.scheduled_at ? ` · publishes ${new Date(p.scheduled_at).toLocaleString()}` : ''}${p.auto_generated && p.expires_at ? ` · expires ${new Date(p.expires_at).toLocaleDateString()}` : ''}</div>
      </div>
      <div class="pp-actions">
        <a href="/blog/${p.slug || p.id}" target="_blank" class="adm-btn-sm" style="color:var(--ink2)">Preview</a>
        <a href="/admin/blog/edit?id=${p.id}" class="adm-btn-sm" style="color:var(--brand)">Edit</a>
        <form method="POST" action="/admin/blog/delete" onsubmit="return confirm('Delete this article permanently?')" style="display:inline">
          <input type="hidden" name="id" value="${p.id}">
          <button class="adm-btn-sm" type="submit">Delete</button>
        </form>
      </div>
    </div>`).join('');

  return `
  <div class="adm-wrap">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">📝 Blog</div>
        <div class="adm-sub">${posts.length} articles</div>
      </div>
      <a href="/admin/blog/new" class="adm-btn adm-btn-primary">+ New Article</a>
    </div>
    <div class="adm-card">
      ${rows || '<div class="adm-empty">No articles yet.</div>'}
    </div>
  </div>`;
}

function contentIntelligenceCard(post, analysis) {
  if (!post?.id) return '';
  const data = analysis?.data;
  const issueRows = data?.issues?.length ? data.issues.map(issue => `<div style="padding:9px 0;border-bottom:1px solid var(--border)"><span style="font-size:10px;font-weight:800;text-transform:uppercase;color:${issue.severity === 'high' ? 'var(--coral)' : issue.severity === 'low' ? 'var(--green)' : 'var(--amber)'}">${escapeHtml(issue.severity)}</span><div style="font-size:12px;font-weight:700;color:var(--ink);margin-top:3px">${escapeHtml(issue.issue)}</div><div style="font-size:11px;color:var(--ink2);margin-top:2px">${escapeHtml(issue.suggestion)}</div></div>`).join('') : '<div style="font-size:12px;color:var(--green)">No major issues were identified.</div>';
  const cardBody = data ? `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px"><span style="font-size:24px;font-weight:900;color:var(--brand)">${data.quality_score}/100</span><span style="font-size:11px;color:var(--ink2)">${escapeHtml(data.summary || 'Editorial summary unavailable.')}</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px"><div style="background:var(--surface2);border-radius:8px;padding:10px"><div style="font-size:10px;font-weight:800;color:var(--ink3);text-transform:uppercase">SEO title</div><div style="font-size:12px;color:var(--ink);margin-top:4px">${escapeHtml(data.seo_title || '—')}</div></div><div style="background:var(--surface2);border-radius:8px;padding:10px"><div style="font-size:10px;font-weight:800;color:var(--ink3);text-transform:uppercase">SEO description</div><div style="font-size:12px;color:var(--ink);margin-top:4px">${escapeHtml(data.seo_description || '—')}</div></div></div><div style="font-size:11px;font-weight:800;color:var(--ink3);text-transform:uppercase;margin-bottom:4px">Editorial issues</div>${issueRows}${data.suggested_excerpt ? `<div style="margin-top:12px;padding:10px;background:var(--brand-soft);border-radius:8px"><div style="font-size:10px;font-weight:800;color:var(--brand);text-transform:uppercase">Suggested excerpt</div><div style="font-size:12px;color:var(--ink);margin-top:4px">${escapeHtml(data.suggested_excerpt)}</div></div>` : ''}` : `<div style="font-size:12px;color:var(--ink2);line-height:1.7">Run a private editorial review for clarity, structure, SEO metadata, and unsupported claims. The result is advisory only and never publishes changes automatically.</div>`;
  return `<div class="adm-card" style="margin-top:14px;border-color:rgba(99,57,230,.25)"><div class="adm-card-title">Content Intelligence <span style="font-weight:400;color:var(--ink3);font-size:11px">— advisory review only</span></div>${cardBody}<form method="POST" action="/admin/blog/content-intelligence" style="margin-top:12px"><input type="hidden" name="id" value="${post.id}"><input type="hidden" name="force" value="${data ? '1' : '0'}"><button class="adm-btn ${data ? '' : 'adm-btn-primary'}" type="submit">${data ? 'Regenerate review' : 'Analyze content'} →</button></form>${analysis?.updated_at ? `<div style="font-size:10px;color:var(--ink3);margin-top:8px">Last reviewed ${escapeHtml(String(analysis.updated_at))}</div>` : ''}</div>`;
}

function postForm(post, isNew, analysis = null) {
  const p = post || { id: '', title: '', excerpt: '', body: '', category: 'Career Advice', tags: [], cover_image_url: '', status: 'published', scheduled_at: '', read_time: '5 min read' };
  const action = isNew ? '/admin/blog/create' : '/admin/blog/update';
  return `
  <div class="adm-wrap" style="max-width:820px">
    <div class="adm-hdr">
      <div>
        <div class="adm-title">${isNew ? '📝 New Article' : `✏️ Edit — ${escapeHtml(p.title)}`}</div>
        ${!isNew && p.auto_generated ? `<div class="adm-sub">🤖 Auto-generated by Blog Automation${p.source_type ? ` (${escapeHtml(p.source_type)})` : ''}</div>` : ''}
      </div>
      <a href="/admin/blog" class="adm-btn">← Back</a>
    </div>
    <form method="POST" action="${action}" class="adm-card" style="display:flex;flex-direction:column;gap:14px">
      ${isNew ? '' : `<input type="hidden" name="id" value="${p.id}">`}
      ${!isNew && p.auto_generated ? `
      <div style="background:var(--brand-soft);border:1px solid rgba(37,99,235,.2);border-radius:10px;padding:12px 14px">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer">
          <input type="checkbox" name="auto_expire" value="1" ${p.auto_expire ? 'checked' : ''} style="width:17px;height:17px">
          <span style="font-size:12.5px;font-weight:700;color:var(--ink)">Auto-delete this article when it expires</span>
        </label>
        <div style="font-size:11px;color:var(--ink3);margin-top:4px;margin-left:26px">${p.expires_at ? `Currently set to expire ${new Date(p.expires_at).toLocaleDateString()}. ` : ''}Uncheck to make this article permanent — it will never be automatically removed.</div>
      </div>` : ''}
      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Title</span>
        <input class="adm-input" style="width:100%" name="title" value="${escapeHtml(p.title)}" required></label>

      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Excerpt</span>
        <input class="adm-input" style="width:100%" name="excerpt" value="${escapeHtml(p.excerpt || '')}" maxlength="300"></label>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
        <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Category</span>
          <input class="adm-input" style="width:100%" name="category" value="${escapeHtml(p.category || '')}"></label>
        <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Tags (comma-separated)</span>
          <input class="adm-input" style="width:100%" name="tags" value="${escapeHtml((p.tags || []).join(', '))}"></label>
        <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Read Time</span>
          <input class="adm-input" style="width:100%" name="read_time" value="${escapeHtml(p.read_time || '5 min read')}"></label>
      </div>

      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Cover Image URL <span style="font-weight:400;text-transform:none;color:var(--ink3)">(optional — paste a hosted image link)</span></span>
        <input class="adm-input" style="width:100%" type="url" name="cover_image_url" value="${escapeHtml(p.cover_image_url || '')}" placeholder="https://..."></label>

      <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Content</span>
        ${richEditorHtml('body', p.body || '')}
      </label>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <label style="display:block"><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Status</span>
          <select class="adm-input" style="width:100%" name="status" onchange="document.getElementById('schedRowB').style.display=this.value==='scheduled'?'block':'none'">
            <option value="published" ${p.status === 'published' ? 'selected' : ''}>Published</option>
            <option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="scheduled" ${p.status === 'scheduled' ? 'selected' : ''}>Scheduled</option>
          </select></label>
        <label style="display:block" id="schedRowB" ${p.status === 'scheduled' ? '' : 'style="display:none"'}><span style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;display:block;margin-bottom:6px">Publish At</span>
          <input class="adm-input" style="width:100%" type="datetime-local" name="scheduled_at" value="${p.scheduled_at ? escapeHtml(String(p.scheduled_at).slice(0, 16)) : ''}"></label>
      </div>

      <div style="display:flex;gap:10px">
        <button class="adm-btn adm-btn-primary" type="submit">${isNew ? 'Create Article' : 'Save Changes'}</button>
        ${isNew ? '' : `<a href="/blog/${escapeHtml(p.slug || p.id)}" target="_blank" class="adm-btn">Preview Live</a>`}
      </div>
    </form>
    ${contentIntelligenceCard(p, analysis)}
  </div>`;
}

export async function renderBlogEditContent(env, post) {
  const analysis = post?.id ? await getContentAnalysis(env, 'blog_post', post.id, post) : null;
  return postForm(post, false, analysis);
}

export function renderBlogNewContent() {
  return postForm(null, true);
}
