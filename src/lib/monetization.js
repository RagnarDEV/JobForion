// Central monetization domain service.
// Products and prices are server-owned; orders, transactions, entitlements,
// campaigns, refunds, affiliate clicks, and revenue events remain separate.
// No payment provider is assumed or simulated. A real provider must prove
// payment through a signed webhook before an order or entitlement is activated.

import { slugify } from './entities.js';
import { requireCompanyCapability } from './accounts/permissions.js';
import { sendEmail } from './accounts/email.js';
import { getSettings } from './settings.js';

export const MONETIZATION_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);
export const PRODUCT_TYPES = new Set(['featured_job', 'sponsored_job', 'job_boost', 'premium_company', 'paid_job_posting', 'job_package']);
export const PRODUCT_STATUSES = new Set(['active', 'inactive', 'archived']);
export const ORDER_STATUSES = new Set(['pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'expired']);
export const ENTITLEMENT_STATUSES = new Set(['pending', 'active', 'expired', 'revoked', 'refunded']);
export const CAMPAIGN_STATUSES = new Set(['draft', 'scheduled', 'active', 'paused', 'completed', 'expired', 'cancelled']);

export const DEFAULT_PRODUCTS = [
  { slug: 'featured-job', name: 'Featured Job', type: 'featured_job', description: 'Give one job a highlighted placement for a defined period.', price_minor: 900, currency: 'USD', billing_model: 'one_time', duration_days: 30, target_audience: 'employer', display_order: 10 },
  { slug: 'sponsored-job', name: 'Sponsored Job', type: 'sponsored_job', description: 'Run a clearly labelled sponsored job campaign for a defined period.', price_minor: 1900, currency: 'USD', billing_model: 'one_time', duration_days: 30, target_audience: 'employer', display_order: 20 },
  { slug: 'job-boost', name: 'Job Boost', type: 'job_boost', description: 'Increase visibility temporarily without bypassing search filters or relevance.', price_minor: 500, currency: 'USD', billing_model: 'one_time', duration_days: 7, target_audience: 'employer', display_order: 30 },
  { slug: 'premium-company', name: 'Premium Company', type: 'premium_company', description: 'Foundation for enhanced company profile capabilities backed by an entitlement.', price_minor: 4900, currency: 'USD', billing_model: 'one_time', duration_days: 30, target_audience: 'employer', display_order: 40 },
];

const JSON_LIMIT = 8000;
const MAX_PRICE_MINOR = 1000000000;
const MAX_DURATION_DAYS = 3650;

function json(value, fallback = {}) {
  if (!value) return fallback;
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return parsed && typeof parsed === 'object' ? parsed : fallback; } catch (e) { return fallback; }
}

function boundedText(value, max = 255) { return String(value || '').trim().slice(0, max); }
function positiveInt(value, max = 2147483647) { const n = Number.parseInt(value, 10); return Number.isInteger(n) && n > 0 && n <= max ? n : null; }
function nonNegativeInt(value, max = MAX_PRICE_MINOR) { const n = Number.parseInt(value, 10); return Number.isInteger(n) && n >= 0 && n <= max ? n : null; }
function isoNow() { return new Date().toISOString(); }
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString(); }
function normalCurrency(value) { const c = boundedText(value, 3).toUpperCase(); return MONETIZATION_CURRENCIES.has(c) ? c : null; }

export function formatMoneyMinor(amountMinor, currency = 'USD') {
  const amount = Number(amountMinor || 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: normalCurrency(currency) || 'USD', maximumFractionDigits: 2 }).format(amount);
}

export function parsePriceToMinor(value) {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, decimal = ''] = raw.split('.');
  const minor = Number(whole) * 100 + Number((decimal + '00').slice(0, 2));
  return Number.isSafeInteger(minor) && minor <= MAX_PRICE_MINOR ? minor : null;
}

