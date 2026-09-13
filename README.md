# ServiceProof

Customer-verified billing for salons & barbershops.

Staff create the bill after service → customer scans a QR and approves it on their own
phone → payment is recorded → the owner sees exactly what was sold, what customers
verified, and where the money went. Every action is written to an immutable audit trail.

## Stack

- **Backend** — Django 6 + Django REST Framework, PostgreSQL, `qrcode` for server-side QR generation
- **Frontend** — Next.js 15 (App Router) + TypeScript + Tailwind v4, proxied to Django (`/api/*` → `:8000`) in dev
- One command per process, no Docker needed for local dev

## Run it

```bash
# 1. Backend (first time: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)
cd serviceproof-dj
.venv/bin/python manage.py migrate
.venv/bin/python seed_demo.py          # plans + XYZ Salon demo data
.venv/bin/python manage.py runserver 127.0.0.1:8000

# 2. Frontend
./start-next.sh                        # npx next dev -p 3000
```

Open **http://localhost:3000**

## URLs

| URL | Who | What |
|---|---|---|
| `/` | everyone | Landing page |
| `/pricing` | everyone | 4 plans (KSh 299/499/799/1,299) + annual toggle (2 months free) |
| `/signup` | owner | 7-day free trial, no card → creates business + 2 staff, drops into the app |
| `/app` | staff | Build bill → QR → live-waits for customer verification → record payment |
| `/v/[code]` | customer (no login) | See the bill → **approve** or **report a problem** → branded receipt + share (WhatsApp/SMS/PDF) |
| `/r/[code]` | anyone | Public receipt-authenticity lookup — scan the QR on a receipt to prove it's genuine |
| `/owner` | owner | PIN gate → revenue hero (vs yesterday), variance, exceptions, live activity feed, void |
| `/settings` | owner | Appearance: receipt theme (Blush/Rose/Luxe/Plum/Minimal), tagline, phone, location, thank-you message — live preview; the verified stamp can't be removed |

**Demo business:** `xyz-salon`, owner PIN `2026` (branding pre-set: Blush theme, tagline, Swahili thank-you).
Seed data includes Mary's edited bill (Braiding KSh 2,500 → 2,000, "Customer discount"),
a disputed bill, and an unpaid approved bill — the exact "leak" examples from the spec.
Re-running `seed_demo.py` re-dates the demo bills to today so the dashboard always demos well.

## What's enforced

- **Status lifecycle** — `draft → pending → approved/disputed → paid`, plus `voided`.
  Pay before approval: blocked (409). Edit after approval: blocked (409) — void & re-create.
  Void a paid bill: blocked (409) — refund flow instead. Double-pay: blocked.
- **Audit trail** (never deleted, FK-protected) — `created → scanned → edited (before → after + reason) → verified/disputed → paid/voided`.
- **Plan limits** — staff cap and verified-bills-per-month cap enforced at API level with HTTP 402 and upgrade messaging (tested at both create and verify time).
- **Owner PIN** — dashboard, void, and staff-add require the PIN (401 otherwise).

## Config

- `config/settings.py` — Postgres creds (`serviceproof` / `sp_dev_2026` @ 127.0.0.1), `PUBLIC_BASE_URL`
  (used inside QR codes — set to your LAN IP or deployed domain so phones can scan).
- `e2e_test.sh` — 19-check end-to-end API suite (happy path, guard rails, plan caps, QR URLs).
  Run it any time; it cleans up after itself.
