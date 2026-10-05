# ZOLA STYLISH MANAGEMENT SYSTEM — REST API

Every feature of the web application is backed by this API. The browser app is just one client: the same endpoints can be used by scripts, a mobile app or integrations.

- **Base URL:** `http://<server>:5000/api` (or `https://your-domain/api` behind Nginx)
- **Format:** JSON in, JSON out (UTF-8). Money values are numbers in the configured currency; dates are ISO 8601 (timestamps in UTC, calendar dates as `YYYY-MM-DD`).
- **Time zone:** date filters (`from`, `to`, `date`) are business-local dates (Settings → System → time zone, default `Africa/Dar_es_Salaam`). A naive time such as `2026-10-01T10:30` is read in the business time zone.

## Responses

```json
{ "success": true, "message": "OK", "data": { } }
```

Lists add pagination (and sometimes a summary):

```json
{ "success": true, "data": [ ], "pagination": { "page": 1, "limit": 20, "total": 128, "totalPages": 7 } }
```

List endpoints accept `page`, `limit` (max 100), `search`, and where supported `sortBy` + `sortOrder` (`asc`/`desc`).

Errors use the same envelope with `success: false`:

| Status | Meaning |
| --- | --- |
| 400 | The request cannot be carried out (for example refunding a cancelled sale) |
| 401 | Not signed in / token expired (`code` tells which) |
| 403 | Signed in but the role lacks the permission; `PASSWORD_CHANGE_REQUIRED` when the password must be changed first |
| 404 | Record not found (or not in your branch) |
| 409 | Conflict: double booking, duplicate record, already refunded… |
| 422 | Validation failed — `errors: [{ field, message }]` |
| 423 | Account temporarily locked after repeated failed logins |
| 429 | Too many requests (rate limit) |
| 500 | Unexpected error (details are logged on the server, never returned) |

## Authentication

1. `POST /auth/login` `{ email, password, remember? }` → `data.accessToken` (valid 15 minutes) plus an HttpOnly, `SameSite=Strict` refresh cookie (`zola_rt`, path `/api/auth`). Signing in starts a new session and ends the one the browser's cookie belonged to.
2. Send `Authorization: Bearer <accessToken>` on every other request. The token names its session; every request checks the session is still open, so a signed-out or revoked session is refused at once (`401`, `code: SESSION_ENDED`), not when the token expires.
3. `POST /auth/refresh` (cookie) → a new access token; the refresh token rotates on every use. Replaying an old refresh token signs out the whole session. A session ends `SESSION_MAX_HOURS` (24) after sign-in, or `REFRESH_TOKEN_DAYS` with "remember me", however often it is refreshed (`SESSION_EXPIRED`).
4. `POST /auth/logout` ends the session of the cookie and of the bearer token sent with it.

`/auth/login`, `/auth/refresh` and `/auth/logout` refuse requests whose `Origin` (or `Referer`) is another site (`403`, `CROSS_SITE_REQUEST`). Every API response is sent with `Cache-Control: no-store`.

Other auth endpoints: `GET /auth/me`, `POST /auth/change-password`, `POST /auth/forgot-password`, `POST /auth/reset-password`.

**Two-step sign-in.** When it is on for the account, `POST /auth/login` returns `{ twoFactorRequired: true, challenge }` (valid 5 minutes) and no session or cookie; `POST /auth/login/two-factor` `{ challenge, code }` (6-digit app code or a recovery code `XXXXX-XXXXX`) then signs in. Wrong codes count as failed sign-ins. For the signed-in user: `GET /auth/two-factor` (status), `POST /auth/two-factor/setup` `{ password }` → `{ secret, uri, qrCode }`, `POST /auth/two-factor/confirm` `{ code }` → `{ recoveryCodes }` (shown once), `POST /auth/two-factor/disable` `{ password, code }`, `POST /auth/two-factor/recovery-codes` `{ password, code }`. When the salon requires it (`security.two_factor_required`: `none` | `admins` | `all`) and it is not set up, every other endpoint answers `403` `TWO_FACTOR_SETUP_REQUIRED`.

**Branches.** Users work in their assigned branch. Users with `branches.manage` may send `X-Branch-Id: <id>` to work in another branch.

**Rate limits.** 300 requests/minute per client for the API, stricter limits for login and password reset, and 20/minute per user for heavy work (report exports, AI refresh, backups).

## Permissions

Each endpoint requires one of the permissions listed. Roles are editable in Settings → Roles & permissions.

