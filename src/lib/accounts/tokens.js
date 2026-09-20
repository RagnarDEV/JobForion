// src/lib/accounts/tokens.js
// Shared CSPRNG token generation + SHA-256 hashing, used by
// session.js (bearer session tokens), and the email-verification /
// password-reset flows in auth.router.js. Centralized so every "random
// token that must be unguessable and never stored raw" in the account
// system goes through the exact same, reviewed code path.

export function generateToken(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
