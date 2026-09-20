// src/lib/accounts/password.js
// ════════════════════════════════════════════════════════════════
// PASSWORD HASHING — PBKDF2-HMAC-SHA256 via the Web Crypto API, which
// Cloudflare Workers provides natively (no npm dependency, no WASM
// build step needed, unlike bcrypt/argon2 in this runtime). 100,000
// iterations follows OWASP's current PBKDF2-SHA256 minimum guidance.
//
// Stored format: `pbkdf2$<iterations>$<saltHex>$<hashHex>` — the
// algorithm and iteration count travel WITH the hash, so a future
// increase to the iteration count (or algorithm) never breaks
// verification of passwords hashed under the old settings; only new
// hashes use the new settings, and verifyPassword() reads whatever
// count is embedded in the stored value it's checking against.
//
// NEVER used for the Admin Dashboard's ADMIN_PASSWORD secret (that
// remains a single shared secret compared via auth/admin-auth.js's
// timing-safe HMAC comparison, completely separate from this per-user
// system).
// ════════════════════════════════════════════════════════════════

const ITERATIONS = 100000;
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256;

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function pbkdf2(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return bytesToHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${bytesToHex(salt)}$${hash}`;
}

// Timing-safe-ish by construction: both hashes are fixed-length hex
// strings compared byte-by-byte in constant time (mirrors the same
// approach auth/admin-auth.js already uses for the admin password).
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = parseInt(parts[1], 10);
    const salt = hexToBytes(parts[2]);
    const expectedHash = parts[3];
    const actualHash = await pbkdf2(password, salt, iterations);
    return timingSafeEqualHex(actualHash, expectedHash);
  } catch (e) {
    return false;
  }
}

// Basic strength floor — real UX-level feedback belongs client-side;
// this is the last-line server-side gate so it can never be bypassed by
// disabling JS or hitting the API directly. Deliberately not overly
// strict (no forced symbol/uppercase requirements): NIST 800-63B
// guidance favors length over composition rules, which also produce
// fewer frustrating rejections for legitimate users.
export function isPasswordStrongEnough(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 200;
}
