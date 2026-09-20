// src/app/fallback-error.js
// Last-resort branded error page. Deliberately 100% self-contained (no imports,
// no D1, no template composition) so it is structurally incapable of throwing.

// ════════════════════════════════════════════════════════════════
// LAST-RESORT SAFETY NET — see the big try/catch around the whole
// fetch() body below. This function is the one thing standing between
// a future uncaught bug and Cloudflare's raw, unbranded "Error 1101 —
// Worker threw exception" screen (exactly what took the entire site
// down site-wide: see the fix in db/schema.js's ensureAiTables() for
// the actual root cause of that specific incident). Because this
// renders when something has ALREADY gone wrong — possibly D1 itself —
// it is deliberately 100% self-contained: no imports, no D1 reads, no
// template composition from other modules. It must be structurally
// incapable of throwing itself.
export function renderFallbackErrorPage(diagnostic) {
  const diagBlock = diagnostic
    ? `<pre dir="ltr" style="text-align:left;background:#0B1220;color:#9AA6C4;font-size:11px;line-height:1.6;padding:14px;border-radius:10px;margin-top:18px;overflow:auto;max-height:340px;white-space:pre-wrap;word-break:break-word">${diagnostic.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`
    : '';
  return new Response(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>عذراً، حدث خطأ مؤقت — JobForion</title><meta name="robots" content="noindex, nofollow">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;background:#F6F7FB;color:#12162B;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.7}
.box{background:#fff;border:1px solid #E6E9F0;border-radius:18px;padding:40px 32px;max-width:${diagnostic ? '640' : '460'}px;width:100%;text-align:center;box-shadow:0 16px 40px rgba(18,22,43,.10)}
.mark{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#2563EB,#7C3AED);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:22px;font-weight:800;color:#fff}
h1{font-size:19px;font-weight:800;margin-bottom:10px}
p{font-size:14px;color:#525A72;margin-bottom:22px}
a{display:inline-flex;align-items:center;gap:8px;background:#2563EB;color:#fff;padding:11px 24px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none}
a:hover{background:#1d4fd6}
</style></head><body>
<div class="box">
<div class="mark">JF</div>
<h1>عذراً، حدث خطأ مؤقت</h1>
<p>واجه الموقع مشكلة غير متوقعة أثناء تحميل هذه الصفحة. فريقنا تم إعلامه تلقائياً. الرجاء إعادة المحاولة خلال لحظات.</p>
<a href="/">العودة إلى الصفحة الرئيسية</a>
${diagBlock}
</div>
</body></html>`,
    { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
