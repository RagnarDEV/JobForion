// src/routes/api/shared.js
// Small helpers shared by every API sub-router.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_WEBHOOK_BYTES = 128 * 1024;

export const jsonResponse = (payload, status = 200, extra = {}) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...extra } });

export async function readBoundedText(request, maxBytes = MAX_WEBHOOK_BYTES) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value?.byteLength || 0;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    return output + decoder.decode();
  } catch (e) {
    try { await reader.cancel(); } catch (ignored) {}
    return null;
  }
}

export async function readBoundedJson(request, maxBytes = 64 * 1024) {
  const raw = await readBoundedText(request, maxBytes);
  if (raw === null) throw new Error('payload_too_large');
  try { return JSON.parse(raw || '{}'); } catch (e) { throw new Error('invalid_json'); }
}
