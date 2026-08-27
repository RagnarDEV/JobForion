import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  DEFAULT_PRODUCTS, parsePriceToMinor, productInput, paymentProviderStatus,
  createPaymentService, verifyPaymentWebhook,
} from '../src/lib/monetization.js';

assert.equal(parsePriceToMinor('19.00'), 1900);
assert.equal(parsePriceToMinor('19.9'), 1990);
assert.equal(parsePriceToMinor('19.999'), null);
assert.equal(parsePriceToMinor('-1'), null);
assert.equal(parsePriceToMinor('free'), null);
assert.equal(DEFAULT_PRODUCTS.length, 4);
const product = productInput({ name: 'Featured Job', slug: 'featured-job', type: 'featured_job', price: '9.00', currency: 'USD', duration_days: '30', status: 'active' });
assert.equal(product.price_minor, 900);
assert.equal(product.currency, 'USD');
assert.equal(product.duration_days, 30);
assert.equal(productInput({ name: 'Bad', type: 'featured_job', price: '9', currency: 'JPY', duration_days: 30 }), null);
assert.equal(productInput({ name: 'Bad', type: 'featured_job', price: '9', currency: 'USD', duration_days: 0 }), null);
assert.equal(paymentProviderStatus({}).checkoutConfigured, false);
assert.equal(paymentProviderStatus({}).provider, 'unconfigured');
const paymentService = createPaymentService({});
for (const method of ['createPayment', 'verifyPayment', 'processWebhook', 'refundPayment', 'getPaymentStatus']) assert.equal((await paymentService[method]({})).code, 'provider_not_configured');

const body = JSON.stringify({ id: 'evt_test_1', type: 'payment.succeeded', order_ref: 'JF-test', transaction_id: 'txn_test_1', amount_minor: 900, currency: 'USD' });
const timestamp = Math.floor(Date.now() / 1000).toString();
const secret = 'test-webhook-secret';
const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
const headers = new Headers({ 'X-Payment-Timestamp': timestamp, 'X-Payment-Signature': `sha256=${signature}` });
assert.deepEqual(await verifyPaymentWebhook({ PAYMENT_WEBHOOK_SECRET: secret }, body, headers), { ok: true });
assert.equal((await verifyPaymentWebhook({}, body, headers)).status, 503);
assert.equal((await verifyPaymentWebhook({ PAYMENT_WEBHOOK_SECRET: secret }, body, new Headers({ 'X-Payment-Timestamp': timestamp, 'X-Payment-Signature': 'bad' }))).status, 401);

const apiSource = fs.readFileSync(new URL('../src/routes/api.router.js', import.meta.url), 'utf8');
const schemaSource = fs.readFileSync(new URL('../src/db/schema.js', import.meta.url), 'utf8');
const serviceSource = fs.readFileSync(new URL('../src/lib/monetization.js', import.meta.url), 'utf8');
const pricingSource = fs.readFileSync(new URL('../src/pages/pricing.js', import.meta.url), 'utf8');
const adminSource = fs.readFileSync(new URL('../src/routes/admin/monetization.router.js', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../src/lib/settings.js', import.meta.url), 'utf8');
const cmsSource = fs.readFileSync(new URL('../src/lib/pages-cms.js', import.meta.url), 'utf8');
assert.match(apiSource, /createPendingOrder/);
assert.match(apiSource, /verifyPaymentWebhook/);
assert.match(apiSource, /X-CSRF-Token/);
assert.match(serviceSource, /product\.price_minor/);
assert.match(serviceSource, /No production payment provider is configured/);
assert.match(serviceSource, /amount !== Number\(order\.amount_minor\)/);
assert.doesNotMatch(serviceSource, /card_number|cvv/i);
assert.match(serviceSource, /provider_not_configured/);
assert.match(serviceSource, /INSERT OR IGNORE INTO monetization_transactions/);
assert.match(pricingSource, /Payment setup required/);
assert.match(pricingSource, /noindex, nofollow/);
assert.match(adminSource, /\/admin\/monetization/);
assert.match(adminSource, /\/admin\/monetization\/products\/save/);
assert.match(adminSource, /\/admin\/monetization\/settings/);
assert.match(apiSource, /\/api\/monetization\/transactions/);
assert.match(apiSource, /\/api\/monetization\/refunds/);
assert.match(cmsSource, /'pricing'/);
for (const key of ['monetization_featured_enabled', 'monetization_sponsored_enabled', 'monetization_max_featured', 'monetization_ordering']) assert.match(settingsSource, new RegExp(key));
for (const table of ['monetization_products', 'monetization_orders', 'monetization_transactions', 'monetization_entitlements', 'monetization_campaigns', 'monetization_refunds', 'affiliate_programs', 'affiliate_clicks', 'monetization_revenue_events', 'monetization_webhook_events']) assert.match(schemaSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
console.log('monetization tests: all assertions passed');