`dashboard.view` · `customers.view|create|update|delete|import` · `appointments.view|view_own|create|update|cancel|complete|checkin|record_products` · `services.view|manage|rules` · `employees.view|manage` · `attendance.view|manage|self` · `leave.manage` · `payroll.manage` · `pos.create` · `pos.refund` · `sales.view|import|correct|backdate|edit_history|void` · `inventory.view|manage` · `suppliers.view|manage` · `purchases.view|manage` · `expenses.view|manage` · `loyalty.manage` · `reports.view` · `reports.financial` · `reports.export` · `insights.view` · `notifications.send` · `settings.manage` · `users.manage` · `roles.manage` · `branches.manage` · `audit.view` · `backups.manage`

## Endpoints

### Public (no sign-in)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check (database reachable) |
| GET | `/public/branding` | Salon name and logo for the sign-in page |
| GET | `/public/appointments/:token` | QR verification — appointment code, date/time, services and status only (no personal data) |
| GET | `/webhooks/whatsapp` | Meta webhook verification (`hub.verify_token` must match *Settings → Integrations*) |
| POST | `/webhooks/whatsapp` | Customer replies and delivery reports from WhatsApp. Meta requests must carry `X-Hub-Signature-256` (app secret), Twilio requests `X-Twilio-Signature` (auth token); anything else gets 401 |

Replies are matched to the appointment the customer answered (or their next one): *YES / OK / SAWA / NDIYO / 👍* confirm it, *LATE 15 / NITACHELEWA DAKIKA 15* record a delay, *CANCEL / NO / SITAKUJA* ask the front desk to call, *STOP / ACHA* turn off automatic messages; anything else becomes a notification for the front desk. Appointments expose `customerResponse` (`confirmed`, `late`, `cancel_request`), `customerDelayMinutes`, `customerResponseNote` and `customerResponseAt`; changing the time clears them.

### Dashboard, reports and insights

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/dashboard` | `dashboard.view` (sections depend on the role) |
| GET | `/reports/:type?from&to&groupBy` | `reports.view` for `sales`, `customers`, `services`, `staff`, `inventory`; `reports.financial` for `expenses`, `profit`, `costing`; `reports.financial` + `branches.manage` for `branches` |
| GET | `/reports/:type/export?format=pdf\|xlsx\|csv&from&to&groupBy` | as above + `reports.export` |
| GET | `/insights?from&to&refresh` | `insights.view` |

`groupBy` is `day`, `week`, `month` or `year` (automatic when omitted).

### Customers

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/customers` (`search`, `gender`, `visited`, `minPoints`, `maxPoints`) | `customers.view` |
| POST | `/customers` | `customers.create` |
| GET / PATCH / DELETE | `/customers/:id` | `customers.view` / `customers.update` / `customers.delete` |
| POST | `/customers/:id/photo` (multipart `photo`) | `customers.update` |
| GET | `/customers/:id/appointments` · `/purchases` · `/payments` · `/loyalty` · `/notes` | `customers.view` |
| POST / DELETE | `/customers/:id/notes`, `/customers/:id/notes/:noteId` | `customers.update` |
| POST | `/customers/:id/loyalty/adjust` | `loyalty.manage` |

Phone numbers are normalised to international format (`0712 345 678` → `+255712345678`) and must be unique.

