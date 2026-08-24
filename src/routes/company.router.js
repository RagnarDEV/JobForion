// src/routes/company.router.js
// /company/* — requires an authenticated session for every route.
// Authorization against a SPECIFIC company is never inferred from a
// client-supplied id alone: every mutating route calls
// requireCompanyCapability() (lib/accounts/permissions.js), which checks
// the caller's actual company_members row — this is the IDOR prevention
// the plan requires (§13, §23).

import { getSettings } from '../lib/settings.js';
import { getCategoryData } from '../lib/categories.js';
import { getSessionUser } from '../lib/accounts/session.js';
import { getCsrfToken, verifyCsrf } from '../lib/accounts/csrf.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { logActivity } from '../lib/activity-log.js';
import { parseSalary } from '../lib/salary.js';
import { findUserByEmail } from '../lib/users.js';
import {
  createCompany, getCompanyById, updateCompanyProfile, addCompanyMember, removeCompanyMember,
} from '../lib/companies.js';
import { listUserCompanies, requireCompanyCapability, getMembership } from '../lib/accounts/permissions.js';
import {
  renderNoCompanyPage, renderCreateCompanyPage, renderCompanyOverview, renderCompanyProfilePage,
  renderCompanyJobsPage, renderCompanyPostJobPage, renderCompanyMembersPage,
} from '../pages/company-dashboard.js';

const HTML = { "Content-Type": "text/html; charset=utf-8" };

async function readValidatedImage(file, mimeType) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const startsWith = (offset, values) => values.every((value, index) => bytes[offset + index] === value);
  const valid = mimeType === 'image/png'
    ? startsWith(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : mimeType === 'image/jpeg'
      ? startsWith(0, [0xff, 0xd8, 0xff])
      : startsWith(0, [0x52, 0x49, 0x46, 0x46]) && startsWith(8, [0x57, 0x45, 0x42, 0x50]);
  if (!valid) throw new Error('Image signature does not match the declared MIME type.');
  return bytes;
}

async function pageCtx(env, userId) {
  const [settings, categories, companies] = await Promise.all([getSettings(env), getCategoryData(env), listUserCompanies(env, userId)]);
  return { settings, categories, companies };
}

async function resolveActiveCompany(env, userId, url, companies) {
  if (!companies.length) return null;
  const requestedId = parseInt(url.searchParams.get('company_id') || '0', 10);
  const match = requestedId ? companies.find(c => c.id === requestedId) : null;
  return match || companies[0];
}

