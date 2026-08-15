// src/routes/admin/error-page.js
// Shared across every src/routes/admin/*.router.js sub-router (see
// admin.router.js for how they're composed). Previously an uncaught
// exception anywhere in the single admin.router.js file would bubble all
// the way up and Cloudflare would show its generic "Error 1101 — Worker
// threw exception" page, with zero detail on what actually went wrong —
// every route handler wraps its body in try/catch and renders the real
// error message via this instead, so it can be diagnosed immediately.
export function errorPage(err) {
  const msg = (err && err.message ? err.message : String(err)).replace(/</g, '&lt;');
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Error — JobForion</title><meta name="robots" content="noindex, nofollow">
<style>
body{font-family:-apple-system,sans-serif;background:#03060F;color:#E8F0FF;padding:40px 20px;max-width:640px;margin:0 auto;line-height:1.6}
.box{background:#111F35;border:1px solid #1E3352;border-radius:14px;padding:26px}
h1{font-size:18px;color:#FF5C7A;margin-bottom:14px}
p{font-size:13px;color:#8BA5CC;margin-bottom:12px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:#03060F;padding:14px;border-radius:10px;color:#8BA5CC;overflow:auto;border:1px solid #152236}
a{color:#4F8EF7;text-decoration:none;font-weight:600}
a:hover{text-decoration:underline}
</style></head><body>
<div class="box">
<h1>⚠️ حدث خطأ أثناء تنفيذ العملية</h1>
<p>هذه رسالة الخطأ الفعلية القادمة من الخادم أو قاعدة البيانات:</p>
<pre>${msg}</pre>
<p style="margin-top:18px"><a href="/admin">← العودة إلى لوحة التحكم</a></p>
</div>
</body></html>`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