### Appointments

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/appointments` (`from`, `to`, `employeeId`, `customerId`, `status`) | `appointments.view` (all) or `appointments.view_own` (own only) |
| GET | `/appointments/calendar?from&to&employeeId&status` | same |
| GET | `/appointments/availability?employeeIds=4,7&date&serviceIds=1,2` (or `employeeId`) — free only when every person is | `appointments.create` |
| GET | `/appointments/available-employees?startTime&serviceIds` | `appointments.create` |
| POST | `/appointments` `{ customerId, employeeIds: [lead, …], serviceIds, startTime, notes?, source?, status? }` (`employeeId` also accepted) | `appointments.create` |
| GET / PATCH | `/appointments/:id` | view / `appointments.update` |
| PATCH | `/appointments/:id/reschedule` `{ startTime, employeeId?, fromEmployeeId? }` — moves one person's part to another | `appointments.update` |
| POST | `/appointments/:id/status` `{ status, reason? }` | `appointments.update` / `cancel` / `complete` per status |
| POST | `/appointments/check-in` `{ token }` · `/appointments/:id/check-in` | `appointments.checkin` |
| GET | `/appointments/:id/qr` | view (PNG data URL) |
| GET | `/appointments/:id/products` — products used per service: `source` `recorded` (by the stylist), `recipe` (the usual amounts) or `none` | view |
| PUT | `/appointments/:id/products` `{ services: [{ serviceId, products: [{ productId, quantity }] }] }` — until the appointment is billed; stylists only on their own | `appointments.record_products` |

An appointment can have up to 6 staff (`staff: [{ id, fullName, color }]` in responses; the first is the lead and `employeeId`). The server rejects double bookings (any member, or the same customer), bookings outside any member's working hours or on approved leave, past times, and services nobody in the team performs. Concurrent bookings for the same slot are serialised with row locks. Stylists see every appointment they are part of.

### Services and staff

| Method | Path | Permission |
| --- | --- | --- |
| GET / POST / PATCH / DELETE | `/service-categories[/:id]` | read: `services.view`; write: `services.manage` |
| GET / POST / PATCH / DELETE | `/services[/:id]` `{ …, price, maxPrice?, recipe?: [{ productId, quantity }] }` — `maxPrice` for a price range chosen at checkout; `recipe` = products normally used, in this branch. Each service returns `financialRule` (method, version, `priceOptions` for services with set prices; band amounts only for people who see costs). A new service starts on the general formula | read: `services.view`; write: `services.manage` |
| GET | `/services/:id/financial-rule` — the rule in force, its versions (with the number of sales made with each), warnings (e.g. prices no band covers) and the general percentages | `services.rules` or `reports.financial` |
| PUT | `/services/:id/financial-rule` `{ rule, notes? }` — saves a new version (audited with the old and new rule) | `services.rules` |
| POST | `/services/financial-rule/preview` `{ rule, price, productCost?, staffCount? }` — tries a rule without saving | `services.rules` |
| GET | `/employees`, `/employees/options`, `/employees/:id` | `employees.view` (options also for booking) |
| POST / PATCH / DELETE | `/employees[/:id]`, `/employees/:id/photo` | `employees.manage` |
| PUT | `/employees/:id/schedule`, `/employees/:id/services` | `employees.manage` |
| GET | `/employees/:id/performance?from&to` | `employees.view` |
| GET | `/attendance?from&to&employeeId`, `/attendance/today` | `attendance.view` |
| GET | `/attendance/me` | signed-in staff |
| POST | `/attendance/clock-in`, `/attendance/clock-out` | `attendance.self` (own) / `attendance.manage` (anyone) |
| PUT | `/attendance` (record or correct a day) | `attendance.manage` |
| GET / POST | `/leave` | `leave.manage` (staff may request their own with `attendance.self`) |
| PATCH | `/leave/:id/status` | `leave.manage` |
| GET | `/payroll/commissions`, `/payroll/payouts` | `payroll.manage` |
| POST | `/payroll/payouts/generate` `{ periodStart, periodEnd, employeeIds? }` — one payout per person with unpaid commission in the period | `payroll.manage` |
| PATCH / DELETE | `/payroll/payouts/:id` `{ bonus?, deductions?, notes? }` | `payroll.manage` |
| POST | `/payroll/payouts/:id/pay` `{ paymentMethod, paidDate }` (records a "Staff commissions" expense) | `payroll.manage` |

Staff are paid by commission only; employees have no salary field.

### Point of sale

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/sales/quote` | `pos.create` — prices a cart without saving |
| POST | `/sales` | `pos.create` |
| GET | `/sales` (`from`, `to`, `status`: completed\|refunded\|voided, `source`: pos\|backdated\|import, `paymentStatus`, `method`, `search`) | `sales.view` |
| GET | `/sales/:id` | `sales.view` or `pos.create` |
| GET | `/sales/:id/document?format=a4\|thermal&download=1` | `sales.view` or `pos.create` (PDF) |
| GET | `/sales/appointment/:id` | `pos.create` — cart for an appointment |
| POST | `/sales/:id/payments` `{ method, amount, reference? }` | `pos.create` — settle a balance |
| POST | `/sales/:id/refund` `{ reason }` | `pos.refund` |
| POST | `/sales/:id/void` `{ reason }` — cancel a sale recorded by mistake (see below) | `sales.void` |
| PATCH | `/sales/:id/date` `{ soldDate, soldTime?, reason }` — move a sale to its correct business date | `sales.edit_history` |
| PATCH | `/sales/:id/items/:itemId/costing` `{ price?, employeeIds?, consumption?: [{ productId, quantity, unitCost? }], reason }` — correct a completed service (a sale from a previous day also needs `sales.edit_history`) | `sales.correct` |
| POST | `/sales/:id/items/:itemId/costing/review` `{ note }` — mark a zero or negative margin service as reviewed | `sales.correct` |
| GET | `/payments` | `sales.view` |

