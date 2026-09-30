# ZOLA STYLISH MANAGEMENT SYSTEM — Security

What ZOLA STYLISH MANAGEMENT SYSTEM does to protect the salon's data, what the person running it must do, and the results of the security review. Deployment hardening steps are in [DEPLOYMENT.md](DEPLOYMENT.md#10-production-checklist).

---

## 1. What is protected

| Data | Why it matters |
| --- | --- |
| Customer records (names, phone numbers, emails, birthdays, notes, photos) | Personal data — privacy law and customer trust |
| Sales, payments, expenses, commission payouts | Financial records — fraud and accuracy |
| Staff accounts and permissions | Control of everything else |
| Integration credentials (SMS, WhatsApp, email, AI) | Misuse costs money and reputation |
| Backups | A complete copy of all of the above |

Main threats considered: a staff member using more rights than their role allows; a stolen or shared password; a stolen session; someone else on the salon Wi-Fi; attacks from the internet on hosted installations (password guessing, injection, cross-site scripting, request forgery); leaked backup files or logs; and loss of data through hardware failure.

---

## 2. Controls

### Accounts and passwords
- Passwords are hashed with **bcrypt** (cost 12 by default); plain passwords are never stored or logged.
- Minimum 8 characters with letters and numbers, checked on the server.
- **Lockout** after 5 failed sign-ins for 15 minutes (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`); administrators can unlock early. Failed sign-ins and lockouts are logged with the IP address.
- Sign-in answers are identical for "unknown email" and "wrong password" (a deactivated account is only mentioned after the correct password), and the password-reset request always reports success, so neither reveals which emails have accounts.
- **Forced password change** for new accounts, the first Super Admin (created from `.env`), and after any administrator or command-line reset. Until then every other API call is refused.
- Password-reset links are single-use, expire, and are stored only as SHA-256 hashes.
- No password is hard-coded anywhere; the first administrator and demo accounts get their passwords from `.env`.

### Sessions
- **Access token**: JWT signed with `JWT_SECRET` (HS256), valid 15 minutes, held only in the web app's memory — never in `localStorage`, so a script cannot collect it from storage.
- **Refresh token**: random 384-bit value in an `httpOnly`, `SameSite=Lax` cookie limited to `/api/auth` (and `Secure` with `COOKIE_SECURE=true`); the database stores only its SHA-256 hash.
- **Rotation with theft detection**: every refresh issues a new token and retires the old one. If a retired token is presented again (outside a few seconds' grace for parallel browser tabs), the whole sign-in family is revoked — both the thief and the real user are signed out and must sign in again.
- Changing a password, an administrator reset and deactivating a user end the user's other sessions.
- The user and permissions are re-read from the database on **every** request, so deactivation, role and permission changes apply immediately, not when the token expires.
- "Remember me" sessions last `REFRESH_TOKEN_DAYS` (30); others `SESSION_HOURS` (12).

### Authorization
- 46 permissions in 13 modules, grouped into editable roles. Every API route declares the permissions it needs (`requirePermission`); the web app hiding a button is a convenience, not the protection.
- Record-level rules in the services: stylists see only their own appointments (and, on their dashboard, their own services and commission); users work only in their own branch unless they have `branches.manage` — sales, appointments, expenses and stock of another branch answer *not found*. The customer list is shared by all branches, so a customer can visit any of them.
- Guard rails: the last active Super Admin cannot be deactivated or demoted; users cannot deactivate themselves; the Super Admin role keeps all permissions.
- Financial reports (`reports.financial`), exports (`reports.export`), refunds (`pos.refund`), backups (`backups.manage`), settings and user management are separate permissions.

### Input handling
- Every request body, query and route parameter is validated with **Zod** schemas; unknown fields are dropped; lengths, formats, ranges and enumerations are enforced; invalid input gets a `422` with per-field messages.
- **SQL injection**: all queries use parameter placeholders. The few dynamic identifiers (sort columns, table names in backups) come from fixed allow-lists, never from user input.
- **Business integrity**: prices, discounts, tax, totals, stock and balances are computed on the server from the database; the browser's figures are ignored. Multi-step operations are single database transactions with row locks (no double-booking, overselling or double refunds).

### Browser security
- **Cross-site scripting**: React escapes all output; the code base does not use `dangerouslySetInnerHTML`. A strict **Content-Security-Policy** (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`) blocks injected scripts even if escaping were bypassed.
- **Cross-site request forgery**: API calls authenticate with the `Authorization` header, which other sites cannot add. The refresh cookie is `SameSite=Lax` and limited to `/api/auth`, so other sites' forms and scripts cannot use it, and CORS rejects origins other than the app's own and `FRONTEND_URL`.
- Headers from Helmet: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, and with HTTPS `Strict-Transport-Security` and `upgrade-insecure-requests`.

