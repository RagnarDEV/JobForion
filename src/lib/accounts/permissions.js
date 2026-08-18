// src/lib/accounts/permissions.js
// ════════════════════════════════════════════════════════════════
// COMPANY AUTHORIZATION — every route that touches a specific company's
// data (edit profile, manage members, post/edit/delete a job, view
// applications) MUST call getMembership() or requireCompanyRole() and
// check the result before doing anything else. This is deliberately the
// ONLY place role-vs-permission mapping is defined, so
// routes/company.router.js never hand-rolls its own "is this role
// allowed to do X" logic that could drift out of sync between routes.
//
// This directly implements plan §23's IDOR requirement: authorization is
// enforced here, server-side, against the row actually owned by the
// user — never inferred from a client-supplied company_id alone, and
// never delegated to "the frontend only shows the button if allowed".
// ════════════════════════════════════════════════════════════════

// Role → capability matrix. `admin` implicitly has every capability;
// listed explicitly anyway so this table is the readable source of
// truth rather than special-cased in code.
const ROLE_CAPABILITIES = {
  admin: ['edit_company', 'manage_members', 'create_job', 'edit_job', 'delete_job', 'view_applications'],
  recruiter: ['create_job', 'edit_job', 'view_applications'],
  member: [],
};

export async function getMembership(env, userId, companyId) {
  if (!userId || !companyId) return null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM company_members WHERE user_id = ? AND company_id = ? AND status = 'active' LIMIT 1`
    ).bind(userId, companyId).all();
    return results?.[0] || null;
  } catch (e) { return null; }
}

export function roleHasCapability(role, capability) {
  return (ROLE_CAPABILITIES[role] || []).includes(capability);
}

// Returns the membership row if the user may perform `capability` on
// `companyId`, otherwise null. This is the single call every mutating
// company route should gate on.
export async function requireCompanyCapability(env, userId, companyId, capability) {
  const membership = await getMembership(env, userId, companyId);
  if (!membership) return null;
  if (!roleHasCapability(membership.role, capability)) return null;
  return membership;
}

export async function listUserCompanies(env, userId) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT c.*, cm.role FROM company_members cm JOIN companies c ON c.id = cm.company_id
       WHERE cm.user_id = ? AND cm.status = 'active' ORDER BY c.name ASC`
    ).bind(userId).all();
    return results || [];
  } catch (e) { return []; }
}
