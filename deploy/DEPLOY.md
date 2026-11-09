# Putting Gym CRM live

One small Linux server runs everything: the database, the API, the web app, automatic HTTPS (Caddy) and nightly backups.

## What you need

| Item | Notes |
|---|---|
| A Linux server | Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB SSD is plenty for 1–3 branches (e.g. AWS Lightsail Mumbai, DigitalOcean Bangalore, Hetzner). |
| A domain name | e.g. `crm.yourgym.in`. Create a DNS **A record** pointing at the server's IP before step 4. |
| Docker | `curl -fsSL https://get.docker.com \| sh` |
| The project folder | Including `apps/api/prisma/migrations` — created on your PC by `setup.ps1`. Keep that folder; it is the database history. |

Open only ports 22, 80 and 443 in the server firewall.

## 1. Copy the project to the server

```bash
scp -r gym-crm ubuntu@SERVER_IP:~/      # or git clone your private repository
ssh ubuntu@SERVER_IP
cd ~/gym-crm
```

## 2. Fill in the settings

```bash
cp deploy/env.prod.example deploy/.env.prod
nano deploy/.env.prod
```

Generate the three secrets with `openssl rand -base64 36` (one per line). Fill in the gym, first branch and owner details. Leave Razorpay and WhatsApp empty for now if the client hasn't got them yet.

## 3. Build

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod build
```

## 4. Start the database, then run first-time setup

```bash
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"
$C up -d db
$C --profile setup run --rm setup
```

The setup step applies the database migrations, creates the restricted app login and creates the business, first branch and owner. **It prints the owner's first password once — note it down.** Running it again is safe: it never touches existing data.

## 5. Start everything

```bash
$C up -d
$C ps            # all services "running" / "healthy"
```

Open `https://crm.yourgym.in`, sign in as the owner, then:

1. My account → change password.
2. Settings → business details, GSTIN, invoice text, reminder rules.
3. Branches → opening hours (and add more branches).
4. Plans → membership plans and PT packages.
5. Staff → add front desk, trainers, accounts.
6. Members → Import → bring existing members over from Excel.

## 6. Connect Razorpay (online payments)

1. Razorpay Dashboard → Settings → API Keys → generate **live** keys.
2. Settings → Webhooks → Add: URL `https://crm.yourgym.in/api/v1/webhooks/razorpay`, secret = a new random string, event **payment_link.paid**.
3. Put the key id, key secret and webhook secret in `deploy/.env.prod`, then `$C up -d api`.

Test with a ₹1 invoice: Payment link → pay → it shows as Paid within seconds.

## 7. Connect WhatsApp (automatic messages)

Without this the Messages page lets staff send each message from WhatsApp with one click.

1. Meta Business Manager → WhatsApp → add the gym's number (it can't stay on the WhatsApp phone app).
2. Create message templates with the same names and variables as on the Messages → Wording page (`welcome`, `expiry_before`, `expiry_today`, `expiry_after`, `dues_reminder`, `pt_tomorrow`, `payment_receipt`, `birthday`), plus an **authentication** template `login_otp` for member-app login codes. Wait for approval.
3. Create a system user with a permanent token (permission `whatsapp_business_messaging`).
4. Put the phone number id and token in `deploy/.env.prod`, then `$C up -d api`.

Until WhatsApp is connected, members can't log in to the member app (codes are sent on WhatsApp). Everything else works.

## Backups

- Every night at `BACKUP_HOUR` a compressed dump goes to `deploy/backups/` (kept `BACKUP_KEEP_DAYS` days). Each dump is checked after writing.
- Backup now: `$C exec backup bash /backup.sh now`
- Check: `ls -lh deploy/backups` and `$C logs --tail 20 backup`
- **Off-site copy (do this):** a server failure takes local backups with it. Copy the folder off the server daily, e.g. with `rclone` to Google Drive or S3 in a cron job:
  `30 3 * * * rclone copy ~/gym-crm/deploy/backups gdrive:gymcrm-backups --max-age 48h`
- Restore: `./deploy/restore.sh deploy/backups/gymcrm-YYYY-MM-DD.dump` (takes a safety backup first, asks you to type RESTORE).

Test a restore on a spare server once before handover.

## Updating

```bash
cd ~/gym-crm && git pull                     # or copy the new files over
$C build
$C --profile setup run --rm setup            # applies any new migrations
$C up -d
```

## Everyday checks

| What | Command |
|---|---|
| Is it up? | `curl -s https://crm.yourgym.in/api/v1/health` → `{"ok":true}` |
| API errors | `$C logs --tail 100 api` |
| Disk space | `df -h /` (keep under 80%) |
| Restart one part | `$C restart api` |

## Security notes

- The database has no public port. The app connects as `gym_app`, which row-level security restricts to each user's branches and which can't edit or delete audit, consent or payment-allocation records.
- `PAYMENTS_SIMULATOR` and `OTP_DEV_ECHO` must never be set here; the API refuses to start if they are.
- Keep `deploy/.env.prod` readable only by you: `chmod 600 deploy/.env.prod`.
- `npm audit` reports advisories in `multer` (file uploads, not used by this app) and in the PostCSS copy bundled with Next.js (build-time only). Review at each update.
