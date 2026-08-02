// src/routes/api.router.js
// JSON API surface: job search/listing, alert subscription, employer job
// submissions, manual sync trigger, and a tiny debug endpoint.

import { syncJobs } from '../db/sync.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { JOB_TYPE_SORT_SQL } from '../config/constants.js';

export async function handleApiRoute(url, request, env) {
  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, `subscribe:${ip}`, { maxRequests: 5, windowMinutes: 60 });
      if (!rl.allowed) {
        return new Response(JSON.stringify({ success: false, error: "Too many attempts. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      const { email, keywords } = await request.json();
      if (!email || !keywords?.length) return new Response(JSON.stringify({ success: false, error: "Required" }), { headers: { "Content-Type": "application/json" } });
      await env.DB.prepare("INSERT OR REPLACE INTO subscribers (email,keywords) VALUES (?,?)").bind(email, JSON.stringify(keywords)).run();
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/post-job' && request.method === 'POST') {
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(env, `post-job:${ip}`, { maxRequests: 3, windowMinutes: 60 });
      if (!rl.allowed) {
        return new Response(JSON.stringify({ success: false, error: "Too many submissions. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
      }
      const b = await request.json();
      const title = (b.title || '').toString().slice(0, 150);
      const company = (b.company || '').toString().slice(0, 100);
      const email = (b.email || '').toString().slice(0, 150);
      const jobUrl = (b.url || '').toString().slice(0, 400);
      if (!title || !company || !email || !jobUrl) {
        return new Response(JSON.stringify({ success: false, error: "Please fill in all required fields." }), { headers: { "Content-Type": "application/json" } });
      }
      await env.DB.prepare(
        `INSERT INTO job_postings (title,company,email,url,location,category,employment_type,remote_type,salary,description,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`
      ).bind(
        title, company, email, jobUrl,
        (b.location || '').toString().slice(0, 100),
        (b.category || '').toString().slice(0, 40),
        (b.employment_type || 'full_time').toString().slice(0, 40),
        (b.remote_type || 'fully_remote').toString().slice(0, 40),
        (b.salary || '').toString().slice(0, 60),
        (b.description || '').toString().slice(0, 4000)
      ).run();
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: "Something went wrong. Please try again." }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/jobs') {
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = 20, offset = (page - 1) * limit;
    const category = url.searchParams.get("category") || "";
    const search = url.searchParams.get("search") || "";
    const remoteType = url.searchParams.get("remote_type") || "";
    const employType = url.searchParams.get("employment_type") || "";
    const seniority = url.searchParams.get("seniority") || "";
    const salaryMin = url.searchParams.get("salary_min") || "";
    const days = url.searchParams.get("days") || "";
    // Country filter — same matching heuristic as jobsByRegion() in
    // lib/entities.js: location is either an exact match ("Germany") or
    // ends with ", <country>" ("Berlin, Germany"), since `location` is
    // free text with no normalized country column.
    const country = url.searchParams.get("country") || "";
    // Skill filter — matches the same jobs.skills JSON column that
    // jobsBySkill() (lib/entities.js) parses via SQLite's json_each,
    // expressed here as a correlated EXISTS subquery so it composes with
    // the other AND-joined conditions on the single `jobs` table.
    const skill = url.searchParams.get("skill") || "";
    // Company filter — exact match on the jobs.company column, same value
    // shape produced by listCompanies() (lib/entities.js).
    const company = url.searchParams.get("company") || "";
    const conditions = [], params = [];
    if (category) { conditions.push("LOWER(title) LIKE ?"); params.push(`%${category}%`); }
    if (search) { conditions.push("(LOWER(title) LIKE ? OR LOWER(company) LIKE ?)"); params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`); }
    if (remoteType) { conditions.push("remote_type = ?"); params.push(remoteType); }
    if (employType) { conditions.push("employment_type = ?"); params.push(employType); }
    if (seniority) { conditions.push("LOWER(seniority) LIKE ?"); params.push(`%${seniority.toLowerCase()}%`); }
    if (salaryMin) { conditions.push("CAST(REPLACE(REPLACE(salary,'$',''),'k','') AS INTEGER) >= ?"); params.push(parseInt(salaryMin)); }
    if (days) { conditions.push("created_at >= datetime('now', '-' || ? || ' days')"); params.push(parseInt(days)); }
    if (country) { conditions.push("(location = ? OR location LIKE ?)"); params.push(country, `%, ${country}`); }
    if (skill) { conditions.push("EXISTS (SELECT 1 FROM json_each(jobs.skills) je WHERE je.value = ?)"); params.push(skill); }
    if (company) { conditions.push("company = ?"); params.push(company); }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
    const { results } = await env.DB.prepare(`SELECT * FROM jobs${where} ORDER BY ${JOB_TYPE_SORT_SQL} ASC, featured DESC, id DESC LIMIT ${limit} OFFSET ${offset}`).bind(...params).all();
    const { results: cr } = await env.DB.prepare(`SELECT COUNT(*) as total FROM jobs${where}`).bind(...params).all();
    return new Response(JSON.stringify({ jobs: results, total: cr[0]?.total || 0, page }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  }

  if (url.pathname === '/api/sync') {
    try {
      const result = await syncJobs(env);
      if (request.method === 'POST') return new Response(null, { status: 302, headers: { 'Location': '/admin' } });
      return new Response(JSON.stringify({ success: true, ...result }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  }

  if (url.pathname === '/api/debug') {
    const { results } = await env.DB.prepare("SELECT COUNT(*) as count FROM jobs").all();
    return new Response(JSON.stringify({ jobs_in_db: results[0]?.count || 0 }), { headers: { "Content-Type": "application/json" } });
  }

  return null;
}