export async function handleCompanyRoute(url, request, env, base) {
  if (!url.pathname.startsWith('/company/')) return null;

  const session = await getSessionUser(env, request);
  if (!session) return Response.redirect(`${base}/login?next=${encodeURIComponent(url.pathname)}`, 302);
  const { user } = session;
  const csrfToken = await getCsrfToken(env, session.sessionId);

  async function requireCsrf(request) {
    const form = await request.formData();
    const ok = await verifyCsrf(env, session.sessionId, (form.get('_csrf') || '').toString());
    return { form, ok };
  }

  // ── /company/create ──────────────────────────────────────────
  if (url.pathname === '/company/create') {
    const ctx = await pageCtx(env, user.id);
    if (request.method === 'GET') {
      return new Response(await renderCreateCompanyPage(user, ctx, { csrfToken }), { headers: HTML });
    }
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderCreateCompanyPage(user, ctx, { csrfToken, error: 'Your session expired — please try again.' }), { status: 400, headers: HTML });

    const rl = await checkRateLimit(env, `company_create:${user.id}`, { maxRequests: 5, windowMinutes: 60 });
    if (!rl.allowed) return new Response(await renderCreateCompanyPage(user, ctx, { csrfToken, error: 'Too many attempts. Try again later.' }), { status: 429, headers: HTML });

    const name = (form.get('name') || '').toString().trim();
    if (!name) return new Response(await renderCreateCompanyPage(user, ctx, { csrfToken, error: 'Company name is required.' }), { status: 400, headers: HTML });

    const companyId = await createCompany(env, user.id, {
      name, website: form.get('website'), industry: form.get('industry'), country: form.get('country'),
      company_size: form.get('company_size'), description: form.get('description'),
    });
    await logActivity(env, 'company_created', name, { companyId, userId: user.id });
    return new Response(null, { status: 302, headers: { 'Location': `/company/dashboard?company_id=${companyId}` } });
  }

  // ── Everything below requires at least one company ──────────────
  const ctx = await pageCtx(env, user.id);
  if (!ctx.companies.length) {
    return new Response(await renderNoCompanyPage(user, ctx), { headers: HTML });
  }
  const company = await resolveActiveCompany(env, user.id, url, ctx.companies);
  const membership = await getMembership(env, user.id, company.id);

  if (url.pathname === '/company/dashboard' && request.method === 'GET') {
    return new Response(await renderCompanyOverview(env, user, company, ctx), { headers: HTML });
  }

  // ── Profile ──
  if (url.pathname === '/company/profile' && request.method === 'GET') {
    return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: membership?.role === 'admin' }), { headers: HTML });
  }
  if (url.pathname === '/company/profile' && request.method === 'POST') {
    const capable = await requireCompanyCapability(env, user.id, company.id, 'edit_company');
    if (!capable) return new Response('Forbidden', { status: 403 });
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true }), { status: 400, headers: HTML });
    try {
      await updateCompanyProfile(env, company.id, {
        name: form.get('name'), website: form.get('website'), industry: form.get('industry'), country: form.get('country'),
        city: form.get('city'), linkedin_url: form.get('linkedin_url'), description: form.get('description'),
        logo_url: form.get('logo_url'), cover_image_url: form.get('cover_image_url'), founded_year: form.get('founded_year'),
        headquarters: form.get('headquarters'), contact_email: form.get('contact_email'), phone: form.get('phone'),
        twitter_url: form.get('twitter_url'), facebook_url: form.get('facebook_url'),
      });
    } catch (e) {
      return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Could not save profile — please check your entries and try again.' }), { status: 400, headers: HTML });
    }
    await logActivity(env, 'company_profile_updated', company.name, { companyId: company.id, userId: user.id });
    const fresh = await getCompanyById(env, company.id);
    return new Response(await renderCompanyProfilePage(user, fresh, ctx, { csrfToken, canEdit: true, saved: true }), { headers: HTML });
  }

  // ── Logo / Cover upload (Cloudflare R2 — plan §7) ────────────────
  // Gated on env.COMPANY_ASSETS existing at all: this lets the upload UI
  // ship now and "just work" the moment an admin creates the R2 bucket
  // and adds the binding (see wrangler.toml), without a second code
  // deploy. Until then, company admins can still set images by pasting a
  // hosted URL directly into the Logo URL / Cover Image URL fields above
  // — the same zero-infra pattern already used for job-card logos
  // site-wide (lib/company-logos.js overrides).
  if (url.pathname === '/company/logo' || url.pathname === '/company/cover') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const capable = await requireCompanyCapability(env, user.id, company.id, 'edit_company');
    if (!capable) return new Response('Forbidden', { status: 403 });

    const rl = await checkRateLimit(env, `company_upload:${user.id}`, { maxRequests: 15, windowMinutes: 60 });
    if (!rl.allowed) return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Too many uploads — please wait a few minutes.' }), { status: 429, headers: HTML });

    if (!env.COMPANY_ASSETS) {
      return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Image upload is not yet enabled on this site — paste a hosted image URL into the field below instead.' }), { status: 503, headers: HTML });
    }

    let form;
    try { form = await request.formData(); } catch (e) { return new Response('Bad request', { status: 400 }); }
    const csrfOk = await verifyCsrf(env, session.sessionId, (form.get('_csrf') || '').toString());
    if (!csrfOk) return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Your session expired — please try again.' }), { status: 400, headers: HTML });

    const file = form.get('file');
    const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
    const MAX_BYTES = 2 * 1024 * 1024; // 2MB
    if (!file || typeof file === 'string' || !ALLOWED_TYPES.has(file.type)) {
      return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Please upload a PNG, JPEG, or WebP image.' }), { status: 400, headers: HTML });
    }
    if (file.size > MAX_BYTES) {
      return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Image is too large — 2MB maximum.' }), { status: 400, headers: HTML });
    }
    let imageBytes;
    try {
      imageBytes = await readValidatedImage(file, file.type);
    } catch (e) {
      return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'The uploaded file is not a valid PNG, JPEG, or WebP image.' }), { status: 400, headers: HTML });
    }
    const kind = url.pathname === '/company/logo' ? 'logo' : 'cover';
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    // Content-addressed-ish key (company id + kind + timestamp) so a
    // re-upload never collides with or overwrites another company's file,
    // and old versions remain in the bucket (harmless, cheap) rather than
    // risking a race with an in-flight request still serving the old URL.
    const key = `companies/${company.id}/${kind}-${Date.now()}.${ext}`;
    try {
      await env.COMPANY_ASSETS.put(key, imageBytes, { httpMetadata: { contentType: file.type } });
    } catch (e) {
      return new Response(await renderCompanyProfilePage(user, company, ctx, { csrfToken, canEdit: true, uploadError: 'Upload failed — please try again.' }), { status: 500, headers: HTML });
    }
    // R2_PUBLIC_BASE_URL is the public bucket domain (r2.dev subdomain or
    // a custom domain mapped to the bucket) — set once via
    // `wrangler secret put R2_PUBLIC_BASE_URL`, see wrangler.toml notes.
    const publicBase = (env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const publicUrl = publicBase ? `${publicBase}/${key}` : `/r2-asset/${key}`;
    await updateCompanyProfile(env, company.id, {
      ...company,
      [kind === 'logo' ? 'logo_url' : 'cover_image_url']: publicUrl,
    });
    await logActivity(env, kind === 'logo' ? 'company_logo_uploaded' : 'company_cover_uploaded', company.name, { companyId: company.id, userId: user.id });
    const fresh = await getCompanyById(env, company.id);
    return new Response(await renderCompanyProfilePage(user, fresh, ctx, { csrfToken, canEdit: true, saved: true }), { headers: HTML });
  }

  // ── Jobs ──
  if (url.pathname === '/company/jobs' && request.method === 'GET') {
    const statusFilter = url.searchParams.get('status') || '';
    const page = url.searchParams.get('page') || '1';
    return new Response(await renderCompanyJobsPage(env, user, company, ctx, statusFilter, csrfToken, page), { headers: HTML });
  }

  // Pause / Resume / Close / Archive — all four are pure status
  // transitions on a row the company already owns, so they share one
  // handler instead of four near-identical blocks. `edit_job` is the
  // same capability the existing job-edit flow would use — pausing your
  // own listing is a lighter action than editing its content, not a
  // heavier one, so gating it any stricter would be inconsistent.
  const jobActionMatch = url.pathname.match(/^\/company\/jobs\/(\d+)\/(pause|resume|close|archive)$/);
  if (jobActionMatch && request.method === 'POST') {
    const capable = await requireCompanyCapability(env, user.id, company.id, 'edit_job');
    if (!capable) return new Response('Forbidden', { status: 403 });
    const { ok } = await requireCsrf(request);
    if (!ok) return new Response(null, { status: 302, headers: { 'Location': `/company/jobs?flash=${encodeURIComponent('Session expired — please try again.')}` } });

    const jobId = parseInt(jobActionMatch[1], 10);
    const action = jobActionMatch[2];
    // OWNERSHIP CHECK (plan §6): the WHERE clause below requires
    // company_id = ? in the SAME statement as the UPDATE — this is what
    // makes it structurally impossible for a recruiter at Company A to
    // pause/close/archive a job belonging to Company B by guessing or
    // enumerating job ids in the URL, even though requireCompanyCapability
    // above already confirmed they're a legitimate member of Company A.
    // A capable member of the WRONG company still can't touch this row:
    // the UPDATE simply matches zero rows and changes nothing.
    const newStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : action === 'close' ? 'closed' : 'archived';
    // resume only makes sense coming from paused/closed; pause only from
    // active — restricting the FROM-state per action prevents nonsense
    // transitions (e.g. "resuming" an already-archived job back to live
    // via a replayed form submission) without needing a bigger state
    // machine library for four transitions.
    const allowedFrom = action === 'resume' ? ['paused', 'closed'] : action === 'pause' ? ['active'] : ['active', 'paused', 'closed'];
    const fromPlaceholders = allowedFrom.map(() => '?').join(',');
    const r = await env.DB.prepare(
      `UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ? AND status IN (${fromPlaceholders})`
    ).bind(newStatus, jobId, company.id, ...allowedFrom).run();

    if (r.meta?.changes > 0) {
      await logActivity(env, `job_${action}d_by_company`, String(jobId), { companyId: company.id, userId: user.id });
    }
    const msg = r.meta?.changes > 0 ? `Job ${action === 'resume' ? 'resumed' : action + 'd'}.` : 'No change — the job may already be in that state, or belongs to a different company.';
    return new Response(null, { status: 302, headers: { 'Location': `/company/jobs?flash=${encodeURIComponent(msg)}` } });
  }

  // ── Post a Job ──
  if (url.pathname === '/company/post-job') {
    const capable = await requireCompanyCapability(env, user.id, company.id, 'create_job');
    if (request.method === 'GET') {
      return new Response(await renderCompanyPostJobPage(user, company, ctx, { csrfToken, canPost: !!capable }), { headers: HTML });
    }
    if (!capable) return new Response('Forbidden', { status: 403 });
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderCompanyPostJobPage(user, company, ctx, { csrfToken, canPost: true, error: 'Your session expired — please try again.' }), { status: 400, headers: HTML });

    const rl = await checkRateLimit(env, `company_post_job:${company.id}`, { maxRequests: 20, windowMinutes: 60 });
    if (!rl.allowed) return new Response(await renderCompanyPostJobPage(user, company, ctx, { csrfToken, canPost: true, error: 'Too many submissions. Try again later.' }), { status: 429, headers: HTML });

    // Re-collect every field up front (not just title/url) so any
    // validation error below can re-render the form with everything the
    // employer already typed still filled in — losing a half-written job
    // description to a typo'd salary field would be a genuinely hostile
    // UX for what's supposed to be a "professional" posting flow.
    const title = (form.get('title') || '').toString().trim().slice(0, 150);
    const jobUrl = (form.get('url') || '').toString().trim().slice(0, 400);
    const location = (form.get('location') || '').toString().trim().slice(0, 100);
    const category = (form.get('category') || '').toString().slice(0, 40);
    const employment_type = ['full_time', 'part_time', 'contract', 'internship'].includes((form.get('employment_type') || '').toString())
      ? form.get('employment_type').toString() : 'full_time';
    const remote_type = ['fully_remote', 'hybrid', 'on_site'].includes((form.get('remote_type') || '').toString())
      ? form.get('remote_type').toString() : 'fully_remote';
    const seniority = ['Junior', 'Mid', 'Senior', 'Lead'].includes((form.get('seniority') || '').toString()) ? form.get('seniority').toString() : '';
    const description = (form.get('description') || '').toString().trim().slice(0, 4000);

    let skills = [];
    try {
      const parsed = JSON.parse((form.get('skills') || '[]').toString());
      if (Array.isArray(parsed)) skills = parsed.map(s => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 15);
    } catch (e) { /* malformed/tampered hidden field — treat as no skills rather than fail the whole submission */ }

    const salaryMinRaw = (form.get('salary_min') || '').toString().trim();
    const salaryMaxRaw = (form.get('salary_max') || '').toString().trim();
    const salaryCurrency = ['$', '€', '£', 'C$', 'A$'].includes((form.get('salary_currency') || '').toString()) ? form.get('salary_currency').toString() : '$';
    const salaryPeriod = ['year', 'month', 'hour'].includes((form.get('salary_period') || '').toString()) ? form.get('salary_period').toString() : 'year';

    const formValues = { title, url: jobUrl, location, category, employment_type, remote_type, seniority, description, skills, salary_min: salaryMinRaw, salary_max: salaryMaxRaw, salary_currency: salaryCurrency, salary_period: salaryPeriod };
    const rerender = async (error, status = 400) => new Response(await renderCompanyPostJobPage(user, company, ctx, { csrfToken, canPost: true, error, formValues }), { status, headers: HTML });

    if (!title || !jobUrl) return await rerender('Job title and apply URL are required.');
    try { new URL(jobUrl); } catch (e) { return await rerender('Apply URL must be a valid, full URL (including https://).'); }

    // Compensation is optional, but if either bound was entered, both must
    // be present and form a sane range — silently accepting "min=90000,
    // max=<blank>" would store a broken/misleading salary line, and
    // min > max would sort and badge incorrectly downstream.
    let salary = '';
    if (salaryMinRaw || salaryMaxRaw) {
      const min = parseInt(salaryMinRaw, 10);
      const max = parseInt(salaryMaxRaw, 10);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max <= 0) return await rerender('Enter both a minimum and maximum salary, or leave both blank.');
      if (min > max) return await rerender('Minimum salary cannot be greater than the maximum.');
      const periodLabel = salaryPeriod === 'year' ? 'per year' : salaryPeriod === 'month' ? 'per month' : 'per hour';
      // Canonical human-readable string, re-parsed by lib/salary.js's
      // parseSalary() at admin-approval time (see admin/jobs.router.js) to
      // derive jobs.salary_min_usd/salary_max_usd — building it in this
      // exact shape is what makes that round-trip lossless.
      salary = `${salaryCurrency}${min.toLocaleString('en-US')} - ${salaryCurrency}${max.toLocaleString('en-US')} ${periodLabel}`;
    }

    // Accidental-double-submit guard: the same company posting the exact
    // same title again within a few minutes is almost always a double
    // click or a back-button resubmit, not a genuine second opening.
    // Deliberately narrow (name + company_id + 10 minutes) so it never
    // blocks a legitimate re-post of a role that closed and reopened
    // later — this is a UX safety net, not a moderation rule.
    try {
      const { results: dupe } = await env.DB.prepare(
        `SELECT id FROM job_postings WHERE company_id = ? AND LOWER(title) = LOWER(?) AND created_at >= datetime('now','-10 minutes') LIMIT 1`
      ).bind(company.id, title).all();
      if (dupe && dupe.length) return await rerender('You already submitted a job with this title a few minutes ago. Please wait before submitting again.');
    } catch (e) { /* dedupe check failing must never block a genuine submission */ }

    // Employer Submitted Jobs (plan §15/§16) go through the SAME
    // job_postings → Admin Review → jobs pipeline as the existing
    // anonymous "Post a Job" modal (see routes/admin/jobs.router.js's
    // approve handler) — company_id + user_id are the only new fields,
    // set here so the approval step can link the resulting job back to
    // this company and mark it source_type='employer'.
    await env.DB.prepare(
      `INSERT INTO job_postings (title,company,email,url,location,category,employment_type,remote_type,salary,description,skills,seniority,status,user_id,company_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`
    ).bind(
      title, company.name, user.email, jobUrl, location, category,
      employment_type, remote_type, salary, description,
      JSON.stringify(skills), seniority,
      user.id, company.id
    ).run();
    await logActivity(env, 'employer_job_submitted', title, { companyId: company.id, userId: user.id });

    return new Response(await renderCompanyPostJobPage(user, company, ctx, { csrfToken, canPost: true, submitted: true }), { headers: HTML });
  }

  // ── Members ──
  if (url.pathname === '/company/members' && request.method === 'GET') {
    return new Response(await renderCompanyMembersPage(env, user, company, ctx, { csrfToken, canManage: membership?.role === 'admin' }), { headers: HTML });
  }
  if (url.pathname === '/company/members/add' && request.method === 'POST') {
    const capable = await requireCompanyCapability(env, user.id, company.id, 'manage_members');
    if (!capable) return new Response('Forbidden', { status: 403 });
    const { form, ok } = await requireCsrf(request);
    if (!ok) return new Response(await renderCompanyMembersPage(env, user, company, ctx, { csrfToken, canManage: true, error: 'Your session expired.' }), { status: 400, headers: HTML });

    const email = (form.get('email') || '').toString().trim().toLowerCase();
    const role = ['admin', 'recruiter', 'member'].includes((form.get('role') || '').toString()) ? form.get('role').toString() : 'member';
    const target = await findUserByEmail(env, email);
    if (!target) {
      return new Response(await renderCompanyMembersPage(env, user, company, ctx, { csrfToken, canManage: true, error: 'No JobForion account found with that email.' }), { status: 404, headers: HTML });
    }
    await addCompanyMember(env, company.id, target.id, role);
    await logActivity(env, 'company_member_added', email, { companyId: company.id, role });
    return new Response(null, { status: 302, headers: { 'Location': `/company/members?company_id=${company.id}` } });
  }
  if (url.pathname === '/company/members/remove' && request.method === 'POST') {
    const capable = await requireCompanyCapability(env, user.id, company.id, 'manage_members');
    if (!capable) return new Response('Forbidden', { status: 403 });
    const { form, ok } = await requireCsrf(request);
    if (ok) {
      const targetUserId = parseInt((form.get('user_id') || '0').toString(), 10);
      // Never allow removing yourself through this form — a Company
      // Admin locking themselves out is a support burden with no
      // security upside; they can leave via a future "leave company"
      // action if genuinely intended.
      if (targetUserId && targetUserId !== user.id) {
        await removeCompanyMember(env, company.id, targetUserId);
        await logActivity(env, 'company_member_removed', String(targetUserId), { companyId: company.id });
      }
    }
    return new Response(null, { status: 302, headers: { 'Location': `/company/members?company_id=${company.id}` } });
  }

  return null;
}
