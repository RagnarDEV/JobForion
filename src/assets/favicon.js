// src/assets/favicon.js
// Favicon assets for JobForion (SVG + Base64 placeholders)

// Helper function to convert base64 to Uint8Array (required by assets.router.js)
export const b64ToBytes = (base64) => {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
};

// SVG Favicon (Used in HTML head and as direct SVG response)
export const FAVICON_SVG = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2L2 7l10 5 10-5-10-5z' fill='%236366f1'/><path d='M2 17l10 5 10-5' stroke='%236366f1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/><path d='M2 12l10 5 10-5' stroke='%23818cf8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>`;

// Base64 encoded favicons (Minimal valid 1x1 transparent PNG placeholders to ensure build succeeds)
// ملاحظة: يمكنك استبدال هذه السلاسل بسلاسل Base64 الحقيقية لأيقوناتك لاحقاً إذا رغبت، لكن هذه تضمن عمل البناء فوراً.
const PLACEHOLDER_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const FAVICON_ICO_B64 = PLACEHOLDER_B64;
export const FAVICON_32_B64 = PLACEHOLDER_B64;
export const FAVICON_16_B64 = PLACEHOLDER_B64;
export const APPLE_TOUCH_B64 = PLACEHOLDER_B64;
export const ICON512_B64 = PLACEHOLDER_B64;

// HTML snippet for <head> (required by base-layout.js)
export const faviconHtml = `
  <link rel="icon" type="image/svg+xml" href="${FAVICON_SVG}" />
  <link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,${FAVICON_32_B64}" />
  <link rel="icon" type="image/png" sizes="16x16" href="data:image/png;base64,${FAVICON_16_B64}" />
  <link rel="apple-touch-icon" href="data:image/png;base64,${APPLE_TOUCH_B64}" />
`;

// Icon head snippet (required by admin.js and admin/shell.js)
export const ICON_HEAD = faviconHtml;

export default {
  FAVICON_SVG,
  FAVICON_ICO_B64,
  FAVICON_32_B64,
  FAVICON_16_B64,
  APPLE_TOUCH_B64,
  ICON512_B64,
  b64ToBytes,
  faviconHtml,
  ICON_HEAD
};
