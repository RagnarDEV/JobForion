// Phase 12.7 — protected, read-only AI Control Center.

import { verifyAdminCookie } from '../../auth/admin-auth.js';
import { renderAdminLogin } from '../../pages/admin.js';
import { adminShell } from '../../pages/admin/shell.js';
import { renderAiControlCenterContent } from '../../pages/admin/ai-control-center.js';
import { getAiControlSnapshot } from '../../lib/ai-control-center.js';

const HTML = { 'Content-Type': 'text/html; charset=utf-8' };

export async function handleAiControlCenterRoute(url, request, env, base) {
  if (url.pathname !== '/admin/ai-control-center' || request.method !== 'GET') return null;
  try {
    if (!await verifyAdminCookie(env, request.headers.get('Cookie'))) return new Response(renderAdminLogin(false), { headers: HTML });
    const snapshot = await getAiControlSnapshot(env);
    return new Response(adminShell('ai-control-center', renderAiControlCenterContent(snapshot)), { headers: HTML });
  } catch (e) {
    return new Response(adminShell('ai-control-center', '<div class="adm-wrap"><div class="adm-card"><div class="adm-card-title">AI Control Center unavailable</div><p style="font-size:12px;color:var(--ink2)">The read-only status view could not be loaded. Please review the System page.</p></div></div>'), { status: 500, headers: HTML });
  }
}
