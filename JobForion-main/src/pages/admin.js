// src/pages/admin.js
// Thin entry point: renderAdminLogin (unchanged signature) + renderAdminDashboard
// now composes the shared shell (src/pages/admin/shell.js) with the dashboard
// page content (src/pages/admin/dashboard.js). Both exported function names
// and signatures are identical to before — admin.router.js needs zero changes.

import { ICON_HEAD } from '../assets/favicon.js';
import { SHARED_CSS } from '../styles/shared-css.js';
import { adminShell } from './admin/shell.js';
import { renderDashboardContent } from './admin/dashboard.js';

export function renderAdminLogin(error) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Login — JobForion</title><meta name="robots" content="noindex, nofollow">${ICON_HEAD}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>${SHARED_CSS}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;background:var(--bg)}
.box{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:36px 30px;max-width:380px;width:100%;box-shadow:var(--shadow-lg)}
.logo{font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:800;color:var(--ink);margin-bottom:4px;display:flex;align-items:center;gap:8px}
.logo img{width:28px;height:28px;border-radius:8px}
.sub{font-size:13px;color:var(--ink3);margin-bottom:24px}
.form-input{width:100%;background:var(--surface2);border:1.5px solid var(--border2);border-radius:10px;padding:12px 14px;color:var(--ink);font-size:14px;font-family:inherit;outline:none;margin-bottom:14px}
.form-input:focus{border-color:var(--brand)}
.submit-btn{width:100%;background:var(--brand);color:#fff;padding:13px;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;border:none;cursor:pointer}
.err{background:rgba(255,92,122,.1);border:1px solid rgba(255,92,122,.25);color:var(--coral);font-size:13px;padding:10px 12px;border-radius:9px;margin-bottom:14px}
</style></head><body>
<div class="box">
  <div class="logo"><img src="/favicon.svg" alt="JobForion">JobForion</div>
  <div class="sub">Admin Dashboard</div>
  ${error ? `<div class="err">Incorrect password. Try again.</div>` : ''}
  <form method="POST" action="/admin/login">
    <input class="form-input" type="password" name="password" placeholder="Admin password" autofocus required>
    <button class="submit-btn" type="submit">Sign In →</button>
  </form>
</div>
</body></html>`;
}

export async function renderAdminDashboard(env, base) {
  const content = await renderDashboardContent(env, base);
  return adminShell('dashboard', content);
}
