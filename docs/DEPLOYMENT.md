# ZOLA STYLISH MANAGEMENT SYSTEM — Deployment guide

This guide covers every supported way to run ZOLA STYLISH MANAGEMENT SYSTEM in production. The [README](../README.md) has the quick start; this document goes step by step and explains the choices.

1. [Choosing a deployment](#1-choosing-a-deployment)
2. [Windows local server (salon computer)](#2-windows-local-server-salon-computer)
3. [Local network (LAN) access](#3-local-network-lan-access)
4. [Linux VPS](#4-linux-vps)
5. [Nginx reverse proxy](#5-nginx-reverse-proxy)
6. [HTTPS certificates](#6-https-certificates)
7. [Domain configuration](#7-domain-configuration)
8. [Docker](#8-docker)
9. [Updating](#9-updating)
10. [Production checklist](#10-production-checklist)

---

## 1. Choosing a deployment

| Situation | Recommended setup | Internet needed? |
| --- | --- | --- |
| One salon, staff use it only inside the salon | **Windows local server** + LAN access | No (only for SMS/WhatsApp/email and the optional AI summary) |
| Owner wants to check figures from home, or several branches share one system | **Linux VPS** with Nginx, HTTPS and a domain | Yes, at every branch |
| IT-managed server, or you already run containers | **Docker** (on Windows, Linux or a VPS) | Depends on where it runs |

In every setup there is exactly **one** server process and **one** MySQL database. Every other computer, tablet and phone uses the system through a web browser — nothing is installed on them.

Architecture of a production installation:

```text
Browser ──HTTP(S)──> [Nginx: TLS, gzip]  ──>  Node.js API (port 5000)  ──>  MySQL 8
                      optional on a LAN        serves the web app too        storage/uploads, storage/backups
```

---

## 2. Windows local server (salon computer)

Choose a computer that stays on during opening hours: a small desktop or mini-PC with an SSD and 8 GB RAM is plenty. Connect it to the router with a cable if possible.

### 2.1 Install

Follow [README → Installation → Windows](../README.md#windows-salon-computer--the-easy-way):

1. Install Node.js LTS and MySQL 8 (*Server only*, service starts automatically).
2. Create the database and user with [`database/create-database.sql`](../database/create-database.sql).
3. Copy the project to `C:\ZolaStylish` (avoid paths with special characters or OneDrive-synchronised folders).
4. Run `setup.bat`, fill in `DATABASE_PASSWORD`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` when Notepad opens, save and close.
5. Run `start.bat` and sign in; choose a new administrator password when asked.

### 2.2 Power settings

- *Settings → System → Power → Screen and sleep*: **Never** sleep when plugged in (the screen may turn off).
- *Settings → Windows Update → Advanced options → Active hours*: set them to the salon's opening hours so Windows never restarts during business.
- A small UPS (battery backup) protects the database from power cuts, which are the most common cause of data loss on salon computers.

### 2.3 Start automatically

**Simplest:** press `Win + R`, type `shell:startup`, and put a shortcut to `start.bat` in the folder that opens. The system starts when the salon computer signs in to Windows (enable automatic sign-in or sign in each morning).

### Windows service with PM2

For a server that starts even before anyone signs in, and restarts itself if it ever stops, use PM2. Open **Command Prompt as administrator**:

```bat
npm install -g pm2 pm2-windows-startup
cd C:\ZolaStylish
pm2 start ecosystem.config.js
pm2 save
pm2-startup install
```

- `ecosystem.config.js` runs one process named `zola-stylish` (one process on purpose: reminders and scheduled backups must run exactly once).
- `pm2 save` remembers the running process; `pm2-startup install` restores it when Windows starts.
- Daily use: `pm2 status`, `pm2 logs zola-stylish`, `pm2 restart zola-stylish`, `pm2 stop zola-stylish`.
- Do not also use `start.bat` — only one copy may run.

**Alternative without PM2 — Task Scheduler.** *Task Scheduler → Create Task*: *General*: name *ZOLA STYLISH MANAGEMENT SYSTEM*, *Run whether user is logged on or not*; *Triggers*: *At startup* (delay 1 minute so MySQL is up); *Actions*: *Start a program* `C:\Program Files\nodejs\node.exe`, arguments `src\server.js`, start in `C:\ZolaStylish\backend`; *Settings*: *If the task fails, restart every 1 minute*, untick *Stop the task if it runs longer than*. Set `NODE_ENV=production` in `.env` when running this way.

### 2.4 Backups on a Windows server

Automatic backups are on by default (every day at 23:00, the latest 14 kept) — check *Settings → Backups*. They are stored on the same disk, so **copy them elsewhere**: download one from *Settings → Backups* to a USB drive weekly, or point a cloud-sync folder (OneDrive, Google Drive) at a copy. `backup.bat` also archives uploaded files (logo, photos, expense receipts). To automate it, create a Task Scheduler task that runs `backup.bat` nightly.

---

## 3. Local network (LAN) access

Summary (details in [README → LAN setup](../README.md#10-local-network-lan-setup)):

1. Reserve a fixed IP for the server in the router (e.g. `192.168.1.10`).
2. Keep `HOST=0.0.0.0`; set `APP_URL=http://192.168.1.10:5000` (QR codes and emailed links use it).
3. Run `firewall.bat` as administrator (allows TCP 5000 on *private* networks only) and make sure the salon network profile is **Private**.
4. Open `http://192.168.1.10:5000` on the other devices.

Keep the salon Wi-Fi protected with WPA2/WPA3 and a separate guest network for customers — anyone on the staff network can reach the sign-in page.

### LAN on port 80

So that staff can type just `http://192.168.1.10` (or a name such as `http://salon.local` set up in the router's DNS):

**Option A — let the app listen on port 80.** In `.env` set `PORT=80` and `APP_URL=http://192.168.1.10`, run `firewall.bat` again (it reads the port from `.env`) and restart. Port 80 must be free: IIS or Skype-era software sometimes uses it — `netstat -ano | findstr :80` shows what does.

**Option B — Nginx in front (Windows).** Download Nginx for Windows from <https://nginx.org/en/download.html>, unzip to `C:\nginx`, replace `C:\nginx\conf\nginx.conf` with:

```nginx
worker_processes 1;
events { worker_connections 1024; }
http {
  include mime.types;
  server {
    listen 80;
    server_name _;
    client_max_body_size 10m;
    location / {
      proxy_pass http://127.0.0.1:5000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 180s;
    }
  }
}
```

Then in `.env` set `HOST=127.0.0.1` (only Nginx may reach the app), `TRUST_PROXY=true` and `APP_URL=http://192.168.1.10`, allow TCP 80 in the firewall (`netsh advfirewall firewall add rule name="ZOLA STYLISH MANAGEMENT SYSTEM (web)" dir=in action=allow protocol=TCP localport=80 profile=private`) and start `C:\nginx\nginx.exe`.

---

## 4. Linux VPS

Tested on Ubuntu 24.04 LTS. A VPS with 1 vCPU, 2 GB RAM and 25 GB SSD handles several busy salons. Choose a data centre close to the salons (e.g. Johannesburg, Nairobi, Frankfurt for East Africa).

### 4.1 Prepare the server

```bash
# as root (or with sudo)
apt update && apt -y upgrade
apt -y install nginx mysql-server git curl ufw

# Node.js 22 LTS from NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs

# Firewall: SSH and web only. MySQL (3306) and the app port (5000) stay private.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

# A dedicated, unprivileged user owns and runs the application
adduser --system --group --home /opt/zola-stylish zola
```

Run `mysql_secure_installation` and keep MySQL bound to `127.0.0.1` (the Ubuntu default). Set the server clock to UTC (`timedatectl set-timezone UTC` — the application converts to the salon's time zone itself).

### 4.2 Install the application

```bash
# copy the project (git clone, scp or rsync) into /opt/zola-stylish
git clone <your-repository-url> /opt/zola-stylish/app   # or upload the files
cd /opt/zola-stylish/app

# database and user — replace CHANGE_ME with a strong password first
sudo mysql < database/create-database.sql

chown -R zola:zola /opt/zola-stylish
sudo -u zola bash scripts/linux/setup.sh     # first run creates .env and stops
sudo -u zola nano .env                        # see the settings below
sudo -u zola bash scripts/linux/setup.sh     # installs, builds, creates tables and the admin
chmod 600 .env
```

Settings for a VPS behind Nginx with HTTPS (full list in [README → Environment variables](../README.md#5-environment-variables)):

```ini
NODE_ENV=production
HOST=127.0.0.1                 # only Nginx can reach the app
PORT=5000
APP_URL=https://salon.example.com
SERVE_FRONTEND=true            # the app serves the web pages; Nginx forwards everything
TRUST_PROXY=true               # one proxy (Nginx) in front
COOKIE_SECURE=true             # after HTTPS works (section 6)
DATABASE_PASSWORD=...          # the password from create-database.sql
JWT_SECRET=...                 # generated by setup.sh
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=...             # temporary; you must change it at first sign-in
```

### 4.3 Run it as a service

**systemd (recommended on Linux).** Copy [`docs/deploy/zola-stylish.service`](deploy/zola-stylish.service) — adjust the paths if you installed elsewhere:

```bash
sudo cp docs/deploy/zola-stylish.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zola-stylish
systemctl status zola-stylish
journalctl -u zola-stylish -f          # live logs
```

The unit runs as the `zola` user, restarts on failure, starts after MySQL, and uses systemd sandboxing (read-only system, writable only `backend/storage` and `backend/logs`). Because systemd collects the output, you can set `LOG_FILE=` (empty) to log only to the journal.

**PM2 (alternative).** As the `zola` user: `pm2 start ecosystem.config.js && pm2 save`, then run the command printed by `pm2 startup` as root.

Check it answers locally before configuring Nginx:

```bash
curl -s http://127.0.0.1:5000/api/health
```

### 4.4 Off-site backups

Automatic backups are written to `backend/storage/backups`. Copy them off the VPS — if the VPS is lost, so are backups stored on it. For example with `rclone` to any cloud storage, nightly after the 23:00 backup:

```bash
# crontab -e   (as the zola user)
30 23 * * * /opt/zola-stylish/app/scripts/linux/backup.sh >> /opt/zola-stylish/backup.log 2>&1
0  0  * * * rclone copy /opt/zola-stylish/app/backend/storage/backups remote:zola-backups --max-age 48h
```

`scripts/linux/backup.sh` also archives uploaded files as `uploads-*.tar.gz`. Those archives are not pruned by the in-app retention setting, so delete old ones periodically (e.g. `find backend/storage/backups -name 'uploads-*.tar.gz' -mtime +30 -delete`).

---

## 5. Nginx reverse proxy

Nginx terminates HTTPS, compresses responses and forwards everything to the Node.js process, which serves both the API and the web application with its own security headers.

```bash
sudo cp docs/deploy/nginx-zola-stylish.conf /etc/nginx/sites-available/zola-stylish
sudo nano /etc/nginx/sites-available/zola-stylish      # replace salon.example.com with your domain
sudo ln -s /etc/nginx/sites-available/zola-stylish /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The example file [`docs/deploy/nginx-zola-stylish.conf`](deploy/nginx-zola-stylish.conf):

- forwards all requests to `127.0.0.1:5000` with `X-Forwarded-For` / `X-Forwarded-Proto` (the app's rate limiting and activity log use the real client address because `TRUST_PROXY=true`);
- allows 10 MB request bodies (uploads are limited to `MAX_UPLOAD_MB`, 5 MB by default, by the app);
- gives report exports up to 180 seconds;
- blocks access to hidden files such as `.env` as a second line of defence (the app never serves them).

Serving the static files directly from Nginx is possible (see [`docker/nginx.conf`](../docker/nginx.conf) for a complete example with security headers, used by the Docker setup) — then set `SERVE_FRONTEND=false`. For a single VPS the gain is small; forwarding everything keeps one source of truth for headers and caching.

---

## 6. HTTPS certificates

HTTPS is **required** for any installation reachable from the internet: without it, passwords and customer data cross the network in plain text.

### Let's Encrypt (free, automatic renewal)

The domain must already point at the VPS (section 7) and ports 80/443 must be open.

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d salon.example.com --redirect -m owner@example.com --agree-tos
sudo certbot renew --dry-run          # renewal is automatic; this tests it
```

Certbot adds the certificate to the Nginx site and redirects HTTP to HTTPS. Then update `.env`:

```ini
APP_URL=https://salon.example.com
COOKIE_SECURE=true
FORCE_HTTPS=true
TRUST_PROXY=true
```

and restart (`sudo systemctl restart zola-stylish`). With `COOKIE_SECURE=true` the app marks its session cookie *Secure*, sends `Strict-Transport-Security` (one year) and upgrades insecure requests; `FORCE_HTTPS=true` also redirects any plain-HTTP page to HTTPS and refuses API calls over HTTP. Test at <https://www.ssllabs.com/ssltest/> — expect grade A.

### Your own certificate

If you bought a certificate, add to the `server` block (and a port-80 block that redirects, as certbot would):

```nginx
listen 443 ssl;
http2 on;
ssl_certificate     /etc/ssl/zola/fullchain.pem;
ssl_certificate_key /etc/ssl/zola/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;
```

### HTTPS on a LAN

Browsers cannot get public certificates for private IP addresses. For LAN-only installs plain HTTP inside a protected salon network is common practice. If the salon wants HTTPS internally, use a domain you own with a DNS-challenge certificate (`certbot certonly --manual --preferred-challenges dns -d salon.example.com`) and a router DNS entry pointing that name at the server's LAN IP, or a VPN such as Tailscale that provides certificates.

---

## 7. Domain configuration

1. Buy or use a domain (e.g. `example.com`) and decide on a name for the system, such as `salon.example.com` or `app.example.com`.
2. At the domain's DNS provider create:

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | `A` | `salon` | the VPS's public IPv4 address | 3600 |
   | `AAAA` | `salon` | the VPS's IPv6 address (only if it has one and Nginx listens on IPv6) | 3600 |

   For the bare domain (`example.com`) use the name `@`; for `www` add a `CNAME` to the main name.
3. Wait for the record to appear (usually minutes, up to 24 hours): `dig +short salon.example.com` must print the VPS address.
4. Put the name in the Nginx `server_name`, request the certificate (section 6) and set `APP_URL=https://salon.example.com` — appointment QR codes, password-reset links and emails use it.
5. Email deliverability (if the system sends email from your domain): add the SPF/DKIM records your email provider gives you.

If you use Cloudflare's proxy (orange cloud), set SSL mode to **Full (strict)** and set `TRUST_PROXY=2` (Cloudflare + Nginx).

---

## 8. Docker

The Docker setup runs three containers — `mysql` (MySQL 8.4), `backend` (API, unprivileged user) and `frontend` (Nginx serving the web app and forwarding `/api`) — with data in the named volumes `mysql-data`, `uploads` and `backups`. Quick start and daily commands: [README → Docker deployment](../README.md#11-docker-deployment).

```bash
cp .env.example .env
node scripts/configure-env.js       # optional: generates JWT_SECRET and MYSQL_ROOT_PASSWORD
nano .env                           # DATABASE_PASSWORD, MYSQL_ROOT_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
docker compose ps                   # all three "healthy"
```

On first start the backend waits for MySQL, applies the schema and migrations, loads reference data and creates the administrator. Later starts (and `docker compose up -d --build` after an update) apply only new migrations.

### Docker behind HTTPS

Run Nginx (or Caddy, Traefik) on the host for TLS and publish the stack only on localhost:

```ini
# .env
HTTP_PORT=127.0.0.1:8080
DOCKER_PROXY_HOPS=2          # host Nginx + the frontend container
COOKIE_SECURE=true
APP_URL=https://salon.example.com
```

Use [`docs/deploy/nginx-zola-stylish.conf`](deploy/nginx-zola-stylish.conf) with `proxy_pass http://127.0.0.1:8080;`, then run certbot as in section 6 and `docker compose up -d`.

### Docker notes

- MySQL is not published to the host; only the backend container can reach it.
- Back up the volumes, not just the database: `docker compose exec backend npm run backup` (database) and `docker run --rm -v zola-stylish_uploads:/data -v "$PWD":/out alpine tar czf /out/uploads.tar.gz -C /data .` (uploaded files). Copy `backups` out with `docker compose cp` (README).
- Reset a forgotten administrator password: `docker compose exec -it backend npm run user:reset-password -- owner@example.com`.
- Logs: `docker compose logs -f backend` (the backend logs to stdout only in Docker).
- `docker compose down -v` **deletes all data**. Use `docker compose down` to stop.

---

## 9. Updating

1. Announce a short break and make a backup (*Settings → Backups → Back up now*, then download it).
2. Stop the application (`pm2 stop zola-stylish`, `systemctl stop zola-stylish`, or close `start.bat`).
3. Replace the program files (keep `.env`, `backend/storage/` and `backend/logs/`), or `git pull`.
4. Install and build:
   ```bash
   npm --prefix backend ci --omit=dev
   npm --prefix frontend ci && npm --prefix frontend run build
   npm --prefix backend run migrate
   ```
   On Windows, running `setup.bat` again does all of this (it never overwrites `.env` or existing data).
5. Start again and check *Settings → Backups* and the dashboard.

Docker: `git pull && docker compose up -d --build` (migrations run automatically).

---

## 10. Production checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` unique, random, 32+ characters (never the example value) — changing it later signs everyone out
- [ ] Strong, unique database password; MySQL reachable only from the server (not port-forwarded, not published)
- [ ] `.env` readable only by the service account (`chmod 600 .env`) and never committed or emailed
- [ ] Administrator changed the temporary password at first sign-in; each staff member has their **own** account with the right role
- [ ] Internet-facing: HTTPS works, `COOKIE_SECURE=true`, `FORCE_HTTPS=true`, `TRUST_PROXY` matches the number of proxies, `HOST=127.0.0.1` behind Nginx
- [ ] The application's MySQL account is its own (never `root`) and limited to its database
- [ ] Two-step sign-in required for administrators (*Settings → Security*), and every administrator has set it up and saved their recovery codes
- [ ] `BACKUP_ENCRYPTION_KEY` set (and stored safely off the server) and `BACKUP_COPY_DIR` pointing to a second location
- [ ] Virus scanning of uploads: `CLAMAV_HOST` (Docker: `--profile antivirus`) and `MALWARE_SCAN_REQUIRED=true`
- [ ] *Settings → Security* shows no failed checks; GitHub secret scanning, push protection and Dependabot alerts switched on
- [ ] `APP_URL` is the address people actually use (QR codes and links)
- [ ] Business name, logo, currency, tax, time zone and receipt settings filled in (*Settings*)
- [ ] Demo data removed (`npm --prefix backend run demo:clear`) and `SEED_DEMO_DATA=false`
- [ ] Automatic backups on, **and** copies stored off the server; a restore tested once on a spare computer
- [ ] Messaging credentials entered in *Settings → Integrations* (optional) and a test message sent; for WhatsApp confirmations, replies and thank-you messages follow [WHATSAPP.md](WHATSAPP.md)
- [ ] Server does not sleep; Windows Update active hours set; UPS for the salon computer
- [ ] Operating system, Node.js and MySQL receive security updates (`unattended-upgrades` on Ubuntu)
