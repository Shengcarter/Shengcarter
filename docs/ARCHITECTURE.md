# ZOLA STYLISH MANAGEMENT SYSTEM — Architecture

How the code base is organised, the rules every module follows, and where to make changes. For installation see the [README](../README.md); for the API see [API.md](API.md).

---

## 1. Overview

```text
┌───────────────────────────── Browser (any device) ─────────────────────────────┐
│ React 19 single-page app · TanStack Query cache · Zustand (session, theme)      │
└──────────────┬──────────────────────────────────────────────────────────────────┘
               │ HTTPS/HTTP · JSON · Authorization: Bearer <15-min access token>
               │ httpOnly refresh cookie (path /api/auth only)
┌──────────────▼──────────────────────────────────────────────────────────────────┐
│ Node.js · Express 5                                                             │
│ helmet → CORS → compression → body limits → request log → rate limits           │
│ /api/auth, /api/public (no token)  │  authenticate → requirePermission → route  │
│ routes → controllers → services (business rules, transactions) → models (SQL)   │
│ jobs: message queue, reminders, low-stock check, cleanup, scheduled backups     │
│ static: /uploads (images, receipts) · frontend/dist (when SERVE_FRONTEND=true)  │
└──────────────┬──────────────────────────────────────────────────────────────────┘
               │ mysql2 pool · UTC session time zone · prepared statements
┌──────────────▼──────────────┐     ┌────────────────────────────────────────────┐
│ MySQL 8 · 48 tables · InnoDB │     │ Optional providers: SMTP · Africa's Talking │
│ FKs, indexes, CHECKs         │     │ · Twilio · WhatsApp Cloud API · Claude API  │
└──────────────────────────────┘     └────────────────────────────────────────────┘
```

One Node.js process serves everything. It is deliberately a single process: background jobs (reminders, scheduled backups) must run once, and a salon's load is far below what one process handles.

---

## 2. Repository layout

```text
backend/
  src/
    app.js              Express app: middleware order, static files, SPA fallback, error handler
    server.js           Start-up: DB check, settings load, listen, jobs, graceful shutdown
    config/             index.js (validated env), database.js (pool, withTransaction), logger.js
    middleware/         auth (authenticate, requirePermission), validate (Zod), upload (multer),
                        rateLimiters, errorHandler
    routes/             index.js (route map) + one file per module
    controllers/        request → service → response, for the larger modules
    services/           business rules; every multi-step write is one transaction
      messaging/        provider abstraction (email, SMS, WhatsApp) + outbound queue
      insights/         optional AI provider (Claude) for insight summaries
    models/             SQL for the larger entities (customers, employees, appointments, products, users)
    validators/         Zod schemas per module + shared field rules (common.js)
    utils/              money (decimal.js), time (luxon), sequence numbers, pagination, responses, errors
    jobs/               cron-scheduled background jobs
  scripts/              migrate, seed, backup, restore, clear-demo-data, reset-password,
                        docker-entrypoint, demo/ (activity generator)
  tests/                Jest + Supertest suites against a throw-away database
frontend/
  src/
    api/client.js       fetch wrapper: bearer token, silent refresh, downloads, error shape
    routes/             router, permission guards, navigation definition
    layouts/            AppLayout (sidebar, top bar, branch switcher), AuthLayout
    features/<module>/  pages, forms, drawers and API hooks per module
    components/ui/      design system (Button, Card, DataTable, Modal, Drawer, Form fields…)
    components/charts/  ChartCard (chart + table view), time series, column, ranked and share bars
    components/print/   A4 invoice and 80 mm receipt layouts
    store/              authStore (user, permissions, tokens in memory), themeStore
    utils/format.js     money, number, date formatting in the business currency and time zone
database/
  schema.sql            baseline schema (41 tables)
  migrations/           numbered SQL files applied once each (recorded in schema_migrations)
  seed.sql              roles, permissions, reference data, default settings
  demo-data.sql         clearly-labelled demo records (optional)
docker/                 Dockerfiles and the Nginx config for the frontend container
docs/                   API, deployment, security and this document; deploy/ has Nginx and systemd examples
scripts/                configure-env.js (first-run .env), linux/ shell scripts
*.bat                   Windows setup, start, backup, restore and firewall helpers
```