export function productInput(input = {}) {
  const slug = slugify(boundedText(input.slug || input.name, 80)).slice(0, 80);
  const type = PRODUCT_TYPES.has(String(input.type || '')) ? String(input.type) : null;
  const currency = normalCurrency(input.currency);
  const priceMinor = input.price_minor !== undefined ? nonNegativeInt(input.price_minor) : parsePriceToMinor(input.price);
  const duration = nonNegativeInt(input.duration_days, MAX_DURATION_DAYS);
  const status = PRODUCT_STATUSES.has(String(input.status || '')) ? String(input.status) : 'active';
  const metadata = JSON.stringify(json(String(input.metadata || '{}').slice(0, JSON_LIMIT), {}));
  if (!slug || !boundedText(input.name, 120) || !type || !currency || priceMinor === null || priceMinor < 1 || duration === null || duration < 1) return null;
  return {
    slug,
    name: boundedText(input.name, 120),
    description: boundedText(input.description, 1000),
    type,
    status,
    price_minor: priceMinor,
    currency,
    billing_model: boundedText(input.billing_model || 'one_time', 30) === 'recurring' ? 'recurring' : 'one_time',
    duration_days: duration,
    target_audience: boundedText(input.target_audience || 'employer', 40),
    metadata,
    display_order: nonNegativeInt(input.display_order, 100000) ?? 100,
  };
}

export function paymentProviderStatus(env = {}) {
  const webhookConfigured = Boolean(String(env.PAYMENT_WEBHOOK_SECRET || '').trim());
  const provider = boundedText(env.PAYMENT_PROVIDER || 'unconfigured', 40).toLowerCase();
  return {
    provider: webhookConfigured && provider !== 'unconfigured' ? provider : 'unconfigured',
    checkoutConfigured: false,
    webhookConfigured,
    message: webhookConfigured ? 'Signed webhook boundary is configured; checkout adapter is not implemented until a supported provider is connected.' : 'No production payment provider is configured. Checkout stops before payment and never simulates success.',
  };
}

// Provider-neutral contract. A future adapter can implement these methods
// without changing products, orders, transactions, entitlements, or admin.
// The default implementation deliberately refuses financial state changes.
export function createPaymentService(env = {}) {
  const status = paymentProviderStatus(env);
  const unavailable = async () => ({ ok: false, code: 'provider_not_configured', provider: status.provider, message: status.message });
  return Object.freeze({
    status,
    createPayment: unavailable,
    verifyPayment: unavailable,
    processWebhook: unavailable,
    refundPayment: unavailable,
    getPaymentStatus: unavailable,
  });
}
export const PaymentService = createPaymentService;

export async function listProducts(env, { activeOnly = false } = {}) {
  try {
    const where = activeOnly ? "WHERE status = 'active'" : '';
    const { results } = await env.DB.prepare(`SELECT * FROM monetization_products ${where} ORDER BY display_order ASC, id ASC`).all();
    return (results || []).map(product => ({ ...product, metadata: json(product.metadata, {}) }));
  } catch (e) { return []; }
}

export async function getProductById(env, productId, { activeOnly = true } = {}) {
  const id = positiveInt(productId);
  if (!id) return null;
  try {
    const statusClause = activeOnly ? " AND status = 'active'" : '';
    const { results } = await env.DB.prepare(`SELECT * FROM monetization_products WHERE id = ?${statusClause} LIMIT 1`).bind(id).all();
    return results?.[0] || null;
  } catch (e) { return null; }
}

export async function getProductBySlug(env, slug, { activeOnly = true } = {}) {
  const value = slugify(boundedText(slug, 80));
  if (!value) return null;
  try {
    const statusClause = activeOnly ? " AND status = 'active'" : '';
    const { results } = await env.DB.prepare(`SELECT * FROM monetization_products WHERE slug = ?${statusClause} LIMIT 1`).bind(value).all();
    return results?.[0] || null;
  } catch (e) { return null; }
}

async function ownedJobContext(env, userId, jobId, companyId) {
  const job = positiveInt(jobId);
  if (!job) return { ok: false, error: 'A valid job_id is required.' };
  try {
    const { results } = await env.DB.prepare('SELECT id, company_id, submitted_by_user_id, title FROM jobs WHERE id = ? LIMIT 1').bind(job).all();
    const row = results?.[0];
    if (!row) return { ok: false, error: 'Job not found.' };
    const requestedCompany = positiveInt(companyId);
    const actualCompany = positiveInt(row.company_id);
    if (!actualCompany || (requestedCompany && requestedCompany !== actualCompany)) return { ok: false, error: 'This job is not attached to the requested company.' };
    const membership = await requireCompanyCapability(env, userId, actualCompany, 'edit_job');
    if (!membership) return { ok: false, error: 'You are not authorized to monetize this company job.' };
    return { ok: true, job: row, companyId: actualCompany };
  } catch (e) { return { ok: false, error: 'Unable to verify job ownership.' }; }
}

