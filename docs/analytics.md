# JobForion Analytics & Business Intelligence

## Architecture

Public pages send only whitelisted, bounded events to `POST /api/analytics/events`. The endpoint validates the event type, truncates text, removes sensitive metadata keys, derives the authenticated user id from the server session when available, and applies an IP-based rate limit. It stores events in `analytics_event_queue` using `INSERT OR IGNORE` for event-id deduplication. Sensitive rate-limit keys and visitor fingerprints are hashed before durable storage; raw IP addresses and browser session IDs are not stored.

An hourly Worker cron runs `aggregateAnalytics()`. It reads at most 300 pending events, groups them by local metric date and bounded dimensions, upserts compact rows into `analytics_daily`, and separately updates `analytics_search_daily` and `analytics_filter_daily`. This prevents a permanent D1 write for every page view from becoming the primary storage model. The queue is retained only for the configured retention period and also provides a limited, anonymized recent-activity view.

Revenue and payment metrics are derived from successful rows in `monetization_transactions`, with refunds read from `monetization_refunds`; revenue event rows are audit evidence, not a second billing ledger. Job and company metrics remain derived from authoritative existing tables. Analytics is not a second source of truth for those business records.

## Supported events

The current whitelist includes `page_view`, `job_impression`, `job_view`, `job_apply_click`, `job_favorite`, `job_share`, `company_view`, `company_follow`, `search`, `search_result_click`, `filter_used`, `category_view`, `country_view`, `signup`, `login`, `job_post_started`, `job_post_completed`, `premium_view`, `checkout_started`, `payment_started`, `payment_success`, `payment_failed`, `payment_refunded`, `featured_job_activated`, `sponsored_job_activated`, `affiliate_click`, and `affiliate_conversion`.

Client events are intentionally limited to behavior that can be observed without delaying navigation. Successful signup/login and confirmed payment/activation events are emitted from server-controlled paths. Revenue and payment status are never accepted from client analytics payloads.

## Database tables

| Table | Purpose |
|---|---|
| `analytics_event_queue` | Bounded raw event queue with dedupe id and processed timestamp. |
| `analytics_daily` | Compact aggregate by local date, event type, job/company, country, device and acquisition dimensions. |
| `analytics_search_daily` | Search volume, zero-result searches and result clicks by query and date. |
| `analytics_filter_daily` | Filter name/value usage by date. |
| `analytics_alerts` | Open/resolved anomaly alerts without personal data. |
| `analytics_daily_uniques` | Daily hashed visitor fingerprints used for bounded distinct counting. |
| `job_tombstones` | Minimal deleted-job identity used to return accurate 410 responses. |

All new tables and indexes are created idempotently in `src/db/schema.js`. No destructive migration is used. `job_tombstones` contains only job id/handle/url and is cleaned after a long bounded retention period; it does not contain applicants, employer profiles, descriptions or payment data.

## Privacy and retention

The system does not store passwords, tokens, API keys, card data, CVV, full IP addresses, email addresses, phone numbers or exact location. Client session identifiers are converted to a daily keyed hash for deduplication and are never written to aggregate tables in raw form. Metadata is recursively bounded and redacted by key name. The optional `ANALYTICS_HASH_SECRET` should be configured with `wrangler secret put` in production; the CSRF secret is the fallback pepper when available.

The administrator can select 30, 60, 90, 180, 365 days or Unlimited from `/admin/analytics`. The hourly aggregator also runs cleanup for the queue, daily aggregates, search/filter aggregates and resolved alerts. A protected purge action can delete only analytics tables and legacy visit rows before an explicit historical date; it cannot delete jobs, users, orders or transactions. Reporting timezone is restricted to a predefined safe list: UTC, America/New_York, Europe/London, Asia/Dubai and Asia/Tokyo.

## Admin API

All endpoints below require the existing admin cookie and are never public:

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/analytics/overview` | Executive metrics, funnel, revenue and health. |
| `GET /api/admin/analytics/traffic` | Source grouping and daily trend. |
| `GET /api/admin/analytics/jobs` | Top jobs by impressions/views/applies. |
| `GET /api/admin/analytics/companies` | Company performance from linked records. |
| `GET /api/admin/analytics/searches` | Search volume and zero-result opportunities. |
| `GET /api/admin/analytics/filters` | Filter adoption. |
| `GET /api/admin/analytics/funnel` | Visitor-to-apply conversion stages. |
| `GET /api/admin/analytics/revenue` | Existing monetization revenue analytics. |
| `GET /api/admin/analytics/payments` | Payment status aggregates from transactions. |
| `GET /api/admin/analytics/affiliate` | Affiliate click aggregates. |
| `GET /api/admin/analytics/geography` | Country aggregates. |
| `GET /api/admin/analytics/devices` | Device aggregates. |
| `GET /api/admin/analytics/realtime` | Recent anonymized queue activity. |
| `GET /api/admin/analytics/alerts` | Open alerts and queue health. |
| `GET /api/admin/analytics/export?type=...` | CSV for traffic, jobs, companies, searches and filters. |
| `POST /admin/analytics/purge` | Explicitly confirmed deletion of analytics/legacy visit data before a past date only. |

## Cron requirements

`wrangler.toml` adds `15 * * * *` for aggregation, retention cleanup and anomaly evaluation. A short D1 lease prevents overlapping cron executions; provider sync also retains its per-provider lock. Existing job sync, cleanup, alert dispatch, blog generation and monetization expiration crons remain registered.

## Troubleshooting

If the Analytics page reports an unavailable health state, first verify that the Analytics tables were created during Worker bootstrap and that the hourly cron is present. If activity is empty, the expected state is an explicit empty message rather than fabricated zero-value charts. If retention is disabled, `analytics_retention` is `unlimited`; otherwise cleanup uses the selected value.

Analytics failures are caught at intake, aggregation, cleanup, alert evaluation and public client calls. A failed tracking call must not block job rendering, search, apply, authentication or payment flows.

## References

- [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/scheduled-event/)
- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