**Routes, controllers and services.** Larger modules (auth, customers, employees, appointments, sales, administration) have a controller file that maps HTTP to service calls. Smaller modules keep their thin handlers inline in the route file. Either way, handlers contain no business rules: they validate input (Zod middleware), call a service with a request context, and send the standard response.

---

## 3. Request lifecycle

1. **helmet** sets CSP (`script-src 'self'`), frame, referrer and content-type headers; HSTS and `upgrade-insecure-requests` when `COOKIE_SECURE=true`.
2. **CORS** allows only same-origin requests and the origins in `FRONTEND_URL`.
3. **Body limits**: JSON and form bodies 1 MB; uploads `MAX_UPLOAD_MB` via multer with type checks.
4. **Request log** (pino): method, path (no query string), client IP, status and time. Secrets are redacted.
5. **Rate limits**: general API limit per IP; stricter limits on sign-in (per IP + email), password reset, public endpoints and heavy exports (per user).
6. **`authenticate`** verifies the access token, loads the user, role and permissions from the database on every request (so deactivation and permission changes apply immediately), enforces a forced password change, and builds `req.ctx`:
   `{ userId, user, branchId, ip, userAgent }`.
7. **`requirePermission(...codes)`** allows the request when the user has any of the codes. Record-level rules (a stylist sees only their own appointments, users only see their branch) are applied inside services using `ctx`.
8. **Validation** (`validate({ body, query, params })`) replaces the input with the parsed Zod result; unknown fields are stripped.
9. **Service** performs the work — reads, or a transaction for writes.
10. **Response**: `{ success: true, message, data, meta? }`, or via the error handler `{ success: false, message, code?, errors? }`. Stack traces and SQL messages are never sent in production.

---

## 4. Core rules

### Money
All amounts are `DECIMAL(14,2)` in MySQL and calculated with **decimal.js** (`utils/money.js`) — never JavaScript floating point. The server recalculates every price, discount, tax, total, change and balance from the database; totals sent by the browser are ignored. The POS formula lives in one pure, unit-tested module (`services/pricing.js`): line amounts are rounded to the currency's decimals, invoice discounts and loyalty redemptions are allocated across lines (the last line absorbs the rounding remainder, so line amounts always add up to the total exactly), and tax is off by default (the listed price is what the customer pays) or inclusive or exclusive as configured in Settings. Receipts, invoices and reports read these stored figures, so they always agree.

### Service money split
Every service sold is split by **one engine**, `services/financialRules.js` (`calculateServiceFinancials`, pure and unit-tested in `tests/financial-rules.test.js`), whether it is sold at the till, recorded later for a previous date, corrected or imported from Excel. Each service points at a versioned rule (`service_financial_rules`, `services.financial_rule_id`): the general formula (Settings → Financial), price bands (fixed / percentage / "the rest" parts, or "general formula" for a band), or not configured. The engine never guesses: a price outside every band, an unconfigured service or parts that do not add up throw a `FinancialRuleError` that the caller turns into a 422 (or a flagged import row). Every result is checked to balance (products + operations + staff pool + salon profit = price; staff shares = staff pool, remainders to the first shares) and the database enforces the same with a CHECK constraint. Each `sale_item_finance` row stores the method, rule id/version and a snapshot of the rule applied, so a later rule change never alters a past sale and a correction recalculates with the rule the sale was made with. Default rules are set up by `scripts/lib/serviceRules.js` (`servicePresets.js`) on seeding, without ever replacing a rule configured by hand.

### Business date and entry time
`sales.sold_at` is the business date of a sale; `sales.created_at` is when it was entered (never the business date, except for generated demo history). A sale recorded for a previous date (`source = backdated`) keeps its reason and `original_sold_at`; payments (`paid_at`) and commissions (`earned_at`) use the business date, while stock movements are dated when entered. Voiding reverses everything a sale did and keeps the record; changing its date moves its payments, commissions and service breakdown with it.

### Time
The database session time zone is UTC and every `DATETIME` is stored in UTC. The business time zone (Settings, default `Africa/Dar_es_Salaam`) is applied with luxon when interpreting user input (e.g. "today", a booking at 14:00) and in SQL with `CONVERT_TZ(column, '+00:00', <validated offset>)` when grouping reports by local day. The browser formats with the same business time zone, not the device's.

### Transactions and locking
`db.withTransaction(async (conn) => { … })` wraps every multi-step write — a sale (lines, payments, stock movements, loyalty, appointment status, audit), a refund, receiving a purchase, a commission payout, stock counts. Any error rolls everything back. Deadlocks and lock-wait timeouts are retried automatically (three attempts).

