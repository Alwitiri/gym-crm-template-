# Gym CRM

A web app for a single gym business with several branches, a member app on the phone, and a public enquiry form. The front desk can find members, register them, sell memberships with GST invoices, take cash, UPI, card or bank payments, and work the lead pipeline. Owners also get a dashboard with collections, dues and renewals.

```
apps/
  api/   NestJS 11 + Prisma 7 + PostgreSQL 16   (REST, /api/v1)
  web/   Next.js 15 + Tailwind 4                (admin UI, light and dark)
```

## Run it locally

**Windows, quickest:** start Docker Desktop, then in this folder run
`powershell -ExecutionPolicy Bypass -File .\setup.ps1` (first time) or `.\start.ps1` (afterwards).

### Manual steps

Requirements: Node 22+ and Docker (or any PostgreSQL 16).

```bash
npm install
npm run db:up                                   # Postgres in Docker, user gym_owner
cp apps/api/.env.example apps/api/.env          # then fill in SESSION_SECRET
#   for local dev you can point both URLs at gym_owner first, then switch DATABASE_URL to gym_app below

# 1. Tables
npm -w @gymcrm/api exec prisma migrate dev -- --name init
# 2. Database rules (append-only ledgers, overlap guard, GST numbering, branch row-level security)
npm -w @gymcrm/api exec prisma migrate dev -- --create-only --name db_rules
cat apps/api/prisma/sql/constraints.sql >> apps/api/prisma/migrations/*_db_rules/migration.sql
npm -w @gymcrm/api exec prisma migrate dev
# 3. Restricted runtime role (row-level security only applies to non-owner, non-superuser roles)
docker compose exec -T db psql -U gym_owner gymcrm < apps/api/prisma/sql/roles.sql
#    then set DATABASE_URL=postgresql://gym_app:change-me@localhost:5432/gymcrm in apps/api/.env
# 4. Demo data (runs as owner)
DATABASE_URL=$MIGRATE_DATABASE_URL npm run db:seed

npm run dev:api        # http://localhost:4000/api/v1/health
npm run dev:web        # http://localhost:3000
```

Every demo login uses the password `Gym@12345678`:

| Login | Role | Sees |
|---|---|---|
| owner@irontemple.in | Owner | Everything, both branches |
| manager.rsp@irontemple.in | Branch manager | RS Puram |
| front.rsp@irontemple.in (or 98000 00003) | Receptionist | RS Puram |
| front.plm@irontemple.in | Receptionist | Peelamedu |
| vikram@irontemple.in | Trainer | RS Puram, only members assigned to him |
| ramya@irontemple.in | Trainer | Peelamedu, only members assigned to her |
| accounts@irontemple.in | Accountant | Payments and invoices, all branches, read-only members |

Tests: start the API against a freshly seeded database, then run `npm test` (49 end-to-end checks across both phases).

## What's in phase 1

- **Sign-in and sessions:** server-side sessions in an HttpOnly cookie, a CSRF token on every change, and Argon2id passwords. Accounts lock for 15 minutes after 5 wrong passwords, and sign-in is rate limited. Unknown users and wrong passwords get the same answer, with the same timing.
- **Roles and branches:**
  - Permission keys are granted through roles, optionally limited to one branch.
  - The API checks permissions and branch on every call, and records outside the user's branches return "not found".
  - PostgreSQL row-level security enforces branch isolation a second time, inside the database.
- **Members:** search by name, phone or code (press `/` anywhere), and register with a duplicate check. Privacy-notice and marketing consent are recorded in an append-only log. Profiles show membership history, invoices and payments.
- **Memberships:**
  - The price quote matches the invoice exactly, including CGST/SGST, registration fee and round-off.
  - Staff discounts are capped per plan.
  - Early renewals start the day after the current membership ends, and the database refuses overlaps.
  - A membership activates only once its invoice is fully paid. Partial payments leave a visible balance.
- **Billing:** GST invoice numbers are consecutive per branch and financial year. Invoices and payments can't be changed after the fact; the database blocks it, and corrections go through credit notes and refunds. There's a printable tax invoice with the amount in words. Retried requests (double clicks, flaky network) never charge twice.
- **Leads:** a pipeline board with follow-up reminders, a call and WhatsApp log, and lost reasons. Converting a lead creates the member and sells the plan in one step.
- **Dashboard:** active members, new joins, collections by payment method, outstanding dues, renewals due this week and lead follow-ups due. Revenue figures appear only for roles with `reports.finance`.
- **Audit log:** every sign-in, sale, payment and edit is recorded, with before and after values.
- **Daily job:** every 15 minutes, memberships move from scheduled to active to expired, and member statuses update to match.

## What's in phase 2

