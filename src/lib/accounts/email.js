// src/lib/accounts/email.js
// ════════════════════════════════════════════════════════════════
// EMAIL ABSTRACTION LAYER — the rest of the account system (register,
// verify-email, forgot-password) calls ONLY sendEmail() below and never
// touches a provider's API directly.
//
// PROVIDER: Brevo (formerly Sendinblue) transactional email API
// (https://api.brevo.com/v3/smtp/email). Falls back automatically to
// logging-only (consoleFallbackSender) if env.BREVO_API_KEY isn't set,
// so every auth flow stays fully functional/testable even before the
// secret is configured in a given environment (e.g. local dev).
//
// REQUIRED SECRETS/VARS (set via `wrangler secret put <name>` — NEVER
// hardcoded here or committed to wrangler.toml):
//   BREVO_API_KEY      — the xkeysib-... key from Brevo → SMTP & API
//   EMAIL_FROM_ADDRESS  — a sender verified in Brevo → Senders & IP → Senders
//   EMAIL_FROM_NAME     — display name shown in the recipient's inbox
//
// TO SWITCH PROVIDERS LATER: implement one function matching
// realSender()'s signature, point EMAIL_SENDER at it — nothing else in
// the codebase changes (this is the "abstraction layer" the plan asks
// for, §9).
// ════════════════════════════════════════════════════════════════

import { logActivity } from '../activity-log.js';

async function consoleFallbackSender(env, { to, subject }) {
  // Deliberately logs ONLY the recipient + subject, never the body (the
  // body contains the raw verification/reset link with its token) — see
  // plan §23, "don't leak tokens in logs".
  await logActivity(env, 'email_not_sent_no_provider', to, { subject });
  return { sent: false, reason: 'no_provider_configured' };
}

async function brevoSender(env, { to, subject, text, html }) {
  const fromEmail = env.EMAIL_FROM_ADDRESS;
  const fromName = env.EMAIL_FROM_NAME || 'JobForion';
  if (!fromEmail) {
    // A configured API key with no verified sender address would just
    // fail on every send — fail loudly here (caught by sendEmail's
    // try/catch below) rather than silently mis-sending.
    throw new Error('EMAIL_FROM_ADDRESS is not set');
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    // Read the body for the activity log (Brevo returns a JSON error
    // with a `message` field) but never let a send failure throw past
    // sendEmail() itself and break the calling auth flow (register /
    // forgot-password must still succeed even if the email bounces).
    let detail = `HTTP ${res.status}`;
    try { const body = await res.json(); if (body?.message) detail = body.message; } catch (e) {}
    throw new Error(detail);
  }
  return { sent: true };
}

// EMAIL_SENDER auto-selects Brevo once BREVO_API_KEY is configured for
// the current environment (e.g. via `wrangler secret put BREVO_API_KEY`),
// otherwise falls back to logging only — this is what keeps local dev
// and any environment without the secret fully functional.
async function autoSender(env, args) {
  if (env.BREVO_API_KEY) return brevoSender(env, args);
  return consoleFallbackSender(env, args);
}
export const EMAIL_SENDER = autoSender;

export async function sendEmail(env, { to, subject, text, html }) {
  try {
    return await EMAIL_SENDER(env, { to, subject, text, html });
  } catch (e) {
    await logActivity(env, 'email_send_failed', to, { subject, error: String(e.message || e).slice(0, 200) });
    return { sent: false, reason: 'send_failed' };
  }
}

export function verificationEmailContent(base, token) {
  const link = `${base}/verify-email?token=${token}`;
  return {
    subject: 'Verify your JobForion email address',
    text: `Welcome to JobForion! Verify your email by visiting: ${link}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#12162B">Welcome to JobForion 👋</h2>
      <p style="color:#525A72;line-height:1.6">Please verify your email address to activate your account.</p>
      <p><a href="${link}" style="display:inline-block;background:#3556FF;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">Verify Email</a></p>
      <p style="color:#8890A4;font-size:13px">This link expires in 24 hours. If you didn't create this account, you can safely ignore this email.</p>
    </div>`,
  };
}

export function passwordResetEmailContent(base, token) {
  const link = `${base}/reset-password?token=${token}`;
  return {
    subject: 'Reset your JobForion password',
    text: `Reset your password by visiting: ${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#12162B">Reset your password</h2>
      <p style="color:#525A72;line-height:1.6">Click below to choose a new password for your JobForion account.</p>
      <p><a href="${link}" style="display:inline-block;background:#3556FF;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700">Reset Password</a></p>
      <p style="color:#8890A4;font-size:13px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.</p>
    </div>`,
  };
}