Sale body:

```json
{
  "customerId": 12,
  "appointmentId": 40,
  "items": [
    { "type": "service", "serviceId": 3, "employeeIds": [2, 5],
      "consumption": [{ "productId": 21, "quantity": 2 }, { "productId": 22, "quantity": 100 }] },
    { "type": "product", "productId": 7, "quantity": 2 }
  ],
  "discount": { "type": "percentage", "value": 10 },
  "loyaltyPoints": 100,
  "payments": [
    { "method": "mobile_money", "amount": 20000, "reference": "QX12345" },
    { "method": "cash", "amount": 40000 }
  ],
  "notes": "Birthday visit"
}
```

Prices, discounts, tax (none by default: `financial.tax_mode` is `none`), loyalty value, change and balance are always calculated by the server from the database; any totals sent by the client are ignored. The whole sale (items, stock, commissions, payments, loyalty points, customer statistics, invoice number) is saved in one database transaction.

A service line lists who performed it in `employeeIds` (1–6 people; `employeeId` is still accepted) and the products **actually used** in `consumption`, each in the product's usage unit (e.g. packs, or ml of a product stocked in bottles). For a service with a recipe, `consumption` is required (send `[]` when nothing was used); a service priced by range takes `price` between its price and `maxPrice`.

Every service line is split by **its service's financial rule** (one engine, `services/financialRules.js`, used by the till, quotes, corrections and imports):

- **General formula** (every service unless configured otherwise):

  ```
  price charged (after discounts)
  − product cost        (quantity used × the product's recorded purchase cost per unit)
  = amount after products
  − operations          (financial.operations_percentage, default 30 %)
  = distributable amount
  → staff pool          (financial.staff_pool_percentage of it, default 50 %), shared equally between the staff
  → salon profit        (the rest: financial.salon_profit_percentage, default 50 %)
  ```

  Example: 50,000 with 2 packs × 5,000 and 100 ml × 20 → products 12,000, operations 11,400, staff 13,300, salon profit 13,300 (12,000 + 11,400 + 13,300 + 13,300 = 50,000).
- **Price bands**: a rule per price or price range. Operations come first (a fixed amount or a percentage of the amount after products); staff and salon profit share what is left (fixed, percentage or "the rest"); a band can also say "use the general formula". Product cost is deducted first only when the rule says so (`productCost: deduct` and `productsIncluded`). Confirmed rules set up on install:

  | Service | Price | Operations | Staff pool | Salon profit |
  | --- | --- | --- | --- | --- |
  | Kufumua (no product cost) | 2,000–5,000 | 1,000 | the rest | 0 |
  | | 6,000–10,000 | 2,000 | the rest | 0 |
  | | 11,000–20,000 | general formula with product cost 0 (20,000 → 6,000 / 7,000 / 7,000) | | |
  | Steaming | 10,000 / 15,000 / 20,000 / 25,000 | 4,000 / 6,000 / 9,000 / 10,000 | 3,000 / 3,000 / 3,000 / 4,000 | 3,000 / 6,000 / 8,000 / 11,000 |
  | Relaxer | 10,000 / 15,000 | 4,000 / 6,000 | 3,000 / 3,000 | 3,000 / 6,000 |
  | Kubana Nyuele | — not configured: cannot be sold or imported until an administrator sets its rule | | | |

- **Not configured**: refused with the reason.