async function validateCheckoutOwnership(env, userId, product, input) {
  const companyId = positiveInt(input.company_id);
  const jobTypes = new Set(['featured_job', 'sponsored_job', 'job_boost']);
  if (jobTypes.has(product.type)) {
    return ownedJobContext(env, userId, input.job_id, companyId);
  }
  if (product.type === 'premium_company' || product.type === 'paid_job_posting' || product.type === 'job_package') {
    if (!companyId) return { ok: false, error: 'A company_id is required for this product.' };
    const membership = await requireCompanyCapability(env, userId, companyId, 'edit_company');
    return membership ? { ok: true, companyId } : { ok: false, error: 'You are not authorized to monetize this company.' };
  }
  return { ok: true, companyId };
}

export async function createPendingOrder(env, user, input = {}) {
  const product = await getProductById(env, input.product_id, { activeOnly: true }) || await getProductBySlug(env, input.product, { activeOnly: true });
  if (!product) return { ok: false, status: 404, error: 'Product is not available.' };
  const settings = await getSettings(env);
  if (product.type === 'featured_job' && settings.monetization_featured_enabled === '0') return { ok: false, status: 503, error: 'Featured Jobs are currently unavailable.' };
  if (product.type === 'sponsored_job' && settings.monetization_sponsored_enabled === '0') return { ok: false, status: 503, error: 'Sponsored Jobs are currently unavailable.' };
  const ownership = await validateCheckoutOwnership(env, user.id, product, input);
  if (!ownership.ok) return { ok: false, status: 403, error: ownership.error };
  const idempotencyKey = boundedText(input.idempotency_key, 128);
  if (!idempotencyKey) return { ok: false, status: 400, error: 'idempotency_key is required.' };
  try {
    const { results: existing } = await env.DB.prepare('SELECT * FROM monetization_orders WHERE user_id = ? AND idempotency_key = ? LIMIT 1').bind(user.id, idempotencyKey).all();
    if (existing?.[0]) return { ok: true, reused: true, order: existing[0], provider: paymentProviderStatus(env) };
    const metadata = JSON.stringify({ job_id: positiveInt(input.job_id), company_id: ownership.companyId || null, requested_product: product.slug });
    const orderRef = `JF-${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO monetization_orders (order_ref,user_id,company_id,product_id,amount_minor,currency,status,payment_provider,idempotency_key,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(orderRef, user.id, ownership.companyId || null, product.id, product.price_minor, product.currency, 'pending', 'unconfigured', idempotencyKey, metadata).run();
    const { results } = await env.DB.prepare('SELECT * FROM monetization_orders WHERE order_ref = ? LIMIT 1').bind(orderRef).all();
    const order = results?.[0];
    return { ok: true, order, product, provider: paymentProviderStatus(env), payment: null };
  } catch (e) { return { ok: false, status: 500, error: 'Unable to create a pending order.' }; }
}

export async function listUserOrders(env, userId, limit = 50) {
  try {
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
    const { results } = await env.DB.prepare(`SELECT o.*, p.slug product_slug, p.name product_name, p.type product_type FROM monetization_orders o LEFT JOIN monetization_products p ON p.id=o.product_id WHERE o.user_id = ? ORDER BY o.id DESC LIMIT ${safeLimit}`).bind(userId).all();
    return results || [];
  } catch (e) { return []; }
}

export async function listUserEntitlements(env, userId, limit = 50) {
  try {
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
    const { results } = await env.DB.prepare(`SELECT e.*, p.name product_name, p.type product_type FROM monetization_entitlements e LEFT JOIN monetization_products p ON p.id=e.product_id WHERE e.user_id = ? OR e.company_id IN (SELECT company_id FROM company_members WHERE user_id = ? AND status='active') ORDER BY e.id DESC LIMIT ${safeLimit}`).bind(userId, userId).all();
    return results || [];
  } catch (e) { return []; }
}

function entitlementKind(productType) {
  return { featured_job: 'featured', sponsored_job: 'sponsored', job_boost: 'boost', premium_company: 'premium_company', paid_job_posting: 'paid_job_posting', job_package: 'job_package' }[productType] || productType;
}

export async function activateOrderEntitlement(env, orderId, { source = 'payment' } = {}) {
  const id = positiveInt(orderId);
  if (!id) return { ok: false, error: 'Invalid order.' };
  try {
    const { results } = await env.DB.prepare(`SELECT o.*, p.type product_type, p.duration_days, p.name product_name FROM monetization_orders o JOIN monetization_products p ON p.id=o.product_id WHERE o.id = ? LIMIT 1`).bind(id).all();
    const order = results?.[0];
    if (!order || order.status !== 'paid') return { ok: false, error: 'Order is not paid.' };
    const { results: existingEntitlements } = await env.DB.prepare('SELECT * FROM monetization_entitlements WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(order.id).all();
    if (existingEntitlements?.[0]) return { ok: true, reused: true, entitlement: existingEntitlements[0] };
    const metadata = json(order.metadata, {});
    const kind = entitlementKind(order.product_type);
    const settings = await getSettings(env);
    if (kind === 'featured' && settings.monetization_featured_enabled === '0') return { ok: false, error: 'Featured Jobs are currently disabled.' };
    if (kind === 'sponsored' && settings.monetization_sponsored_enabled === '0') return { ok: false, error: 'Sponsored Jobs are currently disabled.' };
    if (kind === 'featured') {
      const { results: featuredRows } = await env.DB.prepare("SELECT COUNT(*) c FROM monetization_campaigns WHERE kind='featured' AND status='active' AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)").all();
      if (Number(featuredRows?.[0]?.c || 0) >= Number(settings.monetization_max_featured || 10)) return { ok: false, error: 'The maximum number of active Featured campaigns has been reached.' };
    }
    const startsAt = isoNow();
    const endsAt = addDays(Number(order.duration_days || 1));
    let previousJobType = null;
    if (metadata.job_id) {
      const { results: jobRows } = await env.DB.prepare('SELECT job_type FROM jobs WHERE id = ? LIMIT 1').bind(metadata.job_id).all();
      previousJobType = jobRows?.[0]?.job_type || 'Free';
    }
    await env.DB.prepare(`INSERT INTO monetization_entitlements (user_id,company_id,product_id,order_id,job_id,kind,status,starts_at,ends_at,source,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(order.user_id, order.company_id || null, order.product_id, order.id, metadata.job_id || null, kind, 'active', startsAt, endsAt, source, JSON.stringify({ ...metadata, product_name: order.product_name })).run();
    const { results: entitlementRows } = await env.DB.prepare('SELECT * FROM monetization_entitlements WHERE order_id = ? ORDER BY id DESC LIMIT 1').bind(order.id).all();
    const entitlement = entitlementRows?.[0];
    if (metadata.job_id && ['featured', 'sponsored', 'boost'].includes(kind)) {
      const jobType = kind === 'featured' ? 'Featured' : kind === 'sponsored' ? 'Sponsored' : null;
      await env.DB.prepare(`INSERT INTO monetization_campaigns (kind,job_id,company_id,entitlement_id,status,starts_at,ends_at,budget_minor,currency,priority,placement,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(kind, metadata.job_id, order.company_id || null, entitlement?.id || null, 'active', startsAt, endsAt, order.amount_minor, order.currency, kind === 'sponsored' ? 10 : 0, kind === 'sponsored' ? 'sponsored' : 'featured', JSON.stringify({ previous_job_type: previousJobType || null })).run();
      if (jobType) await env.DB.prepare('UPDATE jobs SET job_type = ? WHERE id = ? AND company_id = ?').bind(jobType, metadata.job_id, order.company_id).run();
    }
    await env.DB.prepare('INSERT INTO monetization_revenue_events (event_type,order_id,transaction_id,product_id,gross_amount_minor,currency,occurred_at,metadata) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,?)').bind('entitlement_activated', order.id, null, order.product_id, order.amount_minor, order.currency, JSON.stringify({ source, entitlement_id: entitlement?.id || null })).run();
    return { ok: true, entitlement };
  } catch (e) { return { ok: false, error: 'Unable to activate entitlement.' }; }
}

async function hmacHex(secret, value) {
  const data = new TextEncoder().encode(value);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function verifyPaymentWebhook(env, body, headers) {
  const secret = String(env.PAYMENT_WEBHOOK_SECRET || '').trim();
  if (!secret) return { ok: false, status: 503, error: 'Payment webhook secret is not configured.' };
  const timestamp = String(headers.get('X-Payment-Timestamp') || '').trim();
  const supplied = String(headers.get('X-Payment-Signature') || '').trim().replace(/^sha256=/i, '').toLowerCase();
  const epoch = Number(timestamp);
  if (!timestamp || !Number.isInteger(epoch) || Math.abs(Date.now() - epoch * 1000) > 300000 || !/^[a-f0-9]{64}$/.test(supplied)) return { ok: false, status: 401, error: 'Invalid webhook signature.' };
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return timingSafeEqual(expected, supplied) ? { ok: true } : { ok: false, status: 401, error: 'Invalid webhook signature.' };
}

export async function processPaymentWebhook(env, event) {
  const eventId = boundedText(event?.id || event?.event_id, 180);
  const orderRef = boundedText(event?.order_ref, 180);
  const provider = boundedText(event?.provider || 'custom', 40);
  const providerReference = boundedText(event?.transaction_id || event?.provider_transaction_id, 180);
  if (!eventId || !orderRef || !providerReference) return { ok: false, status: 400, error: 'Webhook event id, order_ref, and transaction_id are required.' };
  try {
    const { results: old } = await env.DB.prepare('SELECT id,status FROM monetization_webhook_events WHERE event_id = ? LIMIT 1').bind(eventId).all();
    if (old?.[0]?.status === 'processed') return { ok: true, duplicate: true };
    if (!old?.length) await env.DB.prepare('INSERT OR IGNORE INTO monetization_webhook_events (event_id,provider,status,payload,received_at) VALUES (?,?,?, ?,CURRENT_TIMESTAMP)').bind(eventId, provider, 'received', JSON.stringify(event).slice(0, JSON_LIMIT)).run();
    const { results: orders } = await env.DB.prepare('SELECT * FROM monetization_orders WHERE order_ref = ? LIMIT 1').bind(orderRef).all();
    const order = orders?.[0];
    const eventType = boundedText(event.type || event.event_type, 60);
    if (!order || !['payment.succeeded', 'payment_succeeded', 'checkout.completed'].includes(eventType)) throw new Error('Unsupported or unknown payment event.');
    const existingTransaction = await env.DB.prepare('SELECT order_id,status FROM monetization_transactions WHERE provider_reference = ? LIMIT 1').bind(providerReference).all();
    if (existingTransaction.results?.[0] && Number(existingTransaction.results[0].order_id) !== Number(order.id)) throw new Error('Provider transaction is already attached to another order.');
    const amount = nonNegativeInt(event.amount_minor);
    const currency = normalCurrency(event.currency);
    if (amount === null || amount !== Number(order.amount_minor) || currency !== order.currency) throw new Error('Webhook amount or currency does not match the order.');
    if (order.status === 'paid') {
      const recovered = await activateOrderEntitlement(env, order.id, { source: 'payment_webhook_retry' });
      if (!recovered.ok) throw new Error('Paid order entitlement is not active yet.');
      await env.DB.prepare('UPDATE monetization_webhook_events SET status = ?,processed_at = CURRENT_TIMESTAMP WHERE event_id = ?').bind('processed', eventId).run();
      return { ok: true, duplicate: true, entitlement: recovered.entitlement || null };
    }
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO monetization_transactions (order_id,provider,provider_reference,gross_amount_minor,currency,status,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(order.id, provider, providerReference, amount, currency, 'succeeded', JSON.stringify({ event_id: eventId })),
      env.DB.prepare("UPDATE monetization_orders SET status='paid',payment_provider=?,provider_transaction_id=?,paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','processing')").bind(provider, providerReference, order.id),
      env.DB.prepare('UPDATE monetization_webhook_events SET status = ?,processed_at = CURRENT_TIMESTAMP WHERE event_id = ?').bind('processed', eventId),
    ]);
    const activated = await activateOrderEntitlement(env, order.id, { source: 'payment_webhook' });
    if (!activated.ok) throw new Error('Payment was confirmed but entitlement activation needs retry.');
    if (activated.ok) {
      try {
        const { results: userRows } = await env.DB.prepare('SELECT email,name FROM users WHERE id = ? LIMIT 1').bind(order.user_id).all();
        const recipient = userRows?.[0]?.email;
        if (recipient) await sendEmail(env, { to: recipient, subject: 'Your JobForion purchase was confirmed', text: `Your order ${order.order_ref} was confirmed and the purchased feature is active.`, html: `<p>Your order <strong>${order.order_ref}</strong> was confirmed and the purchased feature is active.</p>` });
      } catch (e) {}
    }
    return { ok: true, order_id: order.id, entitlement: activated.entitlement || null };
  } catch (e) {
    try { await env.DB.prepare('UPDATE monetization_webhook_events SET status = ?,error = ? WHERE event_id = ?').bind('failed', boundedText(e.message, 300), eventId).run(); } catch (ignored) {}
    return { ok: false, status: 400, error: 'Webhook could not be processed.' };
  }
}

export async function createAffiliateClick(env, input = {}, request) {
  const programId = positiveInt(input.program_id);
  const destination = boundedText(input.destination, 1000);
  const sourcePage = boundedText(input.source_page, 300) || '/';
  if (!programId || !destination || !/^https?:\/\//i.test(destination)) return { ok: false, error: 'Invalid affiliate click.' };
  try {
    const { results } = await env.DB.prepare("SELECT id,base_url FROM affiliate_programs WHERE id = ? AND status = 'active' LIMIT 1").bind(programId).all();
    if (!results?.length) return { ok: false, error: 'Affiliate program is unavailable.' };
    const ip = boundedText(request?.headers?.get('CF-Connecting-IP'), 120);
    const ipHash = ip ? await hmacHex('jobforion-affiliate-click', ip) : '';
    await env.DB.prepare('INSERT INTO affiliate_clicks (program_id,campaign,source_page,destination,ip_hash,user_agent,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)').bind(programId, boundedText(input.campaign, 120), sourcePage, destination, ipHash, boundedText(request?.headers?.get('User-Agent'), 300)).run();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Unable to record affiliate click.' }; }
}

export async function grantAdminEntitlement(env, adminUserId, input = {}) {
  const product = await getProductById(env, input.product_id, { activeOnly: true });
  const userId = positiveInt(input.user_id);
  const companyId = positiveInt(input.company_id);
  const jobId = positiveInt(input.job_id);
  if (!product || (!userId && !companyId)) return { ok: false, error: 'An active product and an owner are required.' };
  const kind = entitlementKind(product.type);
  if (['featured', 'sponsored', 'boost'].includes(kind) && !jobId) return { ok: false, error: 'A job_id is required for this product.' };
  try {
    let previousJobType = null;
    if (jobId) {
      const { results: jobRows } = await env.DB.prepare('SELECT id,company_id,job_type FROM jobs WHERE id = ? LIMIT 1').bind(jobId).all();
      if (!jobRows?.[0] || (companyId && Number(jobRows[0].company_id) !== companyId)) return { ok: false, error: 'Job ownership is invalid.' };
      previousJobType = jobRows[0].job_type || 'Free';
    }
    const startsAt = isoNow();
    const endsAt = addDays(Number(product.duration_days || 1));
    await env.DB.prepare('INSERT INTO monetization_entitlements (user_id,company_id,product_id,order_id,job_id,kind,status,starts_at,ends_at,source,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(userId || null, companyId || null, product.id, null, jobId || null, kind, 'active', startsAt, endsAt, 'admin_grant', JSON.stringify({ admin_user_id: adminUserId, previous_job_type: previousJobType })).run();
    const { results: entRows } = await env.DB.prepare('SELECT * FROM monetization_entitlements WHERE source = \'admin_grant\' ORDER BY id DESC LIMIT 1').all();
    const entitlement = entRows?.[0];
    if (jobId && ['featured', 'sponsored', 'boost'].includes(kind)) {
      await env.DB.prepare('INSERT INTO monetization_campaigns (kind,job_id,company_id,entitlement_id,status,starts_at,ends_at,budget_minor,currency,priority,placement,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(kind, jobId, companyId || null, entitlement?.id || null, 'active', startsAt, endsAt, 0, product.currency, kind === 'sponsored' ? 10 : 0, kind, JSON.stringify({ previous_job_type: previousJobType })).run();
      if (kind !== 'boost') await env.DB.prepare('UPDATE jobs SET job_type = ? WHERE id = ?').bind(kind === 'featured' ? 'Featured' : 'Sponsored', jobId).run();
    }
    return { ok: true, entitlement };
  } catch (e) { return { ok: false, error: 'Unable to grant entitlement.' }; }
}

export async function requestRefund(env, adminUserId, input = {}) {
  const orderId = positiveInt(input.order_id);
  const amount = nonNegativeInt(input.amount_minor);
  const reason = boundedText(input.reason, 500);
  if (!orderId || amount === null || amount < 1 || !reason) return { ok: false, error: 'order_id, refund amount, and reason are required.' };
  try {
    const { results } = await env.DB.prepare('SELECT * FROM monetization_orders WHERE id = ? LIMIT 1').bind(orderId).all();
    const order = results?.[0];
    if (!order || !['paid', 'partially_refunded'].includes(order.status) || amount > Number(order.amount_minor)) return { ok: false, error: 'Refund amount or order state is invalid.' };
    await env.DB.prepare('INSERT INTO monetization_refunds (order_id,amount_minor,currency,status,reason,admin_user_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(orderId, amount, order.currency, 'requested', reason, adminUserId, JSON.stringify({ provider_status: 'not_configured' })).run();
    return { ok: true, providerConfigured: false };
  } catch (e) { return { ok: false, error: 'Unable to record refund request.' }; }
}

export async function expireMonetizationCampaigns(env) {
  try {
    const { results } = await env.DB.prepare("SELECT id,entitlement_id,job_id,kind,metadata FROM monetization_campaigns WHERE status IN ('active','scheduled') AND ends_at IS NOT NULL AND ends_at <= CURRENT_TIMESTAMP LIMIT 300").all();
    if (!results?.length) return { processed: 0 };
    for (const row of results) {
      const campaignMeta = json(row.metadata, {});
      const restoreType = ['featured', 'sponsored'].includes(row.kind) ? (campaignMeta.previous_job_type || 'Free') : null;
      const statements = [
        env.DB.prepare("UPDATE monetization_campaigns SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id),
        env.DB.prepare("UPDATE monetization_entitlements SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(row.entitlement_id),
      ];
      if (restoreType && row.job_id) statements.push(env.DB.prepare('UPDATE jobs SET job_type = ? WHERE id = ? AND job_type IN (\'Featured\',\'Sponsored\')').bind(restoreType, row.job_id));
      await env.DB.batch(statements);
    }
    return { processed: results.length };
  } catch (e) { return { processed: 0, error: 'expiration_failed' }; }
}

export async function getMonetizationOverview(env) {
  const fallback = { products: { active: 0, total: 0 }, orders: { total: 0, paid: 0, pending: 0, failed: 0, refunded: 0 }, revenue: { gross_minor: 0, net_minor: 0, currency: null, currencies: [] }, entitlements: { active: 0, featured: 0, sponsored: 0, premium_company: 0 }, affiliate_clicks: 0, ads: { enabled: 0, total: 0 }, revenueAvailable: false, revenueNote: 'No confirmed revenue events yet.' };
  try {
    const [products, orders, revenue, entitlements, clicks, ads] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active FROM monetization_products").all(),
      env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) paid, SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END) pending, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN status IN ('refunded','partially_refunded') THEN 1 ELSE 0 END) refunded FROM monetization_orders").all(),
      env.DB.prepare("SELECT currency, COALESCE(SUM(gross_amount_minor),0) gross_minor, COALESCE(SUM(net_amount_minor),0) net_minor, COUNT(*) events FROM monetization_revenue_events WHERE event_type IN ('payment_succeeded','entitlement_activated','refund_processed') GROUP BY currency").all(),
      env.DB.prepare("SELECT COUNT(*) active, SUM(CASE WHEN kind='featured' THEN 1 ELSE 0 END) featured, SUM(CASE WHEN kind='sponsored' THEN 1 ELSE 0 END) sponsored, SUM(CASE WHEN kind='premium_company' THEN 1 ELSE 0 END) premium_company FROM monetization_entitlements WHERE status='active' AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP)").all(),
      env.DB.prepare('SELECT COUNT(*) clicks FROM affiliate_clicks').all(),
      env.DB.prepare('SELECT COUNT(*) total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) enabled FROM ad_slots').all(),
    ]);
    const revenueRows = (revenue.results || []).map(row => ({ currency: normalCurrency(row.currency) || 'USD', gross_minor: Number(row.gross_minor || 0), net_minor: Number(row.net_minor || 0), events: Number(row.events || 0) }));
    const currencies = [...new Set(revenueRows.map(row => row.currency))];
    const revenueSummary = currencies.length === 1 ? { gross_minor: revenueRows[0].gross_minor, net_minor: revenueRows[0].net_minor, currency: currencies[0], currencies } : { gross_minor: null, net_minor: null, currency: null, currencies };
    return {
      products: products.results?.[0] ? { total: Number(products.results[0].total || 0), active: Number(products.results[0].active || 0) } : fallback.products,
      orders: orders.results?.[0] ? Object.fromEntries(['total', 'paid', 'pending', 'failed', 'refunded'].map(k => [k, Number(orders.results[0][k] || 0)])) : fallback.orders,
      revenue: revenueRows.length ? revenueSummary : fallback.revenue,
      entitlements: entitlements.results?.[0] ? { active: Number(entitlements.results[0].active || 0), featured: Number(entitlements.results[0].featured || 0), sponsored: Number(entitlements.results[0].sponsored || 0), premium_company: Number(entitlements.results[0].premium_company || 0) } : fallback.entitlements,
      affiliate_clicks: Number(clicks.results?.[0]?.clicks || 0),
      ads: ads.results?.[0] ? { total: Number(ads.results[0].total || 0), enabled: Number(ads.results[0].enabled || 0) } : fallback.ads,
      revenueAvailable: revenueRows.length > 0,
      revenueNote: revenueRows.length > 0 ? (currencies.length === 1 ? 'Based on recorded backend revenue events.' : `Multiple currencies reported: ${currencies.join(', ')}. Totals are intentionally not converted.`) : fallback.revenueNote,
    };
  } catch (e) { return fallback; }
}

export async function getRevenueAnalytics(env, days = 30) {
  const safeDays = [1, 7, 30, 90, 365].includes(Number(days)) ? Number(days) : 30;
  try {
    const [daily, byProduct, byProvider] = await Promise.all([
      env.DB.prepare("SELECT date(occurred_at) day, currency, SUM(gross_amount_minor) gross_minor, SUM(net_amount_minor) net_minor, COUNT(*) events FROM monetization_revenue_events WHERE occurred_at >= datetime('now', '-' || ? || ' days') GROUP BY day,currency ORDER BY day ASC").bind(safeDays).all(),
      env.DB.prepare("SELECT p.name, p.slug, e.currency, SUM(e.gross_amount_minor) gross_minor, COUNT(*) events FROM monetization_revenue_events e LEFT JOIN monetization_products p ON p.id=e.product_id GROUP BY e.product_id,e.currency ORDER BY gross_minor DESC").all(),
      env.DB.prepare("SELECT COALESCE(t.provider,'unconfigured') provider, t.currency, SUM(t.gross_amount_minor) gross_minor, COUNT(*) events FROM monetization_transactions t WHERE t.status='succeeded' GROUP BY provider,currency ORDER BY gross_minor DESC").all(),
    ]);
    return { days: safeDays, daily: daily.results || [], byProduct: byProduct.results || [], byProvider: byProvider.results || [] };
  } catch (e) { return { days: safeDays, daily: [], byProduct: [], byProvider: [] }; }
}

export async function saveProduct(env, input, productId = null) {
  const product = productInput(input);
  if (!product) return { ok: false, error: 'Invalid product fields. Use a positive price, supported currency (USD/EUR/GBP), valid type, and duration.' };
  try {
    const id = positiveInt(productId);
    if (id) {
      await env.DB.prepare(`UPDATE monetization_products SET slug=?,name=?,description=?,type=?,status=?,price_minor=?,currency=?,billing_model=?,duration_days=?,target_audience=?,metadata=?,display_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(product.slug, product.name, product.description, product.type, product.status, product.price_minor, product.currency, product.billing_model, product.duration_days, product.target_audience, product.metadata, product.display_order, id).run();
      return { ok: true, id };
    }
    await env.DB.prepare(`INSERT INTO monetization_products (slug,name,description,type,status,price_minor,currency,billing_model,duration_days,target_audience,metadata,display_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(product.slug, product.name, product.description, product.type, product.status, product.price_minor, product.currency, product.billing_model, product.duration_days, product.target_audience, product.metadata, product.display_order).run();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Product could not be saved. Slugs must be unique.' }; }
}

export async function getAffiliatePrograms(env) {
  try { const { results } = await env.DB.prepare("SELECT p.*, COUNT(c.id) clicks FROM affiliate_programs p LEFT JOIN affiliate_clicks c ON c.program_id=p.id GROUP BY p.id ORDER BY p.id DESC").all(); return results || []; } catch (e) { return []; }
}

export async function saveAffiliateProgram(env, input, programId = null) {
  const name = boundedText(input.name, 120);
  const slug = slugify(boundedText(input.slug || name, 80));
  const baseUrl = boundedText(input.base_url, 1000);
  const status = ['active', 'inactive'].includes(String(input.status)) ? String(input.status) : 'inactive';
  if (!name || !slug || !/^https?:\/\//i.test(baseUrl)) return { ok: false, error: 'Affiliate name and a valid HTTPS/HTTP base URL are required.' };
  try {
    const id = positiveInt(programId);
    if (id) await env.DB.prepare('UPDATE affiliate_programs SET name=?,slug=?,base_url=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name, slug, baseUrl, status, id).run();
    else await env.DB.prepare('INSERT INTO affiliate_programs (name,slug,base_url,status,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(name, slug, baseUrl, status).run();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Affiliate program could not be saved.' }; }
}