Race conditions are prevented with row locks inside the transaction:

| Operation | Lock | Prevents |
| --- | --- | --- |
| Booking / rescheduling | stylist row `FOR UPDATE`, then overlap check | double-booking the same stylist |
| Sale | product rows, customer row, appointment row `FOR UPDATE` | overselling stock, double-spending loyalty points, billing an appointment twice |
| Payment / refund | sale row `FOR UPDATE` | over-refunding, paying more than the balance |
| Document numbers | atomic `UPDATE … LAST_INSERT_ID(current_value + 1)` on `sequences` | duplicate invoice/receipt numbers |

### Inventory ledger
Stock is never edited directly. Every change (purchase, sale, products used on a service, refund, count adjustment, damage, salon use) writes a `stock_movements` row with the quantity change and `balance_after`, and updates `products.quantity` in the same transaction. The ledger therefore always explains the current quantity, and the tests check that it does.

### Branches
Business records carry `branch_id`. Users work in their own branch; users with `branches.manage` can switch branch with the `X-Branch-Id` header (the branch switcher in the top bar). Services filter by `ctx.branchId`; the branch comparison report is the only cross-branch view.

### Audit
`auditService.record(ctx, { action, entityType, entityId, description, metadata, before, after }, conn)` writes to `activity_logs`, with the previous and new values (`old_values`, `new_values`), IP address and device. Inside a transaction it uses the same connection so the entry commits or rolls back with the change. Sign-ins, failed sign-ins, lockouts, user/role changes, sales, sales recorded for a previous date, refunds, voids, date changes, corrections, financial rule changes, stock adjustments, settings changes, exports, backups and restores are recorded.

### Settings
`settings` rows (keys grouped as `business.*`, `financial.*`, `loyalty.*`, `notifications.*`, `system.*`, `backup.*`, `integrations.*`) are cached in memory with a short TTL (`settingsService.ensureFresh()` on each request). Secrets entered in *Settings → Integrations* are encrypted with AES-256-GCM (`utils/crypto.js`, key `APP_ENCRYPTION_KEY` or derived from `JWT_SECRET`) and never returned to the browser — only whether they are set.

---

## 5. Authentication

- **Passwords**: bcrypt (`BCRYPT_ROUNDS`, default 12); at least 8 characters with letters and numbers. Lockout after `LOGIN_MAX_ATTEMPTS` failures for `LOGIN_LOCK_MINUTES`.
- **Sessions**: each sign-in is a session — a refresh-token *family* whose id (`sid`) is in every access token. `authenticate` checks on every request that the session still has an unrevoked, unexpired token, so revoking a family (sign-out, password change, reset, deactivation, theft detection, maximum age) stops its access tokens at once.
- **Access token**: JWT (HS256, `JWT_SECRET`), 15 minutes, kept in memory by the web app (not in `localStorage`).
- **Refresh token**: random 384-bit value in an HttpOnly, `SameSite=Strict` cookie scoped to `/api/auth` (`Secure` when `COOKIE_SECURE=true`), stored only as a SHA-256 hash. Each refresh **rotates** it. Presenting an already-rotated token outside a short grace window revokes the whole family (theft detection). Sessions end after `SESSION_HOURS` idle and `SESSION_MAX_HOURS` after sign-in (`REFRESH_TOKEN_DAYS` with "remember me"). Sign-in, refresh and sign-out check the request's `Origin`/`Referer` (`middleware/sameOrigin.js`).
- **Browser**: `features/auth/sessionSync.js` signs out every tab together, reloads pages restored from the back/forward cache and re-checks the session when a tab is shown again; sign-out leaves with `location.replace('/login')`. The app page and API responses are `Cache-Control: no-store`.
- **Forced password change**: new accounts, seeded administrators and administrator resets must choose a new password before any other endpoint works.

See [SECURITY.md](SECURITY.md) for the complete list of controls.

---

## 6. Permissions