A price no band covers (e.g. Steaming at 12,000, or a discount that takes it to 9,000), a band whose parts do not add up, or a negative part is refused (`422`) — nothing is guessed and nothing is booked as profit. A service with a band rule is sold with quantity 1. Every split is checked to add up exactly (products + operations + staff + profit = price, staff shares = staff pool), and each line stores the rule version and a snapshot of the rule applied (`calculation_method`: general, band, band_general), so later rule changes never alter it; a correction recalculates with the rule the sale was made with (or the current rule when a new price is outside that rule's band). Amounts are rounded to the currency precision (whole shillings) and always add up to the price. When products cost as much as or more than the price, operations and staff get 0 (never a negative amount), a loss shows as negative salon profit, and the service is flagged `zero`/`negative` for review. The products used come out of stock (`service_use` in the ledger) in the same transaction, and the breakdown is saved with the percentages used, so later changes to prices, costs or rules never alter it.

**Sales for a previous date.** Add `soldDate` (YYYY-MM-DD), optional `soldTime` (HH:MM, default 12:00) and `backdateReason` to the sale body; this needs `sales.backdate`. The date cannot be in the future. The sale keeps that business date in `soldAt` (payments, commission and reports use it) while `createdAt` is when it was entered; it is marked `source: backdated`, `isBackdated`, with `originalSoldAt` and the reason, audited as `sale.backdated`, and people with `sales.edit_history` are notified. Stock is taken out when it is entered, and no thank-you message is sent.

**Void.** Cancels a sale recorded by mistake: payments are reversed on the day they were received (`type: void`), products sold *and* products used on its services go back into stock, commissions are reversed (pending payouts are recalculated) and loyalty points and customer figures are corrected. The sale stays visible as `voided` with who, when and why. Refused once a commission from it was paid out (imported sales excepted: their commission was settled outside the system). **Changing the date** moves the payments taken with the sale, its commissions and its service breakdown; refused once a commission is in a payout.

Sale details return `source`, `isBackdated`, `backdateReason`, `originalSoldAt`, `createdAt`, `voidReason`, `voidedAt`, `voidedByName`, `updatedByName`, `items[].staff: [{ id, fullName, revenueShare, commissionAmount }]`, `items[].productsUsed`, and — for `reports.financial` or `sales.correct` — `items[].costing` (the full breakdown, review status and correction history). `/sales/appointment/:id` returns the appointment's `employeeIds` and `usage` (products per service) for checkout. The quote returns each service's `productsUsed`, `marginStatus`, `priceOptions` (services with set prices), `productsIncluded` and, for the same people, `split` (with `method`, `band` and `consumptionCost`).

### Imports (Excel / CSV)

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/imports/customers/template` · `/imports/sales/template` | `customers.import` / `sales.import` — `.xlsx` template with drop-down lists |
| POST | `/imports/customers/preview` · `/imports/sales/preview` (multipart `file`) | `customers.import` / `sales.import` — checks the file; nothing is saved |
| POST | `/imports/customers` · `/imports/sales` (multipart `file`, `skipInvalid`) | `customers.import` / `sales.import` |

Files are `.xlsx` or `.csv` (comma, semicolon or tab separated), up to 5,000 rows and `MAX_UPLOAD_MB`; they are read in memory and never stored. Headers are matched loosely (`Phone`, `Phone number`, `Simu`); dates are read day first (`01/09/2026` is 1 September). The preview returns `{ fileName, columns: { mapped, ignored }, summary, rows: [{ rowNumber, status: ready|skip|error, messages, display }] }`. The import checks the file again and saves all rows in one transaction; if any row has a problem it is refused (422) unless `skipInvalid=true`.

- **Customers**: *Full name* and *Phone* are required; phone numbers already registered (or repeated in the file) are skipped.
- **Sales**: one row per item; rows with the same *Receipt* number form one sale. *Date* and *Item* (a service or product name, SKU or barcode) are required; a blank *Amount* uses the price list. Customers are matched by phone (new phone + name adds the customer); staff by name or code. Every service row goes through **the same financial engine as the till**: the preview shows its split (`display.split`), and a row whose service has no rule for its amount, is not configured, has a band rule with quantity above 1, or has a staff share but no staff is flagged (`Financial rule: …` / `Fill in Staff …`, counted in `summary.ruleProblems`) and never imported — set the rule and import it again. Product cost is estimated from the service's recipe when its rule deducts products (`productCostBasis: recipe_estimate`). Imported sales are marked `isImported` / `source: import`, recorded as paid in full with no tax, do not change stock or loyalty points, and their staff shares are saved as commission already paid (they show in reports, never in a new payout); receipts already imported are skipped. Refunding or voiding an imported sale does not return stock.

### Inventory, suppliers and purchases

| Method | Path | Permission |
| --- | --- | --- |
| GET / POST / PATCH / DELETE | `/products[/:id]` (`stock=low\|out\|attention\|in`) — `unit`, and optionally `usageUnit` + `usagePerUnit` ("bottle, used by the ml, 500 per bottle") | read: `inventory.view`; write: `inventory.manage` |
| GET | `/products/usable` — active products in their usage unit, with stock (and cost per unit for people who see costs) | `inventory.view`, `pos.create`, `appointments.record_products` or `services.manage` |
| GET / POST / PATCH / DELETE | `/product-categories[/:id]` | read: `inventory.view`; write: `inventory.manage` |
| POST | `/inventory/adjust` `{ productId, type, quantity, unitCost?, reason }` | `inventory.manage` |
| GET | `/inventory/transactions`, `/inventory/valuation` | `inventory.view` |
| GET / POST / PATCH / DELETE | `/suppliers[/:id]` | read: `suppliers.view`; write: `suppliers.manage` |
| GET / POST | `/purchases` | `purchases.view` / `purchases.manage` |
| POST | `/purchases/:id/receive`, `/purchases/:id/cancel` | `purchases.manage` |
| POST | `/purchases/:id/payments` | `suppliers.manage` or `purchases.manage` |

Adjustment types: `stock_in`, `stock_out`, `adjustment` (counted quantity), `damage`, `internal_use`. Quantities may have up to 3 decimals (0.2 of a bottle). Stock can never go below zero; every change is written to the stock ledger.

### Expenses

| Method | Path | Permission |
| --- | --- | --- |
| GET / POST / PATCH / DELETE | `/expenses[/:id]` | read: `expenses.view`; write: `expenses.manage` |
| POST / DELETE | `/expenses/:id/attachment` (multipart `attachment`: image or PDF; scanned for viruses when ClamAV is configured) | `expenses.manage` |
| GET | `/expenses/:id/attachment` — the receipt file (receipts are not served at their `/uploads` address) | `expenses.view` |
| GET / POST / PATCH / DELETE | `/expenses/categories[/:id]` | read: `expenses.view`; write: `expenses.manage` |

### Loyalty, messages and notifications

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/loyalty/program`, `/loyalty/tiers` | signed in |
| PUT | `/loyalty/program`; POST / PATCH / DELETE `/loyalty/tiers[/:id]` | `loyalty.manage` |
| GET | `/notifications`, `/notifications/unread-count` | signed in (own) |
| POST | `/notifications/:id/read`, `/notifications/read-all` | signed in |
| GET | `/messages` (`channel`, `status`, `direction`: `outbound` or `inbound`, `search`, `customerId`) | `notifications.send` |
| POST | `/messages/send` `{ channel, audience, customerIds?, tierId?, inactiveDays?, subject?, message }` | `notifications.send` |
| POST | `/messages/:id/retry` | `notifications.send` |
| GET | `/search?q=` | signed in (results limited to what the role may see) |

`channel`: `sms`, `whatsapp`, `email`. `audience`: `selected`, `all_opted_in`, `tier`, `inactive` (win-back), `birthday`. Promotions only reach customers who opted in to marketing.

### Administration

| Method | Path | Permission |
| --- | --- | --- |
| GET / POST / PATCH | `/users[/:id]` | `users.manage` |
| POST | `/users/:id/reset-password`, `/users/:id/unlock`, `/users/:id/reset-two-factor` | `users.manage` — only the Super Admin may change a Super Admin, and no one can give a role with permissions they do not hold |
| PATCH | `/users/me` — own `fullName` and `phone` (the dashboard greets people by this name) | signed in |
| POST | `/users/me/avatar` | signed in |
| GET / POST / PATCH / DELETE | `/roles[/:id]`, GET `/roles/permissions` | `roles.manage` |
| GET / POST / PATCH | `/branches[/:id]` | `branches.manage` |
| GET | `/settings/app` | signed in (public settings: currency, time zone, business hours…) |
| GET / PUT | `/settings`, `/settings/:group` | `settings.manage` |
| POST / DELETE | `/settings/business/logo` | `settings.manage` |
| GET | `/activity-logs` | `audit.view` |
| GET / POST | `/backups` — the list also says whether files are encrypted and copied (`protection`) | `backups.manage` |
| GET | `/settings/security-check` — the security checklist of this installation (no secret values) | `settings.manage` |
| PUT | `/backups/settings` `{ auto_enabled, cron, retention_count }` | `backups.manage` |
| GET | `/backups/:id/download` | `backups.manage` |
| DELETE | `/backups/:id` | `backups.manage` |

## Example

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"your-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

curl -s "http://localhost:5000/api/reports/sales?from=2026-09-01&to=2026-09-30" -H "Authorization: Bearer $TOKEN"
curl -s -o sales.pdf "http://localhost:5000/api/reports/sales/export?format=pdf&from=2026-09-01&to=2026-09-30" -H "Authorization: Bearer $TOKEN"
```
