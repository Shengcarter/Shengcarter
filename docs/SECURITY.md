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
- Passwords longer than 72 bytes are refused rather than silently shortened (bcrypt only uses the first 72 bytes).

### Two-step sign-in (administrators)
- After the password, a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…): standard **TOTP** (RFC 6238) through the `otplib` library — no home-made cryptography.
- **Who must use it** is set in *Settings → Security*: optional for everyone (default), **required for administrators** (the Super Admin and anyone who can manage users, roles, settings or backups) — recommended — or required for everyone. Someone it applies to who has not set it up is sent straight to the setup page and can do nothing else until it is done.
- The password alone never starts a session: it returns a 5-minute challenge, exchanged for a session only with a right code. Wrong codes count as failed sign-ins (the account locks after `LOGIN_MAX_ATTEMPTS`), a code is accepted for its own 30-second step or the previous one, and **never twice**.
- The secret is stored encrypted (AES-256-GCM); ten single-use **recovery codes** are stored only as SHA-256 hashes. Turning it on ends the user's other sessions; turning it off or making new recovery codes needs the password and a code; it cannot be turned off while required.
- Lost phone: an administrator resets it in *Settings → Users* (the person is signed out everywhere), or on the server `npm run user:reset-two-step -- <email>`. Every step is in the activity log.