### File uploads
- Only JPG, PNG, WebP and PDF (receipts) are accepted, up to `MAX_UPLOAD_MB`. The extension, the declared type **and the file's first bytes** must all match, so a script renamed to `.png` is rejected. SVG is not accepted (it can contain scripts).
- Spreadsheet imports (`.xlsx` / `.csv`) are read in memory and never saved to disk; an `.xlsx` must start like a ZIP package and a CSV must be plain text, with at most 5,000 rows. Rows are validated like forms, and nothing is saved until every row passes (or problem rows are explicitly skipped).
- Files get random, unguessable names; the original name is never used as a path. Uploads are served with `nosniff`, and hidden files are refused.

### WhatsApp webhook
- `/api/webhooks/whatsapp` is the only unauthenticated endpoint that changes data. Every request must be signed by the provider: Meta with HMAC-SHA256 of the exact body using the app secret, Twilio with HMAC-SHA1 of the URL and fields using the auth token. Signatures are compared in constant time; without a saved secret all requests are refused.
- A reply can only confirm an appointment, record a delay, note a request to cancel (staff decide) or stop messages for that number. It never cancels, moves or bills anything. Messages resent by WhatsApp are recognised by their message ID and handled once.
- Webhooks have their own rate limit (600 per minute) so delivery reports for large promotions are not throttled by the general API limit.

### Exports
- CSV cells that start with `=`, `+`, `-` or `@` are neutralised so spreadsheets do not run them as formulas.
- Every export is recorded in the activity log with the report and period; heavy endpoints are rate-limited per user.

### Rate limiting

| Endpoint | Limit |
| --- | --- |
| All API calls | 1,500 per 5 minutes per IP address |
| Sign-in | 20 per 15 minutes per IP address + email (plus account lockout) |
| Password-reset requests | 10 per hour per IP |
| Public QR check-in | 30 per minute per IP |
| Exports, insights and other heavy requests | 20 per minute per user |

Behind a proxy set `TRUST_PROXY` correctly so limits and logs use the real client address — and never enable it without a proxy, because clients could then fake their address.

### Secrets and configuration
- All secrets come from `.env` (never committed — `.gitignore` excludes it) or from *Settings → Integrations*, where they are encrypted with **AES-256-GCM** before storage and never sent back to the browser (the page shows only whether a value is set).
- The server refuses to start with a missing or short `JWT_SECRET` (32+ characters); setup scripts generate a random one.
- In production, error responses never contain stack traces or SQL messages.

### Logging and audit
- **Activity log** (*Settings → Activity log*, `audit.view`): sign-ins, failed sign-ins, lockouts, password changes and resets, user and role changes, sales, payments, refunds, stock adjustments, purchases, expenses, commission payouts, settings changes, exports, backups (created, downloaded, deleted) and restores — with user, branch, IP address and time. Business entries are written in the same transaction as the change.
- **Application log**: request method, path, status and client address. Query strings are not logged (they may contain reset tokens or searched phone numbers); passwords, tokens, cookies and authorization headers are redacted. The log file is rotated by size (`LOG_MAX_MB`, `LOG_KEEP_FILES`).

### Privacy
- The public QR check-in page shows only the appointment code, date, time, status, branch and number of services — no customer name or phone number. QR tokens are random 128-bit values.
- Promotional messages go only to customers who opted in to marketing; the opt-in is stored per customer.
- The optional AI summary receives only aggregated figures (totals, counts, percentages, service and staff names) — never customer names, phone numbers or emails. With no AI key, insights are produced entirely on the server.
- Demo data is flagged and removable (`npm run demo:clear`).