- **Check-in kiosk** (`/check-in`): works with a USB QR scanner (it types into the focused box), the tablet or laptop camera, a phone number or a member code. The server decides; the order of checks is: card found → not restricted → membership active today → not frozen → valid at this branch → inside the plan's hours and the branch's opening hours. A second scan within 4 hours shows "Already in" instead of creating a new visit. Every attempt is logged, including refusals, and a manager can let someone in with a written reason, which is audited.
- **Attendance** (`/attendance`): the log for any day, with refusals, the people inside now and check-out. Each member's Visits tab shows visits this month and in the last 30 days, and flags members who haven't been in for 7+ days.
- **Membership card**: a printable credit-card size card with a QR code. A lost card is replaced in one click and the old QR stops working.
- **Freezing**: within each plan's limits (days and number of times, from the terms it was sold under). The end date moves out, and any renewal already booked moves with it. Unfreezing early gives back the unused days. A freeze booked for a later date switches on and off by itself.
- **Trainers** (`/trainers`): members per trainer, PT today and this month. Assign or change a member's trainer from the Training tab.
- **Workout and diet plans**: built by the trainer from a 37-exercise starter library (trainers can add more), grouped by training day, with printable versions. Diet plans have meal times, foods, calories and protein, preferences (veg, Jain…) and allergies. Body measurements are tracked with a weight trend.
- **Personal training**: packages (sessions, validity, price) on the Plans page. Selling a package issues a GST invoice and becomes active when paid. Sessions are booked within validity and the sessions left; the database refuses to double-book a trainer. Trainers mark sessions done. A member cancelling with less than 12 hours' notice, or not turning up, uses the session; a trainer cancelling never does. `/schedule` shows the week.
- **Branches** (`/branches`): set the opening hours that check-in uses.

Upgrading an existing install: run `setup.ps1` again. There are no database schema changes; new permissions and the exercise library are added automatically when the API starts, and the demo PT/visit data is added once.

## What's in phase 3 (handover release)

- **Settings** (`/settings`): gym name (used everywhere: sidebar, login, invoices, cards, member app), GSTIN/PAN/state, contact details, invoice footer and terms, check-in grace days, reminder rules.
- **Staff** (`/staff`): add staff with a generated first password, change access (front desk, trainer, manager, accounts, admin, owner), reset passwords, remove someone (their members move to another trainer). **My account**: change your own password, see and sign out other devices.
- **Import members** (`/members/import`): Excel or CSV, columns matched automatically, a full check of every row before anything is saved, current/expired memberships and opening balances carried over. Re-running never duplicates.
- **Expenses** (`/expenses`) and **Reports** (`/reports`): profit and loss with a 6-month chart, GST sales (B2C, for GSTR-1), renewals (who didn't renew), leads by source, trainer performance. Every table exports to CSV for Excel.
- **Online payments**: a *Payment link* button on unpaid invoices creates a Razorpay link (UPI/card/netbanking), shown as a QR code or sent on WhatsApp. Razorpay's webhook is signature-checked, processed exactly once, and the amount must match; the payment is recorded, the invoice settled and the membership activated by itself. Without Razorpay keys the button is hidden; with `PAYMENTS_SIMULATOR=1` (demo only) a practice payment page is used.
- **WhatsApp messages** (`/messages`): welcome, expiring soon/today, win-back after expiry, payment due, PT tomorrow, receipt, birthday (only with marketing consent). Generated hourly after the configured time, never duplicated. Without the WhatsApp Business API, staff send each one in a click (wa.me) and mark it sent; with it they go out by themselves. Wording is editable.
- **Member app** (`/m`, phone-first): sign in with a WhatsApp code, days left, check-in QR, dues with *Pay*, renew online (next plan starts after the current one), visits, PT sessions left, current plans.
- **Enquiry form** (`/join?src=instagram&c=campaign`): public form for the website and social bios; creates a high-priority lead with source and campaign, spam-protected.
- **Production kit** (`deploy/`): Dockerfiles, `docker-compose.prod.yml` with Caddy (automatic HTTPS), nightly verified backups and a restore script, first-run setup for a real (non-demo) installation. See `deploy/DEPLOY.md`.

Tests: `npm test` runs 69 end-to-end API tests (phase 3 includes a mock Razorpay and WhatsApp server and signed webhooks).

Upgrading an existing install on your PC: run `start.ps1`. It installs the two new packages and turns on the demo payment page and on-screen member login codes. No database changes.

## Later

| Adds |
|---|
| Class booking, referrals, turnstile/biometric integration, payroll, inventory |
| Refunds and credit notes UI, MFA for owners, password reset by OTP |
| Redis-backed rate limits and job queue for running more than one API instance |

Things to know before going live:
- The login and OTP rate limiters live in memory. Fine for one server; move to Redis before running more than one API instance.
- Confirm the SAC code (`999723`) and GST registration details with the client's CA.

## Security notes for deployment

- Put the API and web app behind one domain. The Next.js server proxies `/api/v1`, so the session cookie stays first-party. Set `NODE_ENV=production` so cookies are `Secure`.
- The API must connect as `gym_app`, never as the table owner or a superuser. Those bypass row-level security.
- `SESSION_SECRET` should hold at least 32 random bytes.
- Backups: nightly dumps plus an off-site copy (see `deploy/DEPLOY.md`). Test a restore before launch.
