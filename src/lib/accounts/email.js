// src/lib/accounts/email.js
// ════════════════════════════════════════════════════════════════
// EMAIL ABSTRACTION LAYER — the rest of the account system (register,
// verify-email, forgot-password) calls ONLY sendEmail() below and never
// touches a provider's API directly. This project currently has no
// transactional email provider configured, so sendEmail() falls back to
// logging the message (never the raw token itself — see redaction
// below) to admin_activity_log, which keeps every flow fully
// functional and testable via the Admin Dashboard even before a real
// provider is wired up.
//
// TO CONNECT A REAL PROVIDER LATER (e.g. Resend, Postmark, SendGrid,
// MailChannels): implement one function matching this same signature,
// point EMAIL_SENDER at it, and nothing else in the codebase changes —
// this is the "abstraction layer" the plan asks for (§9).
// ════════════════════════════════════════════════════════════════

import { logActivity } from '../activity-log.js';

async function consoleFallbackSender(env, { to, subject }) {
  // Deliberately logs ONLY the recipient + subject, never the body (the
  // body contains the raw verification/reset link with its token) — see
  // plan §23, "don't leak tokens in logs". Once a real provider is
  // configured this function is never called for production traffic.
  await logActivity(env, 'email_not_sent_no_provider', to, { subject });
  return { sent: false, reason: 'no_provider_configured' };
}

// Swap this for a real provider call when one is available. Example shape
// for a webhook-style provider (e.g. MailChannels on Workers, or a
// Resend fetch call):
//
//   async function realSender(env, { to, subject, text, html }) {
//     const res = await fetch('https://api.provider.example/send', {
//       method: 'POST',
//       headers: { 'Authorization': `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
//       body: JSON.stringify({ to, subject, text, html, from: 'no-reply@yourdomain.com' }),
//     });
//     return { sent: res.ok };
//   }
//
// then: export const EMAIL_SENDER = realSender;
export const EMAIL_SENDER = consoleFallbackSender;

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
    subject: 'Verify your email address',
    text: `Welcome! Verify your email by visiting: ${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Welcome! Please verify your email address.</p><p><a href="${link}">Verify Email</a></p><p>This link expires in 24 hours.</p>`,
  };
}

export function passwordResetEmailContent(base, token) {
  const link = `${base}/reset-password?token=${token}`;
  return {
    subject: 'Reset your password',
    text: `Reset your password by visiting: ${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `<p>Reset your password by clicking below.</p><p><a href="${link}">Reset Password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
  };
}
