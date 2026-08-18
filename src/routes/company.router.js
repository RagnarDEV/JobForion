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
    await updateCompanyProfile(env, company.id, {
      name: form.get('name'), website: form.get('website'), industry: form.get('industry'), country: form.get('country'),
      city: form.get('city'), linkedin_url: form.get('linkedin_url'), description: form.get('description'),
    });
    await logActivity(env, 'company_profile_updated', company.name, { companyId: company.id, userId: user.id });
    const fresh = await getCompanyById(env, company.id);
    return new Response(await renderCompanyProfilePage(user, fresh, ctx, { csrfToken, canEdit: true, saved: true }), { headers: HTML });
  }

  // ── Jobs ──
  if (url.pathname === '/company/jobs' && request.method === 'GET') {
    return new Response(await renderCompanyJobsPage(env, user, company, ctx), { headers: HTML });
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

    const title = (form.get('title') || '').toString().trim().slice(0, 150);
    const jobUrl = (form.get('url') || '').toString().trim().slice(0, 400);
    if (!title || !jobUrl) {
      return new Response(await renderCompanyPostJobPage(user, company, ctx, { csrfToken, canPost: true, error: 'Job title and apply URL are required.' }), { status: 400, headers: HTML });
    }

    // Employer Submitted Jobs (plan §15/§16) go through the SAME
    // job_postings → Admin Review → jobs pipeline as the existing
    // anonymous "Post a Job" modal (see routes/admin/jobs.router.js's
    // approve handler) — company_id + user_id are the only new fields,
    // set here so the approval step can link the resulting job back to
    // this company and mark it source_type='employer'.
    await env.DB.prepare(
      `INSERT INTO job_postings (title,company,email,url,location,category,employment_type,remote_type,salary,description,status,user_id,company_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)`
    ).bind(
      title, company.name, user.email, jobUrl,
      (form.get('location') || '').toString().slice(0, 100), (form.get('category') || '').toString().slice(0, 40),
      'full_time', (form.get('remote_type') || 'fully_remote').toString().slice(0, 40),
      (form.get('salary') || '').toString().slice(0, 60), (form.get('description') || '').toString().slice(0, 4000),
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