46 permission codes in 13 modules (`module.action`, e.g. `pos.refund`, `reports.financial`, `appointments.view_own`). Roles are sets of permissions editable in *Settings → Roles & permissions*; the Super Admin role always has all of them. The web app hides navigation and buttons the user cannot use, but **the API is the enforcement point** — every route declares its permissions, and the tests check each default role against the modules it may and may not reach, plus record-level rules (a stylist's own appointments, branch isolation).

To add a permission: insert it in `database/seed.sql` (and a migration for existing installs), grant it to roles there, use `requirePermission('module.action')` on the route, and add it to the navigation guard in `frontend/src/routes`.

---

## 7. Background jobs

`src/jobs/index.js` schedules (node-cron, server time, guarded against overlapping runs):

| Job | Schedule | Work |
| --- | --- | --- |
| message-queue | every 30 s | send queued SMS/WhatsApp/email with retries and backoff |
| appointment-reminders | every 5 min | queue reminders for upcoming appointments (per Settings) |
| low-stock-check | daily 07:00 | in-app notifications for products at or below their reorder level |
| notification-cleanup | daily 03:30 | delete old read notifications |
| scheduled backup | from Settings (business time zone) | database backup + retention |

`JOBS_ENABLED=false` disables them (for example on a second, read-only instance).

---

## 8. Messaging and AI providers

**Messaging** (`services/messaging`): each channel has a provider module — email (SMTP via nodemailer), SMS (Africa's Talking, Twilio), WhatsApp (Meta Cloud API, Twilio). Credentials come from *Settings → Integrations* or `.env`. Without credentials the provider is `log`: the message is recorded in `message_logs` as not sent, and nothing fails. Messages are queued, sent by the job with retries, and every attempt is logged. Promotional messages go only to customers who opted in. WhatsApp messages the salon starts are sent as Meta-approved templates when one is configured per message type: the queue stores the values in placeholder order (`template_params`) and the provider sends them as `{{1}}`, `{{2}}`, …. Customer replies arrive at the signed webhook (`routes/webhookRoutes.js`) and `services/messaging/replies.js` classifies them (English and Swahili), updates the appointment, answers the customer and alerts staff; incoming messages are stored in `message_logs` with `direction = 'inbound'`.

**Insights** (`services/insightService.js`): a rule engine computes trends, risks and opportunities from aggregated figures (sales vs. previous period, retention, low stock, top/bottom services, staff utilisation, overdue balances). If `AI_PROVIDER=anthropic` and `AI_API_KEY` are set, the same aggregated figures (no customer names or phone numbers) are sent to the Claude API for a written summary; on any error or refusal the rule-based text is used.

---

## 9. Reports and exports

`reportService` returns JSON for each report (sales, customers, services, staff, inventory, expenses, profit & loss, service costing, branches) with the period, comparison with the previous period and a table. `exportService` renders the same data to CSV (UTF-8 BOM, formula-injection protection), Excel (ExcelJS with number formats) and PDF (PDFKit with business header and page numbers). Exports require `reports.export` and are audited.

Profit & loss is on a cash basis: net sales − cost of goods sold (purchase price at the time of sale) − expenses (including commission paid out). Staff are paid by commission only; because commission is paid out once a period, cash profit jumps on payday, so the P&L and the dashboard also show **profit after commission**: gross profit − running costs (every expense except commission payouts) − commission earned in the period (`commissionEarned`: commission when earned, refunds excluded, plus payout bonuses minus deductions spread over each payout's days). Once all commission for a period has been paid out, the two figures are equal. The expense insights compare running costs and commission the same way, so they are not distorted by paydays.

**Several staff on one job.** `appointment_staff` holds an appointment's team (the first is also `appointments.employee_id`); conflicts, availability and working hours are checked for every member, and the calendar shows the appointment in each member's column. `sale_item_staff` holds who performed each sale line with their equal share of its value and of its staff pool (`pricing.splitEvenly` gives the rounding remainder one unit at a time so shares always add up); `commissions` has one row per person per line. Staff reports, the dashboard and employee performance read the shares, so staff figures add up to the salon's total.

**Service costing.** Every service sold is split by `services/costing.js` (pure, unit-tested) in a fixed order: price charged − cost of the products actually used → operations % → staff % / salon profit % of the rest (Settings → Financial; staff + salon must be 100 %). Product cost is the quantity used × the product's recorded purchase cost per usage unit (`purchase_price ÷ usage_per_unit`, e.g. a 10,000 bottle of 500 ml costs 20 per ml), never the retail price. `serviceFinanceService` does the rest inside the sale's transaction: it saves the products used (`sale_item_products`, with the unit cost at that moment), takes them out of stock (`service_use` ledger rows; stock is `DECIMAL(12,3)` so 0.2 of a bottle is exact), saves the breakdown with the percentages used (`sale_item_finance`, whose check constraint requires product cost + operations + staff pool + salon profit = price), and writes each person's share as their commission. Zero or negative margins pay nobody a negative amount: operations and staff get 0, a loss is negative salon profit, and the line waits for review. Recipes (`service_products`) and products recorded by stylists on appointments (`appointment_products`) only pre-fill checkout. Corrections (`sales.correct`) recalculate with the original percentages, move stock for the difference, update commissions and pending payouts (refused once a commission is paid out) and keep before/after snapshots in `sale_item_finance_revisions`. Sales' `cost_of_goods` includes the products used on services, so the profit & loss counts them.

Extension points: a split rule other than `equal` (`financial.staff_split_rule`, stored per breakdown), other percentages per service or staff member (the rates are stored per breakdown, not looked up later), and batch costing (the unit cost is chosen in one place, `serviceFinanceService.priceUsage`).

---

## 10. Frontend

- **Data**: TanStack Query for all server data (`features/<module>/api.js` hooks); mutations invalidate the related queries. No business calculations happen only in the browser — totals shown before saving come from the server's quote endpoint or are replaced by the server's result.
- **Auth**: `api/client.js` attaches the access token, refreshes it once on `401`, and signs out on refresh failure. Tokens live in memory; a page reload restores the session through the refresh cookie.
- **Guards**: routes and navigation items declare permissions (`routes/`); forbidden pages show a 403 page.
- **Design system**: `components/ui` — rose-pink theme (brand `#E3166A`, navy `#141A2E` sidebar, blush-white `#FDF7F8` background) with light (default) and dark modes. Colours are CSS variables in `src/index.css`: the `brand` scale, semantic tokens (`canvas`, `surface`, `fg`, `muted`, `accent`…) that switch with the theme, and a `.theme-sidebar` scope that keeps the sidebar navy in both modes. Text colours meet WCAG AA (4.5:1). Also responsive tables that become cards on phones, accessible dialogs and drawers, skeleton loading states, empty and error states.
- **Charts**: `components/charts` — every chart has a table view for accessibility and exact figures. Series colours come from one validated palette (`charts/theme.js`: pink, blue, green, purple, orange, teal, with separate light and dark steps) that keeps neighbouring colours distinguishable for colour-blind readers.
- **Printing**: `components/print` — A4 invoice and 80 mm thermal receipt layouts with print-specific CSS; PDFs of the same documents come from the server.

---

## 11. Database migrations

`database/schema.sql` is the **frozen baseline**. `npm run migrate` applies it to an empty database (recording `000_baseline`), then applies every `database/migrations/NNN_description.sql` not yet listed in `schema_migrations`, in file-name order — on new and existing installations alike, so both always end with the same schema. Rules:

1. Never change `schema.sql` or a released migration; every change is a new numbered migration file.
2. One logical change per file; a file that fails leaves the version unrecorded, so fix it and run `migrate` again (write statements so a partly applied file can be re-run, or keep each file to a single DDL statement — MySQL commits DDL immediately).
3. Test the migration on a copy of a real backup before releasing it.

---

## 12. Testing

| Suite | Tool | Covers |
| --- | --- | --- |
| `backend/tests/*.test.js` | Jest + Supertest | authentication and sessions, permissions per role, customer CRUD, appointment conflicts, POS sales/payments/refunds and concurrency, Excel/CSV imports, WhatsApp messages and replies, inventory ledger, reports and exports, financial calculations, backups |
| `frontend/src/**/*.test.js` | Vitest | formatting and report period helpers |

Backend tests create a throw-away database `zola_stylish_test` (dropped and recreated per run) using the same schema, migrations and seed as production. Run `npm test` in `backend/` and `frontend/`.

---

## 13. Adding a module (checklist)

1. Schema: table(s) in `schema.sql` + a migration; `branch_id`, `created_by`, UTC timestamps.
2. Permissions in `seed.sql` (+ migration) and role grants.
3. Validators (`src/validators`), service (transactions, `ctx`, audit), routes with `requirePermission`, mount in `routes/index.js`.
4. Tests for the rules and the permission matrix.
5. Frontend: `features/<module>/api.js` hooks, pages and forms, route + navigation entry with its permission.
6. Document the endpoints in `docs/API.md`.