### Sessions
- **Server-side sessions.** Signing in starts a session (a refresh-token family). Signing in again from the same browser ends the previous session and starts a new one with new tokens, so a planted token is never adopted (session fixation).
- **Access token**: JWT signed with `JWT_SECRET` (HS256), valid 15 minutes, held only in the web app's memory — never in `localStorage`, so a script cannot collect it from storage. It names its session, and **every request checks that session is still open**: signing out, a password change, an administrator reset or deactivation, or detected token theft stops the access token immediately, not 15 minutes later.
- **Refresh token**: random 384-bit value in an `HttpOnly`, `SameSite=Strict` cookie limited to `/api/auth` (and `Secure` with `COOKIE_SECURE=true`); the database stores only its SHA-256 hash.
- **Rotation with theft detection**: every refresh issues a new token and retires the old one. If a retired token is presented again (outside a few seconds' grace for parallel browser tabs), the whole sign-in family is revoked — both the thief and the real user are signed out and must sign in again.
- **Expiry**: a session ends after `SESSION_HOURS` (12) without use and at the latest `SESSION_MAX_HOURS` (24) after sign-in, however often it is refreshed; with "remember me", `REFRESH_TOKEN_DAYS` (30) after sign-in. Without "remember me" the cookie also ends when the browser closes.
- **Sign-out** ends the session on the server (both tokens), wipes everything the page loaded, signs out the other open tabs (BroadcastChannel) and leaves with a full page load that replaces the history entry. Pages are never stored (`Cache-Control: no-store` on the app page and every API response) and a page restored from the browser's back/forward cache reloads, so **Back after signing out shows the sign-in page, not the previous screen**; a tab coming back into view re-checks its session.
- **CSRF**: every API call is authorised by the bearer token, which a browser never attaches on its own. The three endpoints that use the cookie (sign-in, refresh, sign-out) also refuse requests whose `Origin`/`Referer` is another site, on top of `SameSite=Strict`.
- Changing a password ends the user's other sessions; an administrator reset and deactivation end all of them.
- The user and permissions are re-read from the database on **every** request, so deactivation, role and permission changes apply immediately.

### Authorization
- 52 permissions in 13 modules, grouped into editable roles. Every API route declares the permissions it needs (`requirePermission`); the web app hiding a button is a convenience, not the protection.
- Record-level rules in the services: stylists see only their own appointments (and, on their dashboard, their own services and commission); users work only in their own branch unless they have `branches.manage` — sales, appointments, expenses and stock of another branch answer *not found*. The customer list is shared by all branches, so a customer can visit any of them.
- Guard rails: the last active Super Admin cannot be deactivated or demoted; users cannot deactivate themselves; the Super Admin role keeps all permissions.
- **No one can give more rights than they hold** (`services/privilegeGuard.js`): someone who may manage users or roles but is not the Super Admin cannot create or promote a Super Admin, cannot change, reset, unlock or reset two-step sign-in for a Super Admin (or anyone with rights they lack), and cannot give or create a role with permissions they do not have.
- Financial reports (`reports.financial`), exports (`reports.export`), refunds (`pos.refund`), corrections to completed services (`sales.correct`), sales for a previous date (`sales.backdate`), changing the date of past sales and correcting earlier days' sales (`sales.edit_history`), voiding sales (`sales.void`), service financial rules (`services.rules`), backups (`backups.manage`), settings (including the service money split) and user management are separate permissions. Stylists can record the products they used (`appointments.record_products`) but cannot change prices, product costs, recipes, the split or completed sales; cost figures are only returned to people with `reports.financial` or `sales.correct`.

### Input handling
- Every request body, query and route parameter is validated with **Zod** schemas; unknown fields are dropped; lengths, formats, ranges and enumerations are enforced; invalid input gets a `422` with per-field messages.
- **SQL injection**: all queries use parameter placeholders. The few dynamic identifiers (sort columns, table names in backups) come from fixed allow-lists, never from user input.
- **Business integrity**: prices, discounts, tax, totals, stock and balances are computed on the server from the database; the browser's figures are ignored. Multi-step operations are single database transactions with row locks (no double-booking, overselling or double refunds).

### Browser security
- **Cross-site scripting**: React escapes all output; the code base does not use `dangerouslySetInnerHTML`. A strict **Content-Security-Policy** (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`) blocks injected scripts even if escaping were bypassed.
- **Cross-site request forgery**: API calls authenticate with the `Authorization` header, which other sites cannot add. The refresh cookie is `SameSite=Strict` and limited to `/api/auth`; sign-in, refresh and sign-out also refuse requests whose `Origin`/`Referer` is another site, and CORS rejects origins other than the app's own and `FRONTEND_URL`.
- Headers on every response (Helmet, and the same in the Docker Nginx): `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, **`Permissions-Policy`** (camera for this site only — QR check-in — and microphone, location, payment, USB and similar off), `Cache-Control: no-store` on the app page and the API, and with HTTPS **`Strict-Transport-Security`** (one year) and `upgrade-insecure-requests`.
- **HTTPS only**: with `FORCE_HTTPS=true` plain-HTTP pages are redirected to HTTPS and API calls over HTTP are refused; `COOKIE_SECURE=true` keeps the session cookie off plain HTTP.

### File uploads
- Only JPG, PNG, WebP and PDF (receipts) are accepted, up to `MAX_UPLOAD_MB`. The extension, the declared type **and the file's first bytes** must all match, so a script renamed to `.png` is rejected. SVG is not accepted (it can contain scripts).
- Spreadsheet imports (`.xlsx` / `.csv`) are read in memory and never saved to disk; an `.xlsx` must start like a ZIP package and a CSV must be plain text, with at most 5,000 rows. Rows are validated like forms, and nothing is saved until every row passes (or problem rows are explicitly skipped).
- Files get random, unguessable names; the original name is never used as a path. Uploads are served with `nosniff`, and hidden files are refused.
- **Expense receipts are private**: they are not served at their `/uploads` address at all, only through `GET /api/expenses/:id/attachment` to people who may see that branch's expenses (`expenses.view`). Profile photos and the logo stay public by their random URL (the logo is shown on the sign-in page).
- **Virus scanning**: with `CLAMAV_HOST` set, every upload (photos, logo, receipts and import spreadsheets) is streamed to ClamAV (`clamd`, Docker: `docker compose --profile antivirus up -d`) before it is kept. An infected file is deleted, refused and logged (`upload.malware_blocked`). With `MALWARE_SCAN_REQUIRED=true`, uploads are refused while the scanner is unavailable; otherwise they are accepted and a warning is logged.

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
| Two-step sign-in codes | 20 per 15 minutes per IP address (plus account lockout) |
| Session refresh and sign-out | 300 per 5 minutes per IP address |
| Changing password or two-step sign-in | 15 per 15 minutes per user |
| Password-reset requests | 10 per hour per IP |
| Public QR check-in | 30 per minute per IP |
| Exports, insights and other heavy requests | 20 per minute per user |

Hitting a sign-in, code or password-reset limit is recorded in the activity log (`auth.rate_limited`, once per window and address). Behind a proxy set `TRUST_PROXY` correctly so limits and logs use the real client address — and never enable it without a proxy, because clients could then fake their address.

### Secrets and configuration
- All secrets come from `.env` (never committed — `.gitignore` excludes it) or from *Settings → Integrations*, where they are encrypted with **AES-256-GCM** before storage and never sent back to the browser (the page shows only whether a value is set).
- The server refuses to start with a missing or short `JWT_SECRET` (32+ characters), and in production with the example value from `.env.example`; setup scripts generate a random one.
- Nothing secret is in the code or the web app: the browser bundle contains no API keys (SMS, WhatsApp, email and AI calls are made by the server), and `.gitignore` excludes `.env`, `node_modules`, builds, logs, `storage/` (uploads and backups) and backup files.
- Every change on GitHub is scanned for committed secrets — the files and the whole history (CI job *Secret scan*). Also switch on GitHub **secret scanning and push protection** for the repository (*Settings → Code security*).
- In production, error responses never contain stack traces, SQL, file paths, tokens or credentials (one central error handler; tested). Unknown API addresses answer `401` to people who are not signed in, so the list of routes is not revealed.

### If a secret is exposed
Deleting it from the code (or even from the Git history) is **not enough**: it may already have been copied, cached or indexed. Treat it as compromised and **revoke or rotate it immediately**, then remove it from the repository:

| Secret | What to do at once |
| --- | --- |
| `JWT_SECRET` | Generate a new random value, restart the server. Everyone is signed out. |
| Database password | Change it in MySQL (`ALTER USER 'zola'@'localhost' IDENTIFIED BY '…'`), update `.env`, restart. Check MySQL is not reachable from outside the server. |
| SMS / WhatsApp / Twilio / email (SMTP) / AI keys | Revoke the key in the provider's dashboard, create a new one, enter it in *Settings → Integrations* (or `.env`). Check the provider's usage for misuse. |
| `BACKUP_ENCRYPTION_KEY` | Set a new key and make a new backup straight away; existing backup files stay readable with the old key, so delete or move the old files that may have leaked. |
| `APP_ENCRYPTION_KEY` | Set a new one, then re-enter every integration secret in *Settings → Integrations* (the stored ones can no longer be decrypted). |
| A user's password or recovery codes | Reset the password (*Settings → Users*), reset their two-step sign-in, and check the activity log for that account. |

Then record what happened, when it was rotated and what the logs show.

### Logging and audit
- **Activity log** (*Settings → Activity log*, `audit.view`): sign-ins (with whether two-step sign-in was used), failed sign-ins and codes, lockouts, rate-limit hits, refused requests (`auth.permission_denied`: who, what and the permission it needed), two-step sign-in turned on, off or reset, recovery codes used, blocked uploads, password changes and resets, user and role changes, sales, sales recorded for a previous date, payments, refunds, voids, date changes, service corrections, financial rule changes, stock adjustments, purchases, expenses, commission payouts, settings changes, exports, backups (created, downloaded, deleted) and restores — with user, branch, IP address, device (browser) and time, and for changes the **previous and new values**. Business entries are written in the same transaction as the change.
- **Application log**: request method, path, status and client address. Query strings are not logged (they may contain reset tokens or searched phone numbers); passwords, tokens, cookies and authorization headers are redacted. The log file is rotated by size (`LOG_MAX_MB`, `LOG_KEEP_FILES`).

### Privacy
- The public QR check-in page shows only the appointment code, date, time, status, branch and number of services — no customer name or phone number. QR tokens are random 128-bit values.
- Promotional messages go only to customers who opted in to marketing; the opt-in is stored per customer.
- The optional AI summary receives only aggregated figures (totals, counts, percentages, service and staff names) — never customer names, phone numbers or emails. With no AI key, insights are produced entirely on the server.
- Demo data is flagged and removable (`npm run demo:clear`).

### Backups
- **Automatic** (*Settings → Backups*, default every night at 23:00, keeping the last 14) and on demand. Written outside every public folder (`backend/storage/backups`), downloadable only with `backups.manage`, and every download is audited. Restores are only possible from the server's command line, never through the web.
- **Encrypted** with `BACKUP_ENCRYPTION_KEY`: AES-256-GCM from Node's crypto library, the key derived with scrypt and a random salt per file. A stolen file cannot be read, and a changed or damaged file is refused before any of it is restored. Keep the key safe **off the server** (a password manager): without it the backups cannot be restored.
- **Stored separately**: with `BACKUP_COPY_DIR` every backup is also copied to a second place (USB drive, NAS or cloud-synced folder) with the same retention, so a failed disk or a stolen computer does not take the backups with it. *Settings → Backups* shows whether files are encrypted and copied.
- Uploaded files (`backend/storage/uploads`) are not in the database backup; the Windows `backup.bat` and Linux `backup.sh` copy them too.

#### Restore procedure
1. Stop the application (`pm2 stop zola-stylish` / `sudo systemctl stop zola-stylish` / `docker compose stop backend`).
2. Make one more backup of the current database if there is anything you may still need from it.
3. Put the backup file in `backend/storage/backups` (or give its full path). For an encrypted file (`.sql.gz.enc`), `BACKUP_ENCRYPTION_KEY` in `.env` must be the key it was made with.
4. Run `cd backend && npm run restore -- <file name>` (Windows: double-click `restore.bat`) and type `restore` to confirm. An encrypted file is checked in full first; nothing is changed if it fails.
5. Put back the uploads folder from the same date if needed, start the application and sign in (everyone signs in again).
6. Check the latest sales and the activity log (`backup.restored` is recorded).

Test a restore on a spare computer at least every three months, and after changing `BACKUP_ENCRYPTION_KEY`.

### Deployment
- **HTTPS in production**: anything reachable from the internet must use HTTPS (DEPLOYMENT.md §6) with `COOKIE_SECURE=true` and `FORCE_HTTPS=true`. The server logs a warning at start-up, and *Settings → Security* shows a failed check, while a production install runs over plain HTTP.
- **Least privilege**: the application uses its own MySQL account limited to its own database (`database/create-database.sql`: `zola@localhost`, no global privileges, no `GRANT`, `FILE` or `SUPER`), never `root`; MySQL listens only on the server. The Docker MySQL account is likewise limited to its database. Staff roles get only the permissions they need; administrator rights (users, roles, settings, backups) are separate permissions.
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

### Security review (hardening pass, October 2026)

Every area of the 27-point security requirement list was checked against the code, configuration and tests. What was already in place was kept; these gaps were found and closed:

| Finding | Severity | Fix |
| --- | --- | --- |
| Someone who could manage users or roles but was not the Super Admin (e.g. a custom "Manager" role) could create a Super Admin, give any role, reset the Super Admin's password and take over the account, or grant permissions they did not hold | High | "No more rights than you hold" rule on every user and role change (`privilegeGuard.js`); tested |
| No second factor: a stolen or guessed administrator password was enough | High | Two-step sign-in (TOTP + recovery codes), optional or required for administrators/everyone |
| Expense receipts (financial documents) were downloadable by anyone with their URL | Medium | Served only through the API with `expenses.view` and branch checks; the `/uploads/expenses` address returns 404 |
| Uploaded files were checked by type and content but not for malware | Medium | ClamAV scanning (optional or required) of every upload, including import spreadsheets |
| Backups were plain gzip files on the same disk as the database | Medium | Optional AES-256-GCM encryption, verified before restore; automatic second copy (`BACKUP_COPY_DIR`) |
| No `Permissions-Policy`; the Docker Nginx dropped its security headers for the app page and cached it | Low | `Permissions-Policy` everywhere; shared header snippet in every Nginx location; app page `no-store` |
| No way to force HTTPS; production could run over plain HTTP silently | Medium | `FORCE_HTTPS`, one-year HSTS, start-up warnings and a failed check in *Settings → Security*; the example `JWT_SECRET` stops a production server |
| Passwords over 72 bytes were silently cut by bcrypt | Low | Refused with a clear message |
| Refused requests and rate-limit hits were not in the activity log | Low | `auth.permission_denied` and `auth.rate_limited` entries |
| Session refresh, two-step codes and account-security changes had only the general API limit | Low | Dedicated limits (see Rate limiting) |
| No automated checks for tests, vulnerable dependencies or committed secrets | Medium | GitHub Actions CI (tests, `npm audit`, secret scan of files and history) and Dependabot |

Verified without new findings: password hashing (bcrypt 12), session handling (server-side session check, rotation, expiry, sign-out), backend authorization on every route, branch isolation and record ownership (sales, appointments, expenses, purchases, products, payouts, global search), input validation (Zod on every route), parameterised SQL everywhere (dynamic column names only from fixed lists), CSRF, XSS (no raw HTML; CSP), error handling (no internals in production; tested), negative or invalid stock movements (refused server-side; tested), secrets (none in code, bundle or history; `.gitignore` complete), `npm audit` clean for backend and frontend.

### Remaining risks and limitations
- **Two-step sign-in is optional by default.** Turn on *Required for administrators* in *Settings → Security* once each administrator has an authenticator app.
- **Profile photos and the logo are reachable by their URL** without signing in (random, unguessable names; the logo must be public for the sign-in page). Receipts are private.
- **Virus scanning needs ClamAV** (about 1–2 GB of memory). Without `CLAMAV_HOST`, uploads are only checked by type and content.
- **Plain HTTP on a LAN** is readable by other devices on the same network. Protect the salon Wi-Fi (WPA2/WPA3, separate guest network) or use HTTPS (DEPLOYMENT.md §6). Anything on the internet must use HTTPS.
- **Rate limits are kept in memory** per server process: with several processes (PM2 cluster) each counts separately, and a restart resets them. Account lockout (in the database) still applies.
- **The access token can be read by script running in the page** (it is kept in memory, not in a cookie). The strict Content-Security-Policy and React's escaping are what stop injected script; keep them (no inline scripts, no `dangerouslySetInnerHTML`).
- **The server computer itself** holds the database, `.env` and backups. Anyone with administrator access to that computer has access to everything — lock it with a strong password, keep it where customers cannot reach it, and enable BitLocker/LUKS disk encryption.
- **Backups contain password hashes and personal data.** Encrypt them, keep the key off the server, and protect the second location.

---

## 4. Dependencies

- **Every change** runs `npm audit --audit-level=high` for the backend and the frontend in GitHub Actions (CI); the check fails on any high or critical known vulnerability.
- **Dependabot** opens a pull request every week for outdated or vulnerable npm packages, Docker base images and GitHub Actions; each runs the full test suite.
- **Process when a vulnerability is reported**: read the advisory; update with `npm audit fix` (or `npm install <package>@<fixed version>`), or an `overrides` entry when only a sub-dependency is affected; run `npm test` (backend and frontend) and `npm run build`; merge when CI is green, then update the server (DEPLOYMENT.md §9). Critical issues in internet-facing installs: the same day. If no fix exists yet, record why the risk is acceptable or switch off the affected feature.
- Locally at any time: `npm audit` in `backend` and `frontend`.

## 5. Production readiness

Do not use the system with real customer data until every item below is done **and** its tests pass (`npm test` in `backend` and `frontend`, also run by CI). *Settings → Security* shows most of them live.

| Area | Done when | Tested by |
| --- | --- | --- |
| Authentication | Each person has their own account; temporary passwords replaced; two-step sign-in required for administrators | `auth.test.js`, `two-factor.test.js` |
| Sessions | Sign-out ends the session at once; expiry and theft detection work | `auth.test.js` (sessions) |
| Authorization | Roles reviewed; no one has more than they need; no escalation | `permissions.test.js`, `security.test.js` |
| Input validation & SQL | Zod on every route; parameterised queries | `security.test.js`, module tests |
| Database security | Own MySQL account limited to its database; MySQL not reachable from outside | checklist item in *Settings → Security* |
| Secrets | `.env` private, random `JWT_SECRET`, nothing secret in Git | CI secret scan; start-up check |
| HTTPS | `COOKIE_SECURE=true`, `FORCE_HTTPS=true` for anything on the internet | `security.test.js` (headers, HTTPS mode) |
| Uploads | Virus scanning on (`CLAMAV_HOST`, ideally `MALWARE_SCAN_REQUIRED=true`) | `uploads.test.js` |
| Logging & audit | Activity log reviewed regularly | module tests check each audited action |
| Backups | Automatic, encrypted, copied off the server; a restore tested | `backup.test.js` + a real restore on a spare computer |
| Error handling | `NODE_ENV=production` | `security.test.js` (error responses) |
| Dependencies | CI green; Dependabot on | CI |

See also the deployment checklist in [DEPLOYMENT.md](DEPLOYMENT.md#10-production-checklist).

---

## 6. Operator responsibilities

1. Keep `.env` private. If any secret may have leaked, rotate it at once (section 2, "If a secret is exposed").
2. One account per person; remove or deactivate accounts of staff who leave the same day.
3. Review *Settings → Roles & permissions* before going live; give each role only what it needs.
4. Look at the activity log regularly — especially refunds, discounts, stock adjustments and exports.
5. Use HTTPS for anything reachable from the internet (DEPLOYMENT.md §6).
6. Keep Windows/Linux, Node.js and MySQL updated.
7. Keep backups encrypted and copied off the server, keep the encryption key safe elsewhere, and test a restore every three months.
8. `ADMIN_PASSWORD` in `.env` is used only to create the first administrator, who must replace it at first sign-in; it cannot be used to sign in afterwards.

## 7. Reporting a vulnerability

Please report security problems privately to the system's maintainer (not in a public issue), with steps to reproduce. Do not test against a salon's live installation without the owner's permission.