### Backups
- Backups are written outside every public folder (`backend/storage/backups`), downloadable only with `backups.manage`, and every download is audited. Restores are only possible from the server's command line, never through the web.
- Backups contain everything, including password hashes: store copies as carefully as the server (encrypted USB drive or private cloud storage).

### Deployment
- The API listens only where configured (`HOST`); behind Nginx it listens on `127.0.0.1` only.
- The Docker backend runs as an unprivileged user; MySQL is not published outside the Docker network. The systemd example runs as a dedicated user with a read-only system and writable storage and log folders only.
- `firewall.bat` opens the port only for **private** networks.

---

## 3. Security review (Phase 8)

The code was reviewed module by module and tested with automated tests (authentication, permissions per role, input validation, concurrency) and manual checks (path traversal on uploads and backups, spoofed proxy headers, token replay, forged form posts, oversized and disguised uploads, spreadsheet formula injection). Findings and fixes:

| Finding | Severity | Fix |
| --- | --- | --- |
| Refresh-token theft detection revoked the session family inside a transaction that was then rolled back, so a replayed token did not actually sign the thief out | High | Revocation is committed before the request is rejected; the parallel-tab grace period no longer applies to a family revoked for reuse (migration 001 records why each token was revoked) |
| Concurrent requests taking document numbers could deadlock (lost sales under load) | Medium | Atomic sequence increment; automatic transaction retry on deadlock |
| `exceljs` depended on a vulnerable `uuid` version | Medium | Overridden to a patched version; `npm audit` reports no known vulnerabilities |
| Backups turned non-ASCII text inside JSON columns (e.g. a business name or receipt footer with `—` or `é`) into garbled characters on restore | Medium (data integrity) | JSON values are decoded as UTF-8 when dumping; covered by a round-trip test |
| Request logs contained full query strings — password-reset tokens and customer search terms | Medium | Only the path is logged |
| Behind a proxy, request logs showed the proxy's address instead of the client's | Low | Logs use the proxy-aware client address |
| The log file grew without limit on always-on servers | Low | Size-based rotation |
| No way to recover when the only administrator forgot their password and email was not configured | Low (availability) | `npm run user:reset-password -- <email>` on the server (temporary password, forced change, sessions revoked, audited) |
| Restores were not visible in the activity log | Low | A `backup.restored` entry is written into the restored database |

Verified without findings: SQL injection (parameterised queries throughout), XSS (no raw HTML rendering, CSP), CSRF, authorization on every route (tests per role), branch isolation, IDOR on records of other branches, upload type spoofing, path traversal on `/uploads` and backup downloads, public access to backups (`/storage`, `/backups`, encoded `../` paths), spoofed `X-Forwarded-For` without `TRUST_PROXY`, secrets in API responses, stack traces in production errors.

### Known limitations
- **No two-factor authentication.** Use strong, unique passwords and give every staff member their own account.
- **Uploaded files are reachable by their URL** without signing in. The names are random and unguessable, and URLs are only shown to signed-in users, but anyone who is given a link can open that file.
- **Plain HTTP on a LAN** is readable by other devices on the same network. Protect the salon Wi-Fi (WPA2/WPA3, separate guest network) or use HTTPS (DEPLOYMENT.md §6).
- **The server computer itself** holds the database, `.env` and backups. Anyone with administrator access to that computer has access to everything — lock it with a Windows password, keep it where customers cannot reach it, and enable BitLocker disk encryption where available.

---

## 4. Operator responsibilities

1. Keep `.env` private; change `JWT_SECRET` only if it may have leaked (everyone is signed out).
2. One account per person; remove or deactivate accounts of staff who leave the same day.
3. Review *Settings → Roles & permissions* before going live; give each role only what it needs.
4. Look at the activity log regularly — especially refunds, discounts, stock adjustments and exports.
5. Use HTTPS for anything reachable from the internet (DEPLOYMENT.md §6).
6. Keep Windows/Linux, Node.js and MySQL updated.
7. Keep backup copies off the server and test a restore now and then.
8. `ADMIN_PASSWORD` in `.env` is used only to create the first administrator, who must replace it at first sign-in; it cannot be used to sign in afterwards.

## 5. Reporting a vulnerability

Please report security problems privately to the system's maintainer (not in a public issue), with steps to reproduce. Do not test against a salon's live installation without the owner's permission.
