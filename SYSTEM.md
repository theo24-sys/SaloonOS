# SaloonOS — Complete System Documentation

**Customer-verified billing for salons & barbershops.**
Operated by Morggy Technologies · Juja, Nairobi, Kenya · morggytechnologies@gmail.com · 0714042946

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Repository Layout](#4-repository-layout)
5. [Data Model](#5-data-model)
6. [Bill Lifecycle & Business Rules](#6-bill-lifecycle--business-rules)
7. [Audit Trail](#7-audit-trail)
8. [Authentication & Security Model](#8-authentication--security-model)
9. [Subscriptions, Plans & Trials](#9-subscriptions-plans--trials)
10. [M-Pesa Integration (Daraja)](#10-mpesa-integration-daraja)
11. [API Reference](#11-api-reference)
12. [Frontend Application](#12-frontend-application)
13. [Image Storage (Cloudflare R2)](#13-image-storage-cloudflare-r2)
14. [Configuration Reference (All Environment Variables)](#14-configuration-reference-all-environment-variables)
15. [Local Development](#15-local-development)
16. [Seeding & Demo Data](#16-seeding--demo-data)
17. [Deployment](#17-deployment)
18. [Testing](#18-testing)
19. [Migrations](#19-migrations)
20. [Platform Admin (Master Management)](#20-platform-admin-master-management)
21. [Analytics & Metrics](#21-analytics--metrics)
22. [Known Limitations & Risk Register](#22-known-limitations--risk-register)
23. [Operations Runbook](#23-operations-runbook)
24. [Glossary](#24-glossary)

---

## 1. Product Overview

SaloonOS solves a specific trust problem in Kenyan salons: customers pay for services
without an independent record of what was agreed, and owners cannot reconcile what was
sold against what was collected.

**The core flow:**

```
Staff                Customer                 SaloonOS
─────                ────────                 ────────
1. Create bill  ──►  QR code shown
                     2. Scan QR      ──►      Bill opened (audit: scanned)
                     3. Review items          Services + prices shown
                     4. Approve or dispute ─► (audit: verified / disputed)
                     5. Choose M-Pesa/
                        Cash/Card intent
6. Record payment ◄─  pays the salon          (audit: paid)
7. Owner dashboard ◄────────────────────────── Revenue, variance, leaks, audit feed
```

**Key guarantees:**

- **Customer verification** — a bill only becomes "verified" when the customer approves
  it on their own phone. Paying before approval is impossible (HTTP 409).
- **Immutability** — bills are never deleted, only moved through statuses. The audit
  trail is append-only. Paid bills can be refunded, never voided.
- **Owner visibility** — the dashboard shows expected vs collected revenue, edited
  bills, disputed bills, verified-but-unpaid "leaks", and a live audit feed.
- **Plan enforcement** — staff counts and monthly verified-bill caps are enforced at
  the API level (HTTP 402) at both bill creation *and* verification time.
- **Subscription gating** — a business whose trial and paid period have both expired
  cannot create or verify bills until an M-Pesa payment succeeds.

**Commercial model:** 4 subscription tiers (KSh 299 / 499 / 799 / 1,299 per month,
annual = 10× monthly i.e. 2 months free), 7-day free trial at signup, payments via
M-Pesa STK push (Safaricom Daraja) or Paybill-sticker receipt redemption.

---

## 2. System Architecture

```
                        ┌───────────────────────────────────────────────┐
   Customer's phone ──► │  Next.js 15 (App Router)  :3000               │
   Staff devices  ──►   │  - SSR shell + client pages                   │
   Owner browser  ──►   │  - rewrites /api/* ──► API_ORIGIN             │
                        │    (one origin, no CORS in prod)              │
                        └──────────────────┬────────────────────────────┘
                                           │ HTTP (Next.js rewrite proxy)
                                           ▼
                        ┌───────────────────────────────────────────────┐
                        │  Django 6 + DRF  :8000 (gunicorn in prod)     │
                        │  config/urls.py → core/views.py               │
                        │  - Business logic, auth, plan caps            │
                        │  - QR generation (qrcode lib, server-side)    │
                        └───────┬───────────────────────┬───────────────┘
                                │                       │
                     psycopg2 (SSL in prod)         urllib (stdlib)
                                │                       │
                                ▼                       ▼
                   ┌────────────────────┐   ┌─────────────────────────────┐
                   │ PostgreSQL         │   │ Safaricom Daraja API        │
                   │ (local / Supabase) │   │ OAuth + STK push + query    │
                   └────────────────────┘   │ callbacks → /api/mpesa/     │
                                            └─────────────────────────────┘
                                │
                                ▼ (logos only, optional)
                   ┌────────────────────┐
                   │ Cloudflare R2      │
                   │ (S3-compatible)    │
                   └────────────────────┘
```

**Architectural decisions and why:**

| Decision | Rationale |
|---|---|
| Next.js proxies `/api/*` to Django | The browser sees one origin — no CORS complexity, no cookie splitting, single domain for QR links. |
| Token/PIN in HTTP headers (not cookies) | Simple stateless auth across staff devices and public customer pages. |
| Integer KSh amounts everywhere | No floating-point money errors. Kenya has no cents in practice for these prices. |
| `qrcode` rendered server-side | QRs are returned as `data:image/png;base64` in the API response — no client-side QR library needed. |
| Append-only `MpesaPayment` ledger | Failed/expired attempts remain for reconciliation; never deleted. |
| `PROTECT` on business/plan/payment FKs | Financial history cannot be cascade-deleted. |
| Timezone `Africa/Nairobi` | All day-boundary analytics ("today", "this month") use salon-local time. |

---

## 3. Technology Stack

| Component | Technology | Version | Notes |
|---|---|---|---|
| Backend framework | Django | 6.1.1 | |
| API layer | Django REST Framework | 3.18.1 | JSON-only renderer/parser |
| Database | PostgreSQL | 16 (Docker) / Supabase in prod | SQLite fallback via `DATABASE_URL` (dev/tests) |
| DB driver | psycopg2-binary | 2.9.13 | |
| QR codes | qrcode | 8.2 | PIL image factory |
| Imaging | Pillow | ≥ 10 | Logo compositing into QRs |
| Object storage | boto3 | 1.40.30 | Cloudflare R2 (S3 API) |
| Static files | WhiteNoise | 6.9.0 | CompressedManifestStaticFilesStorage |
| App server | gunicorn | 23.0.0 | 2 workers × 4 threads, 30 s timeout |
| CORS | django-cors-headers | 4.9.0 | Mainly for dev (prod is same-origin) |
| Frontend framework | Next.js | 15.5.25 | App Router, Turbopack |
| UI library | React | 19.1.0 | All pages are `"use client"` |
| Language | TypeScript | 5.x | Strict types in `lib/api.ts` |
| Styling | Tailwind CSS | 4.x | Via `@tailwindcss/postcss` |
| Linting | ESLint + eslint-config-next | 9.x | |
| Python runtime | 3.12.7 | pinned on Render | |
| Node runtime | 22.14.0 | pinned on Render | |

**Not used (intentionally, per spec's "don't build yet" list):** Redis, Celery,
WhatsApp/SMS notifications, email, WebSockets, Kubernetes.

---

## 4. Repository Layout

```
serviceproof-dj/
├── manage.py                    # Django entrypoint
├── requirements.txt             # Python dependencies (pinned)
├── seed_demo.py                 # Plans + XYZ Salon demo data (idempotent re-date)
├── e2e_test.sh                  # 19-check end-to-end API suite (self-cleaning)
├── .env.example                 # Template for every environment variable
├── render.yaml                  # Render blueprint (reference; see DEPLOY.md)
├── Dockerfile.api               # Python 3.12-slim + gunicorn image
├── Dockerfile.web               # Node 22-slim + next start image
├── docker-compose.yml           # db + api + web for VM deploys
├── start-django.sh              # Dev: runserver on 127.0.0.1:8000 (no reload)
├── start-next.sh                # Dev: npx next dev -p 3000
├── README.md                    # Product/feature summary
├── DEPLOY.md                    # Step-by-step deployment guide
├── SYSTEM.md                    # ← this document
│
├── config/                      # Django project package
│   ├── settings.py              # Env-driven settings (see §14)
│   ├── urls.py                  # All API routes (regex, trailing-slash optional)
│   ├── wsgi.py / asgi.py
│
├── core/                        # The single Django app
│   ├── models.py                # 12 models (§5)
│   ├── views.py                 # All API views (~1150 lines)
│   ├── serializers.py           # DRF serializers + QR generation
│   ├── mpesa.py                 # Daraja client (stdlib urllib, token cache)
│   ├── storage.py               # R2 logo upload w/ inline fallback
│   ├── admin.py / apps.py / tests.py
│   ├── migrations/              # 0001 … 0011
│   └── management/commands/
│       └── seed_plans.py        # Idempotent pricing-tier upsert
│
├── frontend/                    # Next.js application
│   ├── package.json             # next 15.5.25, react 19.1.0
│   ├── next.config.ts           # /api/* rewrite → API_ORIGIN
│   ├── tsconfig.json
│   ├── lib/api.ts               # Typed API client + localStorage store
│   ├── app/
│   │   ├── page.tsx             # Landing
│   │   ├── pricing/page.tsx     # 4 plans + annual toggle
│   │   ├── signup/page.tsx      # Owner onboarding (7-day trial)
│   │   ├── app/page.tsx         # Staff app (build bill → QR → wait → record)
│   │   ├── v/[code]/page.tsx    # Customer verification page (no login)
│   │   ├── r/[code]/page.tsx    # Public receipt-authenticity lookup
│   │   ├── owner/page.tsx       # Owner dashboard (PIN gate)
│   │   ├── pay/page.tsx         # Billing: M-Pesa STK + receipt redemption
│   │   ├── settings/page.tsx    # Branding + services management
│   │   ├── admin-dash/page.tsx  # Platform admin console
│   │   ├── terms/ privacy/      # Legal pages
│   │   ├── receipt.tsx          # Shared receipt component (print-ready)
│   │   ├── mpesa.tsx            # M-Pesa trust strip / scan-to-pay tiles
│   │   ├── app-chrome.tsx       # Header/footer chrome for staff app
│   │   ├── loading-state.tsx    # BrandLoader, VerificationSeal
│   │   ├── icons.tsx, layout.tsx, globals.css
│   └── public/                  # Logos, favicons, M-Pesa QR sticker, manifest
│
└── staticfiles/                 # collectstatic output (WhiteNoise serves in prod)
```

---

## 5. Data Model

All money values are **integers in KSh**. All timestamps are timezone-aware
(`USE_TZ = True`, `TIME_ZONE = Africa/Nairobi`). Auto fields: `auto_now_add` on
creation, `auto_now` where noted.

### 5.1 `Plan` — the 4 pricing tiers

| Field | Type | Notes |
|---|---|---|
| `code` | Char(20), unique | `starter` · `growth` · `business` · `pro` |
| `name` | Char(50) | Display name |
| `price_monthly` | int | KSh 299 / 499 / 799 / 1,299 |
| `price_annual` | int | 2990 / 4990 / 7990 / 12,990 (2 months free) |
| `monthly_verified_bills` | int | Verified-bill cap: 200 / 500 / 1000 / 2000 |
| `max_staff` | int | 4 / 8 / 15 / 25 (API enforces `max(2, value)`) |
| `tagline` | Char(120) | e.g. "Solo barber / tiny salon" |
| `is_target` | bool | The ⭐ recommended plan (Growth) |
| `features` | JSON list | Marketing bullet list rendered on /pricing |

Seeded by `python manage.py seed_plans` (idempotent, runs on every deploy).

### 5.2 `Business` — the tenant

| Field | Type | Notes |
|---|---|---|
| `name` | Char(120) | |
| `slug` | Slug, unique | Generated at signup from the name (alnum, ≤20 chars, deduped with `-2`, `-3`…). Used as the tenant identifier in every request header. |
| `plan` | FK → Plan | `PROTECT` |
| `owner_pin` | Char(255) | Peppered PBKDF2 hash via `core/pins.py` (was plaintext — fixed). Gates dashboard/void/branding/invites. |
| `trial_ends_at` | datetime, nullable | Auto-set to `now + 7 days` on first save |
| `plan_paid_until` | datetime, nullable | Extended by successful M-Pesa payments |
| `tagline / phone / location` | Char fields | Branding (owner-editable) |
| `accent` | Char(10), default `blush` | One of `blush, rose, luxe, plum, minimal` |
| `thank_you` | Char(150), default "Thank you for choosing us ♡" | Receipt footer |
| `logo_data_url` | Text | Inline data-URL or R2 public URL (§13) |

**Key methods:**

- `subscription_info()` — single source of truth:
  `{'state': 'paid'|'trial'|'expired', 'end': dt|None, 'days_left': int, 'reminder': bool}`.
  `paid` beats `trial` when both are valid. `reminder` is true within 5 days of expiry.
- `subscription_active()` — `state != 'expired'`.

### 5.3 `StaffMember`

| Field | Type | Notes |
|---|---|---|
| `business` | FK → Business, `CASCADE`, related `staff` | |
| `name` | Char(80) | Unique per business (`unique_together`) |
| `role` | Char(20), default `staff` | `staff` \| `manager` |
| `staff_pin` | Char(255), blank default | Peppered hash; empty string ⇒ access revoked (records kept for history) |

### 5.4 `Service` — the owner's price list

| Field | Type | Notes |
|---|---|---|
| `business` | FK, `CASCADE` | |
| `name` | Char(80) | Unique per business |
| `default_price` | int | Prefills bill lines in the staff app |

### 5.5 `Bill` — the central record

| Field | Type | Notes |
|---|---|---|
| `business` | FK, `PROTECT` | |
| `code` | Char(12), unique | 6 random chars `[A-Z0-9]`; the customer-facing reference embedded in the QR |
| `customer_name` | Char(80) | |
| `customer_phone` | Char(20), blank | Optional, captured at creation |
| `staff` | FK → StaffMember, `PROTECT` | Who served the customer |
| `status` | Char(12), default `draft` | `draft` `pending` `approved` `paid` `disputed` `voided` `refunded` |
| `total` | int | Sum of item prices; recomputed on create/edit |
| `approved_at` / `paid_at` | datetime, nullable | Set at verification / payment recording |
| `payment_method` | Char(20), blank | `M-Pesa` \| `Cash` \| `Card` \| `M-Pesa scan` |
| `payment_ref` | Char(20), blank | M-Pesa receipt code for scan-to-pay (§10.4) |
| `dispute_note` | Text | Customer's complaint |
| `created_at` / `updated_at` | auto | `ordering = ['-created_at']` |

### 5.6 `BillItem`

`bill` (FK, `CASCADE`, related `items`), `name` Char(80), `price` int.

### 5.7 `BillEdit` — the price-change ledger

`bill` (FK, `CASCADE`, related `edits`), `item_name`, `old_price`, `new_price`,
`reason` Char(200), `edited_by` FK → StaffMember (`SET_NULL`), `at` auto.
Ordered by `at`. Rendered on receipts ("edited" badge) and the dashboard.

### 5.8 `StaffInvite` — owner-issued signup links

| Field | Notes |
|---|---|
| `business`, `name`, `staff_pin` | The PIN the staff member must enter (stored as a peppered hash) |
| `code` | Char(12) unique — the secret in `/app?invite=<code>` |
| `created_by_pin` | Owner PIN hash at issuance (audit context) |
| `used`, `used_at` | Flipped on acceptance; revocation marks unused invites used |

### 5.9 `StaffSession` — revocable device sessions

`business`, `staff`, `token_hash` (SHA-256 hex, unique — raw token is never stored),
`created_at`, `revoked_at` (null = active). Removing a staff member revokes all
their sessions.

### 5.10 `MpesaPayment` — append-only plan-payment ledger

**Constraints:** partial-unique `uniq_mpesapayment_receipt` (non-blank receipts are
single-use platform-wide) + unique `checkout_request_id`.

| Field | Notes |
|---|---|
| `business`, `plan` | Both `PROTECT` |
| `cycle` | `monthly` \| `annual` |
| `amount` | KSh actually charged |
| `phone` | `2547XXXXXXXX`; literal `'scanned'` for Paybill redemptions |
| `status` | `pending` `success` `failed` `cancelled` `timeout` |
| `checkout_request_id` | Char(64) unique; `SCAN-<receipt>` for redemptions |
| `merchant_request_id` | From Daraja |
| `mpesa_receipt` | e.g. `SJ84K2ABCD`; uniqueness enforced in application logic (§10.4) |
| `result_desc` | Error/failure description (≤255) |
| `extends_until` | Subscription end this payment granted |
| `created_at`, `completed_at` | |

### 5.11 `AuditEvent` — the immutable trail

`bill` (FK, `CASCADE`, related `events`), `type` ∈
`created edited scanned verified disputed paid voided refunded`,
`detail` Char(255), `at` auto. Ordered by `at`. Never edited or deleted by any code
path. **Note:** FK is `CASCADE` on bill deletion — bills are never deleted in
application code, but this matters for test cleanup (`e2e_test.sh` purges
dependents first because financial FKs are `PROTECT`).

### 5.12 Entity-relationship summary

```
Plan 1──* Business 1──* StaffMember 1──* StaffSession
              │  1──* Service
              │  1──* StaffInvite
              │  1──* MpesaPayment *──1 Plan
              └──1──* Bill 1──* BillItem
                         1──* BillEdit
                         1──* AuditEvent
```

---

## 6. Bill Lifecycle & Business Rules

### 6.1 State machine

```
                    create (total > 0)
        ┌────────────────────────────────────────► pending ──── voided (owner)
        │                                             │
 draft ─┤                                             ├── verify (customer) ──► approved
        │                                             │         + payment_method   │
        │  create (total == 0)                        ├── dispute (customer) ──► disputed
        └────────► draft (no QR in practice)          │                            │
                                                      │                            ▼ pay
                                                      │                          paid ──── refund ──► refunded
                                                      └── voided (owner)
```

Transitions and their guards (all enforced server-side in `core/views.py`):

| Transition | Actor | Guard | Failure |
|---|---|---|---|
| → `pending` (create) | staff/operator | Active subscription; monthly verified-bill cap not reached | 402 |
| → `draft` (create) | staff/operator | All items priced at 0 / total 0 | — |
| pending → `approved` | customer | Payment method chosen (`M-Pesa`/`Cash`/`Card`); cap; subscription | 400 / 402 |
| pending → `disputed` | customer | `note` recorded | — |
| pending/`*` → edit | staff/operator | **Only while `pending`** | 409 "no longer be edited" |
| approved → `paid` | staff/operator | Status exactly `approved` | 409 (pay-before-verify, double-pay, disputed) |
| (not paid/refunded) → `voided` | owner PIN | Status not in `paid`/`refunded` | 409 "must be refunded" |
| paid → `refunded` | (endpoint reserved) | — | — |

### 6.2 Hard rules (spec-critical)

1. **Pay before approval: blocked (409).** `pay_bill` rejects `pending` with
   *"Customer has not verified this bill yet"* and `disputed` with *"resolve with the
   customer first"*.
2. **Edit after approval: blocked (409).** `edit_bill` only touches `pending` bills;
   the message instructs *void it and create a new one*. Every accepted price change
   writes a `BillEdit` row **and** an `edited` audit event with
   `before → after (reason)`. Recomputed totals update the bill.
3. **Void a paid bill: blocked (409).** Refund flow instead. Double-pay: blocked.
4. **Caps enforced twice** — at `create_bill` (pending bills are free to create) and
   again at `verify_bill` (the moment a bill consumes the monthly quota), so raising
   a plan's cap never lets a salon over-verify mid-month.
5. **Verified bills count by `approved_at` month** (`status in ['approved','paid']`),
   in business-local time.
6. **Scan-payment receipts are once-only platform-wide** — a receipt code can settle
   either a subscription *or* a bill, never both, and never twice (§10.4).

---

## 7. Audit Trail

`AuditEvent` rows are written by `audit(bill, type, detail)` in `core/serializers.py`.

| Event | When | Detail format |
|---|---|---|
| `created` | Bill created | `KSh {total} — served by {staff}` |
| `edited` | Price change on pending bill | `{item}: KSh {old} → KSh {new} ({reason})` — reason omitted ⇒ `(no reason given)` |
| `scanned` | Customer opens `/v/{code}` | `Customer opened the bill` (suppressed by `X-SP-NoScan: 1`) |
| `verified` | Customer approves | `Customer {name} verified the bill` |
| `disputed` | Customer disputes | The customer's note |
| `paid` | Payment recorded | `KSh {total} recorded — {method}` or `… paid via scan-to-pay — receipt {code}` |
| `voided` | Owner voids | Owner-supplied reason |
| `refunded` | Refund flow | — |

**Consumers:** owner dashboard audit feed (latest 25 across the business), per-bill
timeline (`/api/bills/{code}/audit/`), bill serializer `events` array (shown on
receipts), platform-admin recent events (latest 30 platform-wide).

**No row is ever mutated or deleted** — the "accountability lives here" guarantee.

---

## 8. Authentication & Security Model

### 8.1 Headers

| Header | Meaning | Sent by |
|---|---|---|
| `X-SP-Business` | Tenant slug — required by every business-scoped endpoint | All app pages |
| `X-SP-PIN` | Owner PIN | Owner pages (dashboard, void, branding, invites, billing, settings) |
| `X-SP-Staff-Token` | Raw staff session token (SHA-256-hashed server-side) | Staff app |
| `X-SP-Public-Origin` | Browser origin, honored for QR base URL **only** if it matches `CORS_ALLOWED_ORIGINS` | Frontend automatically |
| `X-SP-NoScan` | `1` suppresses the `scanned` audit event | Staff re-fetching their own bill |
| `X-SP-Admin-Key` | Platform admin key | Admin console |

### 8.2 Auth functions (`core/views.py`)

- `get_business(request)` — resolves `X-SP-Business`; 400 if missing/unknown.
- `require_owner_pin(request, biz)` — constant-time check against the peppered
  PIN hash (`core/pins.py`), with per-business lockout after 10 failed attempts
  (5 min). Legacy plaintext rows verify once, then upgrade in place; 401 otherwise.
- `require_operator(request, biz)` — owner PIN (same hashing/lockout) **or** an
  active `StaffSession` (lookup by `sha256(token)`, `revoked_at IS NULL`); returns
  the `StaffMember` for staff. Both paths also require an active subscription
  (402 when expired).
- `require_active_subscription(biz)` — 402 with upgrade messaging when expired.
- `require_admin_key(request)` — constant-time compare of `X-SP-Admin-Key` vs
  `settings.ADMIN_KEY`; **fails closed** (401) when the setting is empty, which it
  always is in production unless the env var is set (crash at startup otherwise).

### 8.2.1 Rate limiting (`core/throttle.py`)

Cache-backed counters (LocMem in dev; point `CACHES` at Redis in production for
cross-process counts). Only failures count; success resets.

| Bucket | Identity | Limit | Lockout |
|---|---|---|---|
| `login` | identifier (owner-login) | 10 fails / 5 min | 5 min → 429 |
| `pin` | business slug (PIN-gated endpoints) | 10 fails / 5 min | 5 min → 429 |
| `signup` | client IP | 20 / hour | 15 min → 429 |
| `bill_code` | client IP (public bill lookup misses) | 120 / 5 min | 5 min → 429 |

### 8.2.2 Concurrency guards

- **M-Pesa settlement** — callback and poll both take `select_for_update()` on the
  `MpesaPayment` row inside `transaction.atomic()`; whoever locks first settles,
  the loser observes a non-pending status. Duplicate deliveries are no-ops.
- **Bill transitions** — `verify/pay/void/edit/redeem-bill` run under
  `select_for_update()` on the bill; verify additionally locks the business row
  (consistent bill→business order) so the monthly verified-bills cap is exact.
- **Receipt redemption** — pre-check plus partial-unique DB constraints
  (`uniq_mpesapayment_receipt`, `uniq_bill_payment_ref`); a lost race raises 409
  from the `IntegrityError`, never double-spends.

### 8.3 Access matrix

| Action | Customer | Staff | Owner | Platform admin |
|---|---|---|---|---|
| View/verify/dispute a bill by code | ✅ (public) | — | — | — |
| Look up a receipt | ✅ (public) | — | — | — |
| Create/edit bills, record pay, scan-to-pay | — | ✅ (token) | ✅ (PIN) | — |
| Dashboard, analytics, audit per bill | — | — | ✅ (PIN) | — |
| Void bills | — | — | ✅ (PIN) | — |
| Branding, services, staff add/remove, invites | — | — | ✅ (PIN) | — |
| STK payment, status, history, receipt redemption | — | — | ✅ (PIN) | — |
| Platform overview / directory / payments / tenant edits | — | — | — | ✅ (admin key) |

### 8.4 Security posture

**In place:**

- Staff session tokens stored only as SHA-256 hashes; raw token shown once at invite
  acceptance and kept in `localStorage`.
- Revocation model: removing staff clears their PIN, revokes sessions, and burns
  their pending invites — historical bills/audit rows are preserved (`PROTECT` FK).
- Production hardening (`DEBUG=0`): `SECURE_SSL_REDIRECT`, HSTS 1 year (+subdomains),
  secure cookies, `X_FRAME_OPTIONS=DENY`, nosniff, strict referrer policy,
  `SECURE_PROXY_SSL_HEADER` for Render's TLS termination.
- M-Pesa callback: optional `?token=` shared-secret gate; amount-mismatch rejection;
  unknown checkout IDs ignored (logged, 200 to Daraja).
- Logo uploads: content-type allowlist (PNG/JPG/WebP), 5 MB byte cap / 7 MB
  data-URL cap, base64 validation.
- CORS restricted to an explicit origin list; the QR base URL only honors a caller
  origin that appears in that same list.

**Previously open, now fixed:** PINs are hashed (peppered PBKDF2-SHA256,
120k iterations, lazy legacy upgrade + data migration 0014); rate limiting on
login/PIN/signup/bill-lookup; `ADMIN_KEY` fails closed when `DEBUG=0`; bill and
invite codes use `secrets`; settlement paths are row-locked.

**Remaining:** the cross-table receipt pre-check (`_receipt_taken`) has a tiny
request-wide race between the two tables — same-table races are blocked by the
partial-unique constraints.

### 8.5 Owner login resolution (`/api/owner-login/`)

The owner app needs a slug before it can send `X-SP-Business`. `owner_login` accepts:

1. slug or business name (case-insensitive exact match), else
2. phone number (digits normalized to `254…`) matched against `Business.phone`.

Exactly one business must match **and** the PIN must match that business — otherwise
401 *"Invalid username or phone number and PIN"*. Response: `{slug, name}`.

---

## 9. Subscriptions, Plans & Trials

### 9.1 Lifecycle

```
signup ──► trial (7 days, auto) ──► expired ──► (M-Pesa payment) ──► paid (30/365 days)
                                        ▲                              │
                                        └────────── lapses ◄───────────┘
```

- `Business.save()` starts the trial automatically on creation.
- `subscription_info()` computes state/days_left/reminder; `reminder` is true in the
  final 5 days (frontend shows a banner).
- Expired businesses get **402** on: bill creation, verification, staff adds,
  service adds, invite creation — with the message *"Pay your plan via M-Pesa to keep
  verifying bills (Owner dashboard → Billing)."*

### 9.2 Plans (seeded by `seed_plans`)

| Plan | KSh/mo | KSh/yr | Verified bills/mo | Staff |
|---|---|---|---|---|
| Starter | 299 | 2,990 | 200 | 4 |
| Growth ⭐ | 499 | 4,990 | 500 | 8 |
| Business | 799 | 7,990 | 1,000 | 15 |
| Pro | 1,299 | 12,990 | 2,000 | 25 |

The API floors `max_staff` at 2 (`max(2, plan.max_staff)`) and counts
*managed* staff (`staff_pin != ''`) plus unused invites against the cap, so revoked
staff and burned invites don't consume seats.

### 9.3 Granting time

`_settle_success` extends from `max(now, current plan_paid_until)`:
**+30 days** monthly, **+365 days** annual (flat-day arithmetic — no calendar drift;
the unused `_add_months` helper exists but is not called). `_grant` also switches the
business to the paid plan, enabling immediate plan upgrades.

---

## 10. M-Pesa Integration (Daraja)

`core/mpesa.py` — stdlib-only client (`urllib`), no extra dependencies.

### 10.1 Module internals

- **`_http_json`** — JSON POST/GET with 15 s timeout; structured logging of endpoint,
  status and response keys; `HTTPError` bodies captured (≤300 chars) into
  `DarajaError`; network failures → `DarajaError("Daraja unreachable: …")`.
- **`access_token()`** — OAuth client-credentials, cached module-level
  (`_token_cache`) with a `threading.Lock` against stampedes; expiry set 60 s early.
  Raises `DarajaError` when key/secret are unset.
- **`_password()`** — base64(shortcode + passkey + `YYYYMMDDHHMMSS` timestamp), per
  Daraja STK spec.
- **`normalize_phone`** — accepts `07…`, `01…`, `2547…`, `+2547…`, 9-digit; returns
  `2547XXXXXXXX`/`2541XXXXXXXX`; rejects non-Safaricom prefixes.

### 10.2 STK push (`stk_push`)

POST `/mpesa/stkpush/v1/processrequest` with:

| Field | Value |
|---|---|
| `TransactionType` | `CustomerBuyGoodsOnline` (Till) — env-configurable |
| `PartyB` | `MPESA_TILL_NUMBER` (default 4567052) |
| `Amount` | plan price for the chosen cycle |
| `AccountReference` | business slug, truncated to 12 chars (Daraja limit) |
| `TransactionDesc` | `SaloonOS {plan} {cycle}`, truncated to 13 chars |
| `CallBackURL` | `MPESA_CALLBACK_URL` |

Non-zero `ResponseCode` → `DarajaError(errorMessage)`. Simulation mode
(`MPESA_SIMULATE=1`, default when `DEBUG=1`) skips the network entirely and returns a
synthetic `SIM-<msisdn>-<ts>` checkout ID.

### 10.3 Settlement — two independent paths

1. **Callback (authoritative):** `POST/GET /api/mpesa/callback/`
   - Parses Daraja's `Body.stkCallback` envelope; extracts `CheckoutRequestID`,
     `ResultCode`, metadata items (`MpesaReceiptNumber`, `Amount`).
   - Optional token gate; unknown checkout IDs ack'd and ignored.
   - `ResultCode 0`: **amount mismatch** (callback `Amount` ≠ stored) ⇒ payment
     `failed` with an explicit `result_desc`; else stores the receipt and settles.
   - Non-zero: `_settle_failure` maps `1032 → cancelled`, `1037 → timeout`, everything
     else `failed`; `2029` gets a customer-friendly explanation appended.
   - Always replies `{ResultCode: 0, ResultDesc: 'Accepted'}` so Daraja doesn't retry.
2. **Polling (`/api/mpesa/status/<id>/`):** owner-driven; calls `stk_query`.
   - `ResultCode '0'` ⇒ settle success.
   - Daraja `errorCode 500.001.1001` ("transaction is being processed") ⇒ still pending.
   - Other failures only settle after a **30-second grace** (`STK_QUERY_FAILURE_GRACE_SECONDS`)
     so a callback arriving late wins the race.
   - In simulation mode polling returns `PENDING` forever (frontend shows the
     simulated banner; the demo "paid" state is set via the UI message).

Both paths converge on `_settle_success` / `_settle_failure`; a pending payment is
never settled twice *by status check* (`if pay.status == 'pending'`), but see §22
regarding concurrent transactions.

### 10.4 Scan-payment redemption (Paybill stickers that bypass STK)

Owners and staff can pay without STK: the customer/owner pays the till manually,
then someone types the M-Pesa receipt code from the confirmation SMS.

- **`POST /api/mpesa/redeem-plan/`** (owner PIN) — extends the subscription.
  Validates receipt format `^[A-Z0-9]{8,15}$`, cycle, and that the receipt was never
  used (checked against **both** `MpesaPayment.mpesa_receipt` and
  `Bill.payment_ref` platform-wide). Creates a `MpesaPayment` with
  `checkout_request_id="SCAN-<receipt>"`, `phone='scanned'`, then settles instantly.
- **`POST /api/mpesa/redeem-bill/`** (operator) — marks an **approved** bill `paid`
  with `payment_method='M-Pesa scan'` and `payment_ref=<receipt>`, audited as
  `paid … via scan-to-pay`.

`_receipt_taken()` provides the once-only guarantee; `409` *"That M-Pesa receipt has
already been used."* on reuse.

### 10.5 Observability

Every Daraja interaction logs a tagged line (`mpesa_token_obtained`,
`mpesa_stk_accepted`, `mpesa_stk_rejected`, `mpesa_callback_received`,
`mpesa_callback_amount_mismatch`, `mpesa_status_query_failed`, …) with sensitive
values reduced to suffixes (phone last-4, receipt/checkout last-10). Never log full
credentials or phone numbers.

---

## 11. API Reference

Base URL: `/api` (proxied through Next.js in dev/prod). All bodies and responses are
JSON. Trailing slashes are optional (`re_path(r'…/?$')`) — the Next rewrite strips
them and APPEND_SLASH redirects are deliberately avoided (they would convert POSTs
to GETs).

**Standard error shapes:**
- `{ "error": "human message" }` (400/404/409 paths returning `Response`)
- DRF `{"detail": "…"}` from `APIException` subclasses:
  - 400 `Invalid`, 401 `Unauthorized`, 402 `PaymentRequired`, 409 `Conflict`.
- 502 from `mpesa_stk` when Daraja fails.

### 11.1 Public

| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| 1 | `/api/plans/` | GET | none | All pricing tiers |
| 2 | `/api/signup/` | POST | none | Create business + 7-day trial. Body: `name, phone, plan_code, owner_pin(4+)`. 201 → `{name, slug, …}` |
| 3 | `/api/owner-login/` | POST | none | Resolve identifier (slug/name/phone) + PIN → `{slug, name}` |
| 4 | `/api/bills/{code}/` | GET | none | Public bill fetch. Audits `scanned` when status is `pending` (unless `X-SP-NoScan`). With a business header it scopes to that business; without, code alone resolves |
| 5 | `/api/bills/{code}/verify/` | POST | none (customer) | Approve (`payment_method` required) or dispute (`note`). Guards: pending-only (409), subscription (402), cap (402) |
| 6 | `/api/mpesa/callback/` | POST/GET | token opt. | Daraja settlement (§10.3) |

### 11.2 Catalog & setup (owner PIN unless noted)

| # | Endpoint | Method | Purpose |
|---|---|---|---|
| 7 | `/api/catalog/` | GET | Business + subscription + services + staff (any business header; used by staff app) |
| 8 | `/api/branding/` | POST | Update `tagline/phone/location/accent/thank_you/logo_data_url`. Accent allowlist; logo validated + uploaded to R2 (§13); same-logo no-op |
| 9 | `/api/services/add/` | POST | Upsert a service (name + price). 402 if expired |
| 10 | `/api/staff/add/` | POST | Add staff. 402 on cap (`managed staff + unused invites ≥ max(2, max_staff)`) |
| 11 | `/api/staff/{id}/remove/` | POST | Revoke: clears PIN, kills sessions, burns invites; history kept |
| 12 | `/api/invites/create/` | POST | Create invite → `{code, url, name}`; enforces staff cap (402) |
| 13 | `/api/invites/accept/` | POST | Staff accepts `code` + `staff_pin` → `{business, staff, token}`. Burns invite; enforces cap (402); creates session |

### 11.3 Bills (operator = staff token or owner PIN)

| # | Endpoint | Method | Purpose |
|---|---|---|---|
| 14 | `/api/bills/` | POST | Create bill → `pending` (or `draft` if total 0). Guards: subscription, monthly cap. 201 |
| 15 | `/api/bills/{code}/edit/` | POST | Price changes `{staff_id, reason, changes:[{item_id,new_price}]}`; logs `BillEdit` + audit; recomputes total. 409 unless pending |
| 16 | `/api/bills/{code}/pay/` | POST | approved → paid; `{method}` defaults `M-Pesa`. 409 on pending/disputed/double-pay |
| 17 | `/api/bills/{code}/void/` | POST | Owner PIN only. 409 for paid/refunded |
| 18 | `/api/bills/{code}/audit/` | GET | Owner: full bill + events timeline |

### 11.4 Owner dashboard & analytics (owner PIN)

| # | Endpoint | Purpose |
|---|---|---|
| 19 | `/api/dashboard/` | Today's aggregates (recorded/verified/expected/collected/unverified/disputed), variance, yesterday's collected, plan usage, subscription, audit feed (25), today's bills w/ items + edits |
| 20 | `/api/analytics/` | 14-day revenue trend, this-vs-last-month + MoM %, staff leaderboard, top services, verification funnel, status donut (§21) |

### 11.5 Billing / M-Pesa (owner PIN)

| # | Endpoint | Purpose |
|---|---|---|
| 21 | `/api/mpesa/stk/` | Initiate STK push (`phone, cycle, plan_code`). Creates pending payment; 502 on Daraja failure; requires `MPESA_CALLBACK_URL` unless simulating |
| 22 | `/api/mpesa/status/{id}/` | Poll + settle (§10.3) |
| 23 | `/api/mpesa/history/` | Last 20 payments + subscription |
| 24 | `/api/mpesa/redeem-plan/` | Paybill-sticker subscription redemption (§10.4) |
| 25 | `/api/mpesa/redeem-bill/` | Scan-to-pay bill settlement (§10.4) |

### 11.6 Platform admin (`X-SP-Admin-Key`)

| # | Endpoint | Purpose |
|---|---|---|
| 26 | `/api/platform-admin/overview/` | Tenant counts by subscription state, MRR, bill totals, GMV, verification rate, 30 recent audit events |
| 27 | `/api/platform-admin/businesses/` | Full tenant directory — owner PINs are **not** returned (hashed server-side since the PIN-harding fix); admin can reset a PIN but never read one |
| 28 | `/api/platform-admin/businesses/{slug}/` | Mutations: `trial_days_add`, `paid_days_add`, `plan_code`, `owner_pin` (reset only — stored hashed), `name` |
| 29 | `/api/platform-admin/payments/` | Last 100 M-Pesa payments platform-wide |

### 11.7 Misc

- `GET/HEAD /` → `{ok: true, service: 'saloonos-api'}` — health probe (also
  `healthCheckPath`-friendly; Render blueprint uses `/api/plans`).

### 11.8 Serializer notes

- `BillSerializer` embeds: items (id/name/price), edits (with timestamps), events,
  `business` branding subset, and **both** `qr_data_url` and `verify_url`.
- `make_qr_data_url` builds `{PUBLIC_BASE_URL}/v/{code}?b={slug}`, QR error
  correction **H** (30%), box 10, border 2, salon logo composited dead-center on a
  white tile (failure to composite is silently ignored).
- `settings_public_base_url` prefers the browser origin when it is in
  `CORS_ALLOWED_ORIGINS` — so LAN demos produce scannable LAN QRs while production
  QRs always point at the canonical domain.

---

## 12. Frontend Application

### 12.1 Routing & rendering

All pages are client components (`"use client"`); Next.js provides the shell.
`next.config.ts` rewrites `/api/:path*` → `API_ORIGIN` (default
`http://127.0.0.1:8000`, injected at **build time** in Docker/Render) and disables
trailing-slash redirects.

### 12.2 Pages

| Route | File | Who | What |
|---|---|---|---|
| `/` | `app/page.tsx` | everyone | Landing (logo, value prop, CTA) |
| `/pricing` | `pricing/page.tsx` | everyone | 4 plans, annual toggle, feature lists |
| `/signup` | `signup/page.tsx` | owner | Name/phone/plan/PIN → creates trial workspace |
| `/app` | `app/page.tsx` | staff | Invite accept (`?invite=CODE`) → catalog → build bill (service picker) → QR → **live poll for verification** → record payment / scan-to-pay |
| `/v/[code]` | `v/[code]/page.tsx` | customer | Bill view → choose M-Pesa/Cash/Card → animated confirm → approve/dispute → receipt |
| `/r/[code]` | `r/[code]/page.tsx` | anyone | Receipt-authenticity lookup + M-Pesa trust strip |
| `/owner` | `owner/page.tsx` | owner | Login (identifier+PIN) → today's numbers, variance, leaks, analytics, staff mgmt, void, audit feed |
| `/pay` | `pay/page.tsx` | owner | Billing: subscription card, plan picker (monthly/annual), STK push with polling, payment history, receipt redemption, M-Pesa QR sticker |
| `/settings` | `settings/page.tsx` | owner | Branding form + live preview; service catalog CRUD |
| `/admin-dash` | `admin-dash/page.tsx` | platform | Admin key → overview, tenant directory, tenant mutations, payments ledger |
| `/terms`, `/privacy` | | everyone | Legal (contract-acceptance language) |

### 12.3 API client (`lib/api.ts`)

- One `req<T>()` wrapper: sets `Content-Type` + `X-SP-Public-Origin`; retries up to
  3 attempts with linear backoff on **502/503/504** (Render cold starts); maps
  error JSON (`error`/`detail`) to thrown `Error`s with friendly copy
  ("The service is waking up…").
- ~25 typed endpoint functions mirroring §11; full TS types for every payload.
- `store` — `localStorage` accessors: `sp_slug`, `sp_pin`, `sp_staff_token`.
- `operatorHeaders(slug)` — staff token when present, else owner PIN; consumed by
  all operator endpoints.

### 12.4 Shared components

- `receipt.tsx` — the receipt renderer used by `/v`, `/r`, and the staff app;
  print stylesheet prints the receipt only (no chrome). Shows verification badge,
  edits, payment method/ref.
- `mpesa.tsx` — `MpesaTrustStrip`, `MpesaScanTile`, Safaricom branding.
- `loading-state.tsx` — `BrandLoader`, `VerificationSeal` (customer-verification
  animation).
- `app-chrome.tsx` / `logout-button.tsx` / `icons.tsx` — chrome and icons.
- `globals.css` — Tailwind v4 theme tokens (accents, cards, receipt print rules,
  M-Pesa sticker styles).

---

## 13. Image Storage (Cloudflare R2)

`core/storage.py` — `store_logo(data_url, business_slug)`:

1. If R2 isn't configured (`R2_BUCKET_NAME` empty) → return the data URL unchanged
   (inline storage; Postgres holds it).
2. Else: split the data URL, require `data:image/{png,jpeg,webp}`, base64-validate,
   enforce 5 MB, upload to `logos/{slug}/{uuid}.{ext}` with
   `CacheControl: public, max-age=31536000, immutable`, and return
   `{R2_PUBLIC_URL}/{key}`.
3. Any failure → `ImageStorageError` → 400 *"Could not save the logo to Cloudflare
   storage"* (or the specific validation message).

`R2_PUBLIC_URL` must be a public bucket domain — receipts and QRs embed the URL
directly. Existing inline logos keep working until replaced.

---

## 14. Configuration Reference (All Environment Variables)

### Backend (Django) — `config/settings.py`

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | dev-only value | Django secret. **Must** be random in prod |
| `ADMIN_KEY` | empty; dev default only when `DEBUG=1` | Platform-admin key. **Required when `DEBUG=0`** — startup crashes without it (fail-closed) |
| `PIN_PEPPER` | falls back to `SECRET_KEY` | Server-side pepper for PIN hashes (`core/pins.py`). Set a distinct random value in prod; treat as a credential |
| `DEBUG` | `1` (dev) | `0` in prod; drives SSL/HSTS/cookie flags and the DB config requirement |
| `ALLOWED_HOSTS` | `*` | Comma-separated; set your domain in prod |
| `DATABASE_URL` | — | `postgres://` or `sqlite://` URL; parsed by `_db_from_url` (URL-unquotes user/pass; forces `sslmode=require` off-host) |
| `DB_NAME / DB_USER / DB_PASSWORD / DB_HOST / DB_PORT` | `serviceproof / serviceproof / sp_dev_2026 / 127.0.0.1 / 5432` | Individual-parts DB config when `DEBUG=1` and no URL |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Also gates the `X-SP-Public-Origin` QR override |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | **Encoded into every QR** — must be the public frontend URL |
| `R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_PUBLIC_URL` | empty | §13 |
| `MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET` | empty | Daraja app credentials |
| `MPESA_PASSKEY` | empty | Shortcode passkey |
| `MPESA_SHORTCODE` | empty | Paybill/shortcode |
| `MPESA_TILL_NUMBER` | `4567052` | PartyB for Buy Goods |
| `MPESA_TRANSACTION_TYPE` | `CustomerBuyGoodsOnline` | |
| `MPESA_ENVIRONMENT` | `sandbox` | `production` switches the API base |
| `MPESA_CALLBACK_URL` | auto from `RENDER_EXTERNAL_URL` | Daraja callback; required unless simulating |
| `MPESA_CALLBACK_TOKEN` | empty | Optional `?token=` gate for the callback |
| `MPESA_SIMULATE` | `1` iff `DEBUG` else `0` | Skips real Daraja calls |
| `RENDER_EXTERNAL_URL` | — | Provided by Render; derives the callback URL |

### Frontend (Next.js)

| Variable | Default | Purpose |
|---|---|---|
| `API_ORIGIN` | `http://127.0.0.1:8000` | Rewrite target; **baked in at build time** |

### Fixed settings worth knowing

`TIME_ZONE=Africa/Nairobi`, `USE_TZ=True`, WhiteNoise compressed manifest storage,
`DEFAULT_AUTO_FIELD=BigAutoField`, JSON-only DRF renderers/parsers, CORS allow-list
for the `x-sp-*` headers, security headers per §8.4.

---

## 15. Local Development

### 15.1 First-time setup

```bash
# 1. Database (option a: local Postgres matching the defaults)
createdb serviceproof && psql -c "CREATE USER serviceproof PASSWORD 'sp_dev_2026';" && \
  psql -c "GRANT ALL PRIVILEGES ON DATABASE serviceproof TO serviceproof;"

#    (option b: Docker — DB only)
docker compose up -d db

# 2. Python env
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. Migrate + seed
.venv/bin/python manage.py migrate
.venv/bin/python seed_demo.py          # or: manage.py seed_plans for tiers only

# 4. Frontend deps
cd frontend && npm install && cd ..
```

### 15.2 Running

```bash
./start-django.sh        # or: .venv/bin/python manage.py runserver 127.0.0.1:8000
./start-next.sh          # or: cd frontend && npx next dev -p 3000
```

Open **http://localhost:3000**. The frontend proxies `/api/*` to Django.

### 15.3 Simulation mode

With defaults (`DEBUG=1`), `MPESA_SIMULATE=1`: the STK flow runs end-to-end without
Daraja keys; pushes return synthetic IDs and polls report `PENDING`. Use the receipt
redemption flow (§10.4) to simulate successful subscription payments locally, or set
real sandbox credentials to exercise the true settlement paths.

### 15.4 Phone testing on the LAN

```bash
ip -4 addr show | grep inet        # find 192.168.x.x
PUBLIC_BASE_URL=http://192.168.x.x:3000 ./start-next.sh
```

Staff opens `http://192.168.x.x:3000/app`; customers scan real QRs. Private LAN
addresses are exempt from browser secure-context (camera) rules.

### 15.5 Docker (full stack)

```bash
docker compose up -d --build        # db + api (:8000 internal) + web (:3000)
docker compose exec api python seed_demo.py
```

`Dockerfile.api` runs `collectstatic` at build and `migrate` + gunicorn at start.
`Dockerfile.web` bakes `API_ORIGIN` (build ARG) into the Next build.

---

## 16. Seeding & Demo Data

### 16.1 `manage.py seed_plans` — production-safe

Idempotent upsert of the 4 tiers. Runs in every Render build.

### 16.2 `seed_demo.py` — demo only, never in production

Creates **XYZ Salon** (`xyz-salon`, owner PIN `2026`, Growth plan, paid until +30 days):

- Staff: Jane, Alice, Brian (manager). Services: Braiding 2,500 · Treatment 800 ·
  Hair wash 300 · Haircut 500 · Shave 200 · Manicure 700.
- **Yesterday:** three clean paid bills (`8F72KQ`, `K2M9PD`, `T4X8RB`).
- **Today — the deliberate "leak" stories:**
  - `Q7W3ZN` (Mary / Jane): created 3,600 → Braiding edited to 2,000
    ("Customer discount") → total 3,100 → **verified but unpaid** (the leak).
  - `M5J8VC` (Faith / Brian): pending (1,000).
  - `B9N4KD` (Grace / Alice): **disputed** — "Customer says the shave was not done."
- Every bill carries a hand-written audit trail matching the seeded state.

**Re-running re-dates the demo bills to today** (shifting `created_at`,
`approved_at`, `paid_at`, and audit timestamps) so the owner dashboard always demos
well. It prints `Demo data refreshed to today.` and exits.

---

## 17. Deployment

Full step-by-step guides live in `DEPLOY.md`; this section is the system view.

### 17.1 Topology

Three components: **Postgres**, **Django API** (gunicorn), **Next.js web** (proxy).
All config is env-driven (§14). The two variables that break prod if wrong:
`PUBLIC_BASE_URL` (QRs!) and `API_ORIGIN` (build-time proxy target).

### 17.2 Option A — Render (free web services) + Supabase Postgres

- Create the Supabase DB first; copy the **Session pooler** URI (port **5432**, not
  the transaction pooler 6543 — migrations need a session connection); URL-encode
  special characters in the password.
- Create two Render web services **manually** (no Blueprint, no card):
  - `saloonos-api` — Python 3.12.7, build: `pip install -r requirements.txt &&
    collectstatic && migrate && seed_plans`, start: gunicorn
    `--workers 2 --threads 4 --timeout 30`, health check `/api/plans`, env: DB URL,
    `SECRET_KEY` (generated), `DEBUG=0`, `ALLOWED_HOSTS=.onrender.com`,
    `PUBLIC_BASE_URL=https://saloonos-web.onrender.com`, CORS, R2 vars.
  - `saloonos-web` — Node 22.14.0, root `frontend`,
    `npm install && npm run build` / `npm start`, `API_ORIGIN=https://saloonos-api.onrender.com`.
- Renaming a service ⇒ redeploy the frontend (build-time `API_ORIGIN`).
- Free-tier caveats: API sleeps after 15 min idle (~50 s cold start — the client
  retries 502/503/504 and UptimeRobot pings keep it warm); Supabase pauses after ~7
  idle days; take nightly `pg_dump`s before onboarding paying salons.

### 17.3 Option B — Docker on any VM

```bash
docker compose up -d --build
# nginx/Caddy for HTTPS → proxy to :3000; certbot for TLS
# then set PUBLIC_BASE_URL=https://app.yourdomain.co.ke and re-up
```

**QRs only scan over HTTPS (or LAN IPs)** — plain-HTTP public URLs are blocked by
phone camera policies.

### 17.4 Production checklist

- [ ] `SECRET_KEY` long + random; `DEBUG=0`
- [ ] `ALLOWED_HOSTS` = your domain (not `*`)
- [ ] `ADMIN_KEY` set (startup **fails closed** without it when `DEBUG=0`)
- [ ] `PIN_PEPPER` set to a distinct random value (changing it later invalidates all PIN hashes)
- [ ] `PUBLIC_BASE_URL` = public `https://` frontend URL
- [ ] `DATABASE_URL` reachable (Supabase session pooler or managed PG)
- [ ] M-Pesa credentials set; `MPESA_ENVIRONMENT=production`; `MPESA_SIMULATE` unset;
      `MPESA_CALLBACK_TOKEN` set and registered with the callback URL
- [ ] `seed_demo.py` **not** run against production data
- [ ] `e2e_test.sh` (retargeted) passes against the deployment
- [ ] Postgres backups scheduled

---

## 18. Testing

### 18.1 End-to-end suite — `e2e_test.sh` (19 checks)

Requires **both servers running** (exercises the Next proxy: `B=http://localhost:3000/api`).
Self-cleaning: purges `e2esalon*` businesses (dependents first — financial FKs are
`PROTECT`) before and after.

```bash
./e2e_test.sh       # prints ✓/✗ per check; exits 1 on any failure
```

| # | Check |
|---|---|
| 1 | Signup returns a slug |
| 2 | Catalog shows seeded staff (the script uses Starter's Jane/Mercy/Fatuma seeding via staff-add) |
| 3–4 | Staff cap: 3 adds, the 5th blocked with 402 "Upgrade" |
| 5 | Bill created `pending` |
| 6 | Pay-before-verify blocked ("not verified") |
| 7–8 | Edit while pending logs reason and updates total (2,500−500+300=2,300) |
| 9 | Edit after approval blocked ("no longer be edited") |
| 10 | Pay after approval → `paid` |
| 11 | Double-pay blocked ("Bill is paid") |
| 12 | Void paid blocked ("refunded") |
| 13 | Wrong owner PIN rejected (401) |
| 14–16 | Dashboard: variance 0, audit feed contains `created` and `edited` |
| 17 | Verified-bill cap: shrinking the cap to 1 blocks a 2nd verification (402) |
| 18–19 | QR is a `data:image/png;base64` URL pointing at `/v/{code}` |

The cap test temporarily re-points the business at a throwaway `cap-test` plan and
deletes it afterwards.

### 18.2 Unit tests — `core/tests.py` (35 tests)

Full Django suite covering the money-critical paths; runs on SQLite so it can
never touch a hosted database:

```bash
DATABASE_URL=sqlite:///dev-test.db python manage.py test core
```

| Group | Covers |
|---|---|
| `PinToolsTest` | hash/verify round-trip, pepper sensitivity, legacy plaintext verify-only |
| `SignupAndLoginTest` | signup hashes PINs, lazy upgrade on login, 10-strike lockout (429), case-insensitive identifier |
| `BillLifecycleTest` | draft fallback, verify→pay, no re-pay/re-verify, dispute flow, void guards, edit-window guard |
| `PlanCapTest` | 402 at cap on verify, 402 when expired, voided bills don't count toward the cap |
| `MpesaSettlementTest` | callback success/extension, duplicate-callback no-op, amount mismatch, cancelled, poll settle under lock, 30 s grace, callback token gate |
| `ReceiptRedemptionTest` | plan redemption once, bill redemption once, receipt shared across ledger/bills, not-verifiable-before-approval |
| `StaffInviteTest` | invite accept hashes staff PIN, token works, wrong PIN 401 |
| `PlatformAdminTest` | fail-closed admin key, wrong key 401, no PIN in directory, hashed PIN reset, paid-day extension |
| `CodeGenerationTest` | `gen_code` shape (6 chars, `[A-Z0-9]`) |

---

## 19. Migrations

`core/migrations/` — 0001 … 0014, all applied, none pending:

| Migration | Content |
|---|---|
| 0001_initial | Plan, Business, StaffMember, Service, Bill, BillItem, BillEdit, AuditEvent |
| 0002–0003 | MpesaPayment ledger + indexes/constraints |
| 0004_staffinvite | StaffInvite (+ `created_by_pin`) |
| 0005–0008 | StaffSession, subscription fields, branding fields, scan-payment fields |
| 0009_business_logo_default | `logo_data_url` default '' |
| 0010_staff_pins | `staff_pin` on StaffMember (empty ⇒ revoked) |
| 0011_bill_customer_phone | `customer_phone` on Bill |
| 0012 | `AuditEvent.bill` → `PROTECT`; partial-unique `payment_ref` (Bill) and `mpesa_receipt` (MpesaPayment) |
| 0013 | PIN columns widened Char(8) → Char(255) for hashed values |
| 0014 | Data migration: hashes every existing plaintext PIN in place |

Model ↔ migration state is consistent (`makemigrations --check` clean). The e2e
suite and tests use SQLite via `DATABASE_URL`-style parsing or the DEBUG Postgres
defaults.

---

## 20. Platform Admin (Master Management & Monitoring)

Four endpoints under `/api/platform-admin/*`, all gated by `X-SP-Admin-Key`
(§11.6). The frontend console is `/admin-dash`.

- **Overview** — businesses by subscription state, MRR (Σ monthly price of paid
  tenants), bill totals + GMV + verification rate, 30 newest audit events
  platform-wide (with business/bill/staff attribution).
- **Directory** — every tenant with plan, subscription, staff/bill counts,
  disputed counts, collected revenue, branding fields. PINs are never included
  (hashes aren't reversible); use the reset action instead.
- **Tenant mutations** — extend trial (`trial_days_add`), extend paid period
  (`paid_days_add`, stacking from the later of now/current end), switch plan,
  reset owner PIN (≥4 digits), rename. Responses return fresh subscription state.
- **Payments** — global M-Pesa ledger (last 100) with receipt, status, cycle, amounts.

Operational use: comp time for support, plan changes for enterprise deals, PIN
resets for locked-out owners.

---

## 21. Analytics & Metrics

### 21.1 Owner dashboard (`/api/dashboard/`)

Today (business-local) excluding drafts:

| Metric | Definition |
|---|---|
| `recorded` | Bills created today |
| `verified` | Approved + paid + disputed today |
| `expected` | Σ totals (all today's non-draft bills) |
| `collected` | Σ totals where `paid` |
| `variance` | expected − collected (the leak number) |
| `unverified` / `disputed` | Σ totals by status |
| `yesterday_collected` | Comparison figure |
| `plan_usage` | `{verified_bills, cap, remaining}` for the month |
| `audit_feed` | Latest 25 events (code, type, detail, at, staff) |
| `bills` | Today's bills with items + edits + `was_edited` flag |

### 21.2 Analytics (`/api/analytics/`)

- **14-day trend** — daily paid revenue (`F('paid_at__date')` aggregation).
- **Month-over-month** — this vs last month collected + % change (None when last
  month is 0).
- **Staff leaderboard** — this month per staff: bills created, collected Σ,
  verified count, verify-rate %.
- **Top services** — this month's paid-bill items by revenue (top 6, with counts).
- **Funnel** — created → verified (incl. disputed) → paid this month.
- **Status donut** — counts by status this month.
- Plus `subscription` for banner state.

### 21.3 Frontend rendering

`/owner` renders these with pure CSS/SVG (no chart library); `/admin-dash` renders
platform metrics similarly.

---

## 22. Known Limitations & Risk Register

Updated after the hardening pass — R-1 through R-6 and R-9/R-10 are **fixed**.
Remaining items, ordered by severity:

| # | Risk | Detail | Recommendation |
|---|---|---|---|
| R-7 (open) | **Dashboard `expected` semantics** | Includes voided/refunded totals, so variance can look bad through no staff fault. | Exclude `voided`/`refunded` from `expected`, or split into `lost` vs `pending`. |
| R-8 (partial) | **`views.py` monolith** | Dead code removed (`_add_months`, duplicate `per_day`), but the file is still ~1,200 lines. | Split into `bills.py` / `mpesa.py` / `admin.py` modules. |
| R-11 (mitigated) | **Bill-code enumeration** | Codes are 6-char `secrets`-generated; public lookups now rate-limit misses per IP (120 / 5 min). Residual risk is low. | Keep an eye on lockout logs; lengthen codes if abuse appears. |
| R-12 | **Free-tier durability** | Render sleeps; Supabase pauses; backups are manual. | UptimeRobot ping; nightly `pg_dump` cron before paying customers. |
| R-13 (new) | **Throttle store is per-process** | `core/throttle.py` uses the default cache; LocMem in dev means counters aren't shared across gunicorn workers. | Point `CACHES` at Redis/memcached in production. |
| R-14 (new) | **`PIN_PEPPER` defaults to `SECRET_KEY`** | Acceptable (both are secrets), but rotating `SECRET_KEY` then invalidates every PIN hash. | Set a distinct `PIN_PEPPER` in prod so the two rotate independently. |

### 22.1 Fixed in the hardening pass (for the record)

| # | Was | Now |
|---|---|---|
| R-1 | No unit tests | 35-test Django suite (`core/tests.py`): lifecycle, caps, settlement, redemption, auth, throttling |
| R-2 | Plaintext PINs everywhere | Peppered PBKDF2-SHA256 hashes (`core/pins.py`), lazy legacy upgrade + data migration 0014; admin directory no longer returns PINs |
| R-3 | No rate limiting | Cache-backed throttles on owner-login, PIN endpoints, signup, and public bill lookups (§8.2.1) |
| R-4 | `ADMIN_KEY` default in prod | Fails closed: required env when `DEBUG=0` (startup crash otherwise); constant-time compare |
| R-5 | Settlement race callback ↔ poll | `select_for_update()` row locks around all settlement and bill transitions (§8.2.2) |
| R-6 | `random.choices` codes | `secrets.choice` for bill and invite codes |
| R-9 | Audit FK CASCADE | `AuditEvent.bill` is `PROTECT` |
| R-10 | Repo hygiene | `.freebuff/` + `tsconfig.tsbuildinfo` gitignored; `.env.example` documents `ADMIN_KEY`/`PIN_PEPPER` |

---

## 23. Operations Runbook

### 23.1 Health & probes

- `GET /` → `{"ok": true, "service": "saloonos-api"}` (lightweight, unauthenticated).
- `GET /api/plans` — Render health check (proves DB + seed).

### 23.2 Common tasks

```bash
# Redeploy with migrations (Render build does this automatically)
python manage.py migrate --noinput && python manage.py collectstatic --noinput

# Re-seed pricing after a change to the tier definitions
python manage.py seed_plans

# Refresh demo dates (demo environments only!)
python seed_demo.py

# Inspect a bill's full trail
python manage.py shell -c "from core.models import *; [print(e.at, e.type, e.detail) for e in AuditEvent.objects.filter(bill__code='Q7W3ZN')]"
```

### 23.3 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| QRs don't scan / open wrong host | `PUBLIC_BASE_URL` wrong or HTTP on a public domain | Set the public HTTPS frontend URL; redeploy |
| Every request 401 "Invalid owner PIN" | Wrong business slug header or PIN | Verify `X-SP-Business` + PIN; check `owner-login` |
| 402 on bill create/verify | Trial/paid period expired or monthly cap hit | Owner → Billing → pay; or admin `paid_days_add` |
| STK push 502 | Daraja creds/env/callback misconfigured | Check logs for `mpesa_initiate_failed`; verify `MPESA_CALLBACK_URL` reachable and `MPESA_ENVIRONMENT` |
| Payment stuck "pending" | Callback never arrived | Poll settles via `stk_query` (30 s failure grace); check callback token and Render URL |
| Frontend 502/504 then works | Render free cold start | Expected; client auto-retries; add a pinger |
| Migration failure on deploy | DB unreachable or transaction-pooler URL used | Use session pooler (5432); verify `DATABASE_URL` |
| `DisallowedHost` | `ALLOWED_HOSTS` missing the domain | Add it |

### 23.4 Data protection posture

- Bills, edits, audit events, and M-Pesa payments are append-only/`PROTECT`-guarded.
- Staff removal is a revocation, not a deletion.
- Log lines redact phone/receipt/checkout values to suffixes.
- No PII beyond names/phones; receipts are reachable by code — treat codes as
  capability URLs.

---

## 24. Glossary

| Term | Meaning |
|---|---|
| **Bill code** | 6-char public reference (`Q7W3ZN`) identifying a bill in QRs and URLs |
| **Verified / approved** | Customer confirmed the bill's services+prices on their phone |
| **Leak** | A verified-but-unpaid bill — revenue the salon agreed to but hasn't collected |
| **Variance** | Expected − collected revenue for a day |
| **STK push** | Lipa na M-Pesa Online — a payment prompt sent to the payer's phone |
| **Daraja** | Safaricom's developer API platform |
| **CheckoutRequestID** | Daraja's ID for one STK push; the key for callbacks/queries |
| **Receipt code** | M-Pesa confirmation code (e.g. `SJ84K2ABCD`) — once-only redemption key |
| **Scan-to-pay** | Customer pays the till via the M-Pesa app QR sticker; staff redeem the receipt code |
| **Redemption** | Trading a receipt code for subscription time or bill payment |
| **Operator** | Owner (PIN) or active staff session — anyone who can act on bills |
| **Session pooler** | Supabase's port-5432 Postgres proxy required for Django migrations |
| **Cap** | Plan limits: staff seats and monthly verified bills (HTTP 402 when hit) |

---

*Document generated from source inspection of the repository at commit `d725f47`
("Update documentation and legal terms"). Paths and behaviours reflect the code as
written; where documentation and code could drift, the code is authoritative.*
