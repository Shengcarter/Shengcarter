# ZOLA STYLISH MANAGEMENT SYSTEM

A complete salon ERP and point-of-sale system for beauty salons and barbershops: customers, appointments, services, staff, point of sale, inventory, suppliers, expenses, staff commission, loyalty, reports and business insights — in one web application that runs on a single Windows computer for the whole salon, on a Linux server, or in Docker.

---

## Contents

1. [System overview](#1-system-overview)
2. [Requirements](#2-requirements)
3. [Installation](#3-installation)
4. [Database setup](#4-database-setup)
5. [Environment variables](#5-environment-variables)
6. [Frontend setup](#6-frontend-setup)
7. [Backend setup](#7-backend-setup)
8. [Running in development mode](#8-running-in-development-mode)
9. [Production build](#9-production-build)
10. [Local network (LAN) setup](#10-local-network-lan-setup)
11. [Docker deployment](#11-docker-deployment)
12. [Backup](#12-backup)
13. [Restore](#13-restore)
14. [User roles](#14-user-roles)
15. [API documentation](#15-api-documentation)
16. [Troubleshooting](#16-troubleshooting)

More documentation: [Deployment guide](docs/DEPLOYMENT.md) · [WhatsApp setup](docs/WHATSAPP.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [API reference](docs/API.md)

---

## 1. System overview

| Module | What it does |
| --- | --- |
| **Dashboard** | Today's and month-to-date sales with comparisons, profit after staff commission, balances owed, 30-day revenue, today's appointments, top services and stylists, payment mix, stock alerts, birthdays, team attendance and top insights. Stylists see "My day" with their services, commission and clock in/out. |
| **Customers** | Profiles, visit history, purchases, payments, notes, loyalty points and tiers, photo, marketing preferences; duplicate-safe phone numbers; **import a customer list from Excel or CSV**. |
| **Appointments** | Day / week / month / list calendars with drag-and-drop rescheduling, stylist availability, working hours and leave, server-side double-booking prevention, reminders, QR code check-in. **Several staff can do one appointment together**: everyone's time is blocked and it shows in each person's calendar column. |
| **Services** | Categories, prices (fixed, or a range for services priced by length or complexity), durations, the products each service normally uses (its recipe), which staff perform which service. |
| **Employees** | Profiles, schedules, services, attendance (clock in/out, lateness), leave requests and approval, performance. Staff are **paid by commission only**: *Commission payouts* gathers each person's unpaid commission for a period (plus any bonus, minus deductions such as an advance) and records the payment as an expense. |
| **Point of sale** | Services and products (with barcode scanning), discounts, loyalty redemption, no tax by default (the customer pays exactly the listed price; inclusive or exclusive tax can be switched on in Settings → Financial), the **products used on each service** (pre-filled from the service's recipe or what the stylist recorded) with a live split preview for managers, split payments (cash, mobile money, card, bank), change, balances, refunds, thermal (80 mm) receipts and A4 invoices (print or PDF), appointment checkout; **import past sales from Excel or CSV**. |
| **Inventory** | Products counted in any unit (pieces, packs, bundles, grams, kg, ml, litres, bottles, tubes…) and optionally used in a smaller one ("bottle of 500 ml, used by the ml"), stock ledger (purchases, sales, products used on services, refunds, counts, damage, salon use), low-stock alerts, valuation. |
| **Suppliers & purchases** | Supplier records, purchase orders, receiving stock, supplier payments and balances. |
| **Expenses** | Categories, receipts (image/PDF), vendors; commission payouts are recorded automatically under *Staff commissions*. |
| **Reports** | Sales, customers, services, staff, inventory, expenses, profit & loss, **service costing** (daily, weekly or monthly sales, product costs, operations, staff earnings and salon profit, by stylist, service and product, plus low-margin services) and branch comparison — exportable to **PDF, Excel and CSV**. |
| **Insights** | Built-in analysis of trends, risks and opportunities (works offline), with an optional AI-written summary. |
| **Messaging** | WhatsApp, SMS and email: booking confirmations and reminders that ask the customer to **reply YES to confirm or LATE 15 if running late** (replies update the calendar and alert the front desk), a **thank-you after payment**, cancellations, promotions to opted-in customers, win-back and birthday campaigns — with a log of every message sent and received. Setup: [docs/WHATSAPP.md](docs/WHATSAPP.md). |
| **Administration** | Users, roles and permissions, branches, business/financial/system settings, integrations, loyalty programme, activity (audit) log, backups. |

**How the money from each service is split:** for every completed service the system takes the price actually charged, **subtracts the actual products used** (hair, jelly, gel, shampoo… at the salon's recorded purchase cost, in packs, ml, grams or any unit), then sets aside **30% for operations** and divides the rest **50% to the staff and 50% to the salon**. Example: Box Braids at 50,000 using 2 packs of hair (10,000) and 100 ml of jelly (2,000) → products 12,000, operations 11,400, stylist 13,300, salon profit 13,300. The percentages are set in *Settings → Financial*. **Services can have their own rule** (*Services → service → Financial rule*, versioned and audited): Kufumua keeps 1,000 (2,000–5,000) or 2,000 (6,000–10,000) for operations and gives the rest to the stylists, and uses the general formula without product cost from 11,000; Steaming and Relaxer have fixed amounts at their confirmed prices; Kubana Nyuele waits for its rule. A price no rule covers is refused, never guessed. The same rules apply to sales recorded later for a previous date and to imported sales. Products used come off stock at checkout; each service's full breakdown is stored, so reports never change when prices or rules change later. Services whose products cost as much as or more than the price are flagged for review instead of producing negative pay. Authorised people can correct a completed service (products, cost, price, staff) with a reason; the previous figures are kept.

**Shared between staff:** when several people perform a service (at the POS, or everyone booked on the appointment), the service's value and the staff share are divided **equally** between them, down to the last shilling (10,000 between three people is 3,334 + 3,333 + 3,333).

**Bringing in records kept in Excel:** *Settings → Import data* explains the order (services, products and staff first, then customers, then past sales). You can also choose **Import** on the **Customers** page, or **Import past sales** on the **POS** page, and pick an Excel (`.xlsx`) or CSV file — or first **Download template**, a ready-made sheet with the right columns and drop-down lists of your services, products and staff. The system reads column names loosely (English or Swahili, e.g. *Phone*, *Simu*) and accepts several staff on one line (*Neema & Rehema*), then shows every row as *Ready*, *Skipped* (already in the system) or *Problem* (with the reason) before anything is saved. Nothing is imported until you confirm; you can import only the good rows, and the import is all-or-nothing. Imported sales keep their original date and exact amounts, are marked *Imported*, and each service is split with its own financial rule exactly as at the till (rows a rule cannot settle are flagged, never imported as profit); they do not change stock or loyalty points, staff shares are recorded as commission already paid, and importing the same file again adds nothing twice.

**Recording a sale after the day:** on the POS, **Previous sale** (people with *Record previous sales*) asks for the date, an optional time and the reason. The sale counts on that date in reports, payments and commission, is marked *Recorded later* with who entered it and when, and appears in the cost report's control list. A sale entered by mistake can be **voided** (everything it did is undone; the record stays, marked *Voided*), and one entered on the wrong day can be **moved to its correct date**, each with its own permission and a reason in the activity log.

**Technology:** React 19, Vite, Tailwind CSS, Framer Motion, TanStack Query, React Hook Form + Zod, Recharts · Node.js (Express 5) REST API with JWT authentication · MySQL 8.

**Design principles:** the server is the source of truth for every price, total, tax and stock figure; every multi-step business operation runs in a database transaction; money is calculated with decimal arithmetic (no floating point); dates are stored in UTC and shown in the salon's time zone (default *Africa/Dar_es_Salaam*); the currency is configurable (default *TZS*).

**Works offline.** Everything except sending SMS/WhatsApp/email and the optional AI summary runs on the salon's own computer, without internet.

---

## 2. Requirements

| | Minimum | Recommended |
| --- | --- | --- |
| Operating system | Windows 10/11, Ubuntu 22.04+, macOS 13+ | Windows 11 or Ubuntu 24.04 |
| Node.js | 20 LTS | 22 LTS |
| MySQL | 8.0 | 8.4 LTS |
| Memory / disk | 4 GB RAM, 2 GB free | 8 GB RAM, SSD |
| Browsers | Current Chrome, Edge, Firefox or Safari (desktop, tablet and phone) | |

Docker users need only Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux).

---

## 3. Installation

### Windows (salon computer) — the easy way

1. **Install Node.js** — download the LTS installer from <https://nodejs.org> and keep the default options.
2. **Install MySQL** — download *MySQL Installer for Windows* from <https://dev.mysql.com/downloads/installer/>, choose *Server only*, keep the default port 3306 and set a root password you will remember. MySQL runs as a Windows service and starts automatically.
3. **Create the database** — open *MySQL 8 Command Line Client* (or MySQL Workbench), sign in as root and run the statements in [`database/create-database.sql`](database/create-database.sql) after replacing `CHANGE_ME` with a new password. (Using the root account directly also works: put `root` and its password in `.env`.)
4. **Copy the project** to a folder such as `C:\ZolaStylish`.
5. **Double-click `setup.bat`.** It checks Node.js, creates the settings file `.env` (with a random security key) and opens it in Notepad — fill in `DATABASE_PASSWORD`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`, save and close. Setup then installs everything, builds the web application and creates the database tables and the administrator account.
6. **Double-click `start.bat`.** The browser opens <http://localhost:5000>. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`; you will be asked to choose a new password.
7. *(Optional)* To use the system from other salon computers, tablets or phones, right-click **`firewall.bat` → Run as administrator** — see [LAN setup](#10-local-network-lan-setup).

To start automatically when Windows starts, create a shortcut to `start.bat` in `shell:startup`, or run it as a service with PM2 (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#windows-service-with-pm2)).

### Linux / macOS

```bash
# Node.js 20+ and MySQL 8 must be installed and running
mysql -u root -p < database/create-database.sql   # after replacing CHANGE_ME
bash scripts/linux/setup.sh                        # creates .env on first run — edit it, then run again
bash scripts/linux/start.sh                        # or: pm2 start ecosystem.config.js
```

### Manual installation (any platform)

```bash
cp .env.example .env                  # then edit it (see section 5)
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix backend run setup:db     # create tables, reference data and the first Super Admin
npm --prefix backend start            # http://localhost:5000
```

### Demo data (optional)

Set `SEED_DEMO_DATA=true` and a `DEMO_PASSWORD` in `.env` before `setup:db` to load clearly-labelled demo records: 15 services, 7 staff, 15 products, 4 suppliers, 128 customers and about four months of appointments, sales, purchases, expenses, commission payouts and attendance (generated through the real business logic, so every report is consistent). Demo accounts: `receptionist.demo@zolastylish.local`, `stylist.demo@zolastylish.local`, `accountant.demo@zolastylish.local` (password = `DEMO_PASSWORD`).

Before going live, remove it all with:

```bash
npm --prefix backend run demo:clear      # asks for confirmation; add -- --yes to skip
```

It refuses to run (and lists why) if any of your own records use demo records, so real data is never damaged. Then set `SEED_DEMO_DATA=false`.

---

## 4. Database setup

1. Create an empty database and a user (see [`database/create-database.sql`](database/create-database.sql)). The user needs full rights on that database only.
2. Put the connection details in `.env` (`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`).
3. Run `npm --prefix backend run setup:db`, which is `migrate` + `seed`:
   - **`npm run migrate`** — on an empty database applies [`database/schema.sql`](database/schema.sql) (the baseline), then every file in [`database/migrations/`](database/migrations) not yet applied, recording each in `schema_migrations`. Safe to run on every update.
   - **`npm run seed`** — loads reference data ([`database/seed.sql`](database/seed.sql): roles, permissions, categories, loyalty tiers, default settings), creates the first Super Admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` when none exists (password change required at first login), and optionally the demo data. Safe to run repeatedly.

The database has 48 tables (41 in the baseline schema, 7 added by migrations) with foreign keys, indexes and check constraints; all timestamps are UTC. Nothing in the code base contains a production password.

**Updating to a new version:** stop the server, back up, replace the files, run `npm --prefix backend ci`, `npm --prefix frontend ci && npm --prefix frontend run build`, `npm --prefix backend run migrate`, then start again.

---

## 5. Environment variables

All configuration lives in one `.env` file in the project root (copy [`.env.example`](.env.example)). The backend validates it at start-up and refuses to start with a helpful message when something required is missing. **Never commit `.env`.**

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | `production` or `development` | `development` |
| `HOST` / `PORT` | Listen address and port. `0.0.0.0` = reachable from the LAN | `0.0.0.0` / `5000` |
| `APP_URL` | Address people use (QR codes, reset links, emails), e.g. `http://192.168.1.10:5000` | `http://localhost:5000` |
| `FRONTEND_URL` | Allowed browser origins (CORS), only needed when the web app is served from another address | `http://localhost:5173` |
| `SERVE_FRONTEND` | Serve `frontend/dist` from the API server (`false` when Nginx serves it) | `true` |
| `TRUST_PROXY` | `true`/hop count when behind Nginx or another proxy | `false` |
| `COOKIE_SECURE` | `true` only when the site uses HTTPS | `false` |
| `DATABASE_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASSWORD` | MySQL connection | `127.0.0.1` / `3306` / – |
| `DATABASE_CONNECTION_LIMIT` | Connection pool size | `10` |
| `JWT_SECRET` | **Required.** Random string, 32+ characters (setup scripts generate one) | – |
| `APP_ENCRYPTION_KEY` | Optional key for integration secrets saved in Settings (defaults to one derived from `JWT_SECRET`) | – |
| `JWT_ACCESS_EXPIRES_IN`, `REFRESH_TOKEN_DAYS`, `SESSION_HOURS` | Session lifetimes | `15m`, `30`, `12` |
| `BCRYPT_ROUNDS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | Password hashing cost and lockout policy | `12`, `5`, `15` |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First Super Admin, created by `seed` (the name is used in the dashboard greeting; it can be changed later under My profile) | – |
| `SEED_DEMO_DATA`, `SEED_DEMO_ACTIVITY`, `DEMO_PASSWORD` | Demo data switches and demo account password | `false`, `true`, – |
| `SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD`, `EMAIL_FROM` | Email delivery | – |
| `SMS_USERNAME`, `SMS_API_KEY` | Africa's Talking SMS | – |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio SMS/WhatsApp | – |
| `WHATSAPP_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | Meta WhatsApp Cloud API (the app secret checks incoming replies); can also be entered in *Settings → Integrations* | – |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | Optional AI insight summaries (`anthropic`; model defaults to `claude-opus-5`) | – |
| `UPLOAD_DIR`, `BACKUP_DIR`, `MAX_UPLOAD_MB` | Storage (relative paths are inside `backend/`) | `storage/uploads`, `storage/backups`, `5` |
| `LOG_LEVEL`, `LOG_FILE`, `LOG_MAX_MB`, `LOG_KEEP_FILES` | Logging; the file is rotated at `LOG_MAX_MB` (`app.log.1` … `app.log.5`) | `info`, `logs/app.log`, `20`, `5` |
| `JOBS_ENABLED` | Background jobs: message queue, reminders, low-stock check, scheduled backups | `true` |
| `MYSQL_ROOT_PASSWORD`, `HTTP_PORT`, `DOCKER_PROXY_HOPS` | Docker only: MySQL root password, published port (`127.0.0.1:8080` behind a host proxy), proxies in front of the API | – , `80`, `1` |

Email, SMS and WhatsApp credentials can also be entered in **Settings → Integrations** (stored encrypted). Without credentials, messages are recorded in the message log instead of being sent, so the system keeps working.

---

## 6. Frontend setup

```bash
cd frontend
npm ci
npm run dev        # development server with hot reload on http://localhost:5173
npm run build      # production build into frontend/dist
npm test           # unit tests (Vitest)
```

The development server forwards `/api` and `/uploads` to the backend on port 5000 (`VITE_API_PROXY` overrides the target). The web app needs no configuration of its own: currency, time zone, business hours and branding come from the server's Settings.

Structure: `src/features/<module>` (pages, forms and API hooks per module), `src/components/ui` (design system), `src/components/charts` (charts with table views), `src/routes` (routing, permission guards, navigation), `src/api/client.js` (HTTP client with token refresh).

---

## 7. Backend setup

```bash
cd backend
npm ci
npm run setup:db   # migrate + seed
npm run dev        # restarts on file changes
npm start          # production
npm test           # API and business-logic tests (Jest + Supertest)
```

| Script | Purpose |
| --- | --- |
| `npm run migrate` | Apply schema and pending migrations |
| `npm run seed` | Reference data, first Super Admin, optional demo data |
| `npm run setup:db` | Both of the above |
| `npm run demo:clear` | Remove all demo data |
| `npm run backup` | Create a backup now |
| `npm run restore -- <file>` | Restore a backup (replaces all data) |
| `npm run user:reset-password -- <email>` | Set a temporary password for a user from the server (forgotten administrator password) |
| `npm test` | Run the test suite against a throw-away database (`zola_stylish_test`, needs create/drop rights — see `database/create-database.sql`) |

Structure: `src/routes` → `src/controllers` (larger modules) → `src/services` (business rules, transactions) → `src/models` (SQL) with `src/validators` (Zod), `src/middleware` (auth, validation, uploads, rate limits, errors) and `src/jobs` (scheduled work). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 8. Running in development mode

Use two terminals:

```bash
npm --prefix backend run dev     # API on http://localhost:5000
npm --prefix frontend run dev    # web app on http://localhost:5173
```

Set `NODE_ENV=development` in `.env` for readable logs and detailed error messages in API responses (never shown in production).

---

## 9. Production build

```bash
npm --prefix frontend ci && npm --prefix frontend run build
npm --prefix backend ci --omit=dev
npm --prefix backend run migrate
NODE_ENV=production npm --prefix backend start
```

With `SERVE_FRONTEND=true` the backend serves the built web application and the API from one address (ideal for a salon computer). For an always-on server use **PM2**:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

For internet-facing servers put Nginx in front with HTTPS — step-by-step instructions for Windows servers, Linux VPS, Nginx, HTTPS certificates and domains are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Production checklist: `NODE_ENV=production`, a unique `JWT_SECRET`, `COOKIE_SECURE=true` with HTTPS, `TRUST_PROXY` behind a proxy, demo data removed, scheduled backups on, and backup copies stored off the server.

---

## 10. Local network (LAN) setup

One computer (the **server**) runs the system; every other computer, tablet and phone in the salon uses it through the browser.

```text
Server computer:   192.168.1.10   (runs start.bat)
Front desk PC:     192.168.1.11 ─┐
Stylist tablet:    192.168.1.12 ─┼─> http://192.168.1.10:5000
Owner's laptop:    192.168.1.13 ─┘
```

1. **Give the server a fixed address.** In the router's DHCP settings reserve an address for the server (e.g. `192.168.1.10`), or set a static IP in Windows (*Settings → Network → Ethernet/Wi-Fi → IP assignment → Manual*).
2. **Listen on the network.** Keep `HOST=0.0.0.0` in `.env` (the default) and set `APP_URL=http://192.168.1.10:5000` so appointment QR codes open the right address from phones. (`setup.bat` fills in the detected address automatically.)
3. **Allow it through Windows Firewall.** Right-click **`firewall.bat` → Run as administrator** — it adds an inbound rule for the port on *private* networks and prints the address to use. To do it by hand: *Windows Defender Firewall → Advanced settings → Inbound Rules → New Rule → Port → TCP 5000 → Allow the connection → Private* (name it *ZOLA STYLISH MANAGEMENT SYSTEM*), or in an administrator command prompt:
   ```bat
   netsh advfirewall firewall add rule name="ZOLA STYLISH MANAGEMENT SYSTEM" dir=in action=allow protocol=TCP localport=5000 profile=private
   ```
   Also make sure the salon network is set to **Private** (*Settings → Network → Properties*).
4. **Open it from another device:** `http://192.168.1.10:5000`. Tip: add it to the home screen on tablets and phones.
5. **Use port 80 (optional)** so staff can type just `http://192.168.1.10`: set `PORT=80` (and update `APP_URL` and the firewall rule), or put Nginx in front — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#lan-on-port-80).

The server computer must stay on (and not sleep) during opening hours: *Settings → System → Power → Screen and sleep → Never* when plugged in.

---

## 11. Docker deployment

Three containers — **mysql** (MySQL 8.4 with a persistent volume), **backend** (API) and **frontend** (Nginx serving the web app and forwarding `/api`):

```bash
cp .env.example .env
#   set DATABASE_PASSWORD, MYSQL_ROOT_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
#   (or run: node scripts/configure-env.js to generate the secrets)
docker compose up -d --build
```

Open <http://localhost> (or `http://<server-ip>` on the LAN; change the published port with `HTTP_PORT`). On first start the backend waits for MySQL, creates the schema, applies migrations and creates the administrator; later starts skip what already exists.

| Task | Command |
| --- | --- |
| Status / logs | `docker compose ps` · `docker compose logs -f backend` |
| Update after new code | `docker compose up -d --build` (migrations run automatically) |
| Backup now | `docker compose exec backend npm run backup` |
| Copy backups out | `docker compose cp backend:/app/backend/storage/backups ./backups` |
| Restore | `docker compose cp ./file.sql.gz backend:/tmp/ && docker compose exec backend npm run restore -- /tmp/file.sql.gz --yes` |
| Stop (data is kept) | `docker compose down` |

Data lives in the named volumes `mysql-data`, `uploads` and `backups`, which survive rebuilds and restarts (`docker compose down -v` deletes them — only do that on purpose). The backend container runs as an unprivileged user; files: [`docker-compose.yml`](docker-compose.yml), [`docker/`](docker).

---

## 12. Backup

Backups are compressed SQL files (`zola-backup-YYYYMMDD-HHMMSS.sql.gz`) of the whole database, written with plain Node.js (no extra tools needed). They are stored in `backend/storage/backups`, which is never served publicly; downloads require the `backups.manage` permission and are audited.

- **Automatic:** *Settings → Backups* — on by default every day at 23:00 (business time zone), keeping the latest 14 automatic backups. Choose another schedule or a custom cron expression there.
- **From the web app:** *Settings → Backups → Back up now*, then **Download** to save a copy on a USB drive or cloud storage.
- **Windows:** double-click **`backup.bat`** — backs up the database and copies uploaded files (logo, photos, receipts) next to it.
- **Command line:** `npm --prefix backend run backup` · Linux cron: `scripts/linux/backup.sh`.

Good practice: keep at least one recent copy **off the server** (USB drive stored elsewhere, or cloud storage), and test a restore occasionally on a spare computer.

---

## 13. Restore

A restore replaces **all** current data with the backup's data.

1. Stop the system (close the `start.bat` window, `pm2 stop zola-stylish`, or `docker compose stop backend`).
2. Make a fresh backup first if you might need the current data.
3. Restore:
   - **Windows:** double-click **`restore.bat`**, type (or drag in) the backup file name and confirm by typing `restore`.
   - **Command line:** `npm --prefix backend run restore -- storage/backups/zola-backup-20260928-230000.sql.gz` (a bare file name also works; add `--yes` to skip the question).
4. Copy uploaded files back into `backend/storage/uploads` if they were lost.
5. Start the system again and sign in. If you restored an older version of the software's database, run `npm --prefix backend run migrate` before starting.

---

## 14. User roles

Four roles are created by default; every permission can be changed in **Settings → Roles & permissions**, and new roles can be added.

| Role | Can do |
| --- | --- |
| **Super Admin** | Everything: all modules, settings (including the service money split and each service's financial rule), integrations, users, roles, branches, backups, activity log, reports and exports, correcting completed services, recording sales for a previous date, changing the date of past sales and voiding sales. |
| **Receptionist** | Front desk: customers (create/edit/import), appointments (book, edit, cancel, check in, complete, record products used), point of sale and sales history, services, staff list and attendance view, inventory view. |
| **Stylist / Barber** | Own appointments only (view, check in, complete, record the products used), services, own attendance (clock in/out) and "My day" dashboard with own services and commission. |
| **Accountant** | Sales, payments and refunds, recording sales for a previous date, importing past sales, expenses, commission payouts, inventory/supplier/purchase views, customers and staff views, all reports (including profit & loss), exports and insights. |

Security built in: bcrypt-hashed passwords (8+ characters with letters and numbers), account lockout after repeated failed logins, forced password change for new accounts and after an administrator reset, optional or required two-step sign-in (authenticator app) for administrators, 15-minute access tokens tied to a server-side session that signing out ends at once, rotating refresh tokens in a `SameSite=Strict` cookie (reuse detection signs the session out everywhere), a maximum session length, no cached pages (Back after signing out shows the sign-in page), branch isolation, and an audit log of sign-ins and every important change. Details: [docs/SECURITY.md](docs/SECURITY.md).

---

## 15. API documentation

The web application uses a documented REST API under `/api` — JSON, JWT bearer authentication, consistent `{ success, message, data }` responses, server-side pagination and validation errors per field. The full endpoint reference with permissions and examples is in **[docs/API.md](docs/API.md)**.

```bash
curl -s -X POST http://localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"your-password"}'
curl -s http://localhost:5000/api/reports/sales?from=2026-09-01&to=2026-09-30 -H "Authorization: Bearer <accessToken>"
```

---

## 16. Troubleshooting

| Problem | Fix |
| --- | --- |
| `setup.bat`: "Node.js was not found" | Install Node.js LTS from nodejs.org, then open a **new** window and run setup again. |
| "Access denied for user" / `ER_ACCESS_DENIED_ERROR` | `DATABASE_USER` / `DATABASE_PASSWORD` in `.env` don't match MySQL. Re-run the statements in `database/create-database.sql` or use the root account. |
| "connect ECONNREFUSED 127.0.0.1:3306" | MySQL is not running: *Windows → Services → MySQL80 → Start* (Linux: `sudo systemctl start mysql`). |
| The server stops with "Invalid configuration" | The message names the setting; most often `JWT_SECRET` is missing or shorter than 32 characters. |
| "No Super Admin exists yet" when seeding | Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and run `npm --prefix backend run seed` again. |
| Forgot the administrator password | Another administrator can reset it in *Settings → Users*, or use *Forgot password* on the sign-in page (needs email configured). On the server itself: `npm --prefix backend run user:reset-password -- admin@example.com` sets a temporary password (asked for twice), unlocks the account and signs out its sessions. |
| Account locked | Wait `LOGIN_LOCK_MINUTES` (15 by default) or unlock it in *Settings → Users*. |
| Other computers can't open the system | Run `firewall.bat` as administrator, set the network to *Private*, check `HOST=0.0.0.0`, use the server's IP address (`ipconfig`) with the port, and make sure the server isn't asleep. |
| "Port 5000 is already in use" | Another program uses the port — close it or change `PORT` (and `APP_URL`, firewall rule). |
| Blank page after an update | Rebuild the web app: `npm --prefix frontend run build`, then refresh the browser with Ctrl+F5. |
| Times look wrong | Set the salon's time zone in *Settings → System*. The database always stores UTC. |
| SMS/WhatsApp/email not delivered | *Notifications → Messages* shows each message and its error. Without credentials the provider is "log" (recorded, not sent); add credentials in *Settings → Integrations*. Internet is required for delivery; messages are retried automatically. |
| Receipt prints with the menu or on several pages | Use the *Print receipt (80 mm)* button; in the print dialog choose the receipt printer, paper 80 mm, margins *None*, and turn off headers/footers. |
| Tests fail with "Access denied … zola_stylish_test" | Grant the database user rights on the test database (see `database/create-database.sql`). |
| Docker: `required variable … is missing` | Set the named variable in `.env` (e.g. `MYSQL_ROOT_PASSWORD`). |

Logs: `backend/logs/app.log` (or the `start.bat` window, `pm2 logs zola-stylish`, `docker compose logs backend`).

---

© ZOLA STYLISH MANAGEMENT SYSTEM. Demo data shipped with the project is fictitious and exists only for evaluation and training.
