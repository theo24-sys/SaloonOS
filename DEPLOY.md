# Deploying SaloonOS

Three components: **PostgreSQL** (database), **Django API** (gunicorn), **Next.js frontend**
(proxies `/api/*` to Django so the whole product lives on **one domain** — the setup the spec recommends).

All config is environment-driven — see `.env.example` for every variable.
The two that actually matter in production:

| Variable | Where | Why |
|---|---|---|
| `PUBLIC_BASE_URL` | API | Encoded into every QR code. Set it to your public **frontend** URL (`https://…`) or customers can't scan. |
| `API_ORIGIN` | Frontend (build time) | Where the Next.js proxy sends `/api/*` requests. |

---

## Option A — Render (free web services) + Supabase (free Postgres) — no credit card

Render's blueprint wants its **own** managed database (paid, card required). The trick:
bring the database from **Supabase** (free tier, no card, no expiry) and keep Render for
just the two web services, which are free and card-less. The repo's `render.yaml` is
already set up this way.

### Step 1 — Free Postgres on Supabase
1. Sign up at **supabase.com** (GitHub login works) → **New project** → pick any name +
   region close to your users (e.g. `eu-central` for Kenya latency) → set a **database
   password** (save it).
2. When the project is ready: **Connect** (top bar) → choose **Session pooler** → copy the
   URI. It looks like:
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
3. Replace `[YOUR-PASSWORD]` with the password from step 1. **Use the Session pooler
   (port 5432), not the Transaction pooler (6543)** — Django needs a session connection
   for migrations. If your password has special characters (`@ : / # ?`), URL-encode them
   (e.g. `@` → `%40`) — the app unquotes them automatically.

### Step 2 — Render blueprint (the two web services)
1. Sign up at **render.com** (no card needed) → **New → Blueprint** → pick this repo
   (`theo24-sys/SaloonOS`). Render reads `render.yaml` and creates:
   - `saloonos-api` — Django under gunicorn (migrate + collectstatic on every deploy)
   - `saloonos-web` — Next.js, proxying `/api/*` to the API service
2. When prompted, paste the **Supabase connection string** as `DATABASE_URL`.
   For `PUBLIC_BASE_URL` enter `https://saloonos-web.onrender.com` (the default web URL;
   you can correct it later if Render picks a different name).
3. Deploy. First build takes ~5 min. The API health check (`/api/plans`) turns green when
   the database connection works.

### Step 3 — Verify & seed (optional)
1. Open `https://saloonos-web.onrender.com` — landing page loads.
2. Demo data (skip for a real deployment): Render → `saloonos-api` → **Shell** →
   `python seed_demo.py`, then log into the dashboard with owner PIN **2026**.

**Free-plan caveats (honest list):**
- Render free services **sleep after 15 min idle**; the next request takes ~50 s to wake.
  For a salon this is fine (staff open the app all day), but a customer scanning a QR at
  8 pm after 3 idle hours will stare at a spinner briefly. A free pinger
  (UptimeRobot → GET `/api/plans` every 10 min) keeps it awake at zero cost.
- Supabase free projects **pause after ~7 days of no activity** — one click in the
  dashboard to restore. Real salon traffic prevents this.
- Supabase free storage is 0.5 GB ≈ hundreds of thousands of bills — fine for years.
- Financial records on free tiers: before onboarding paying salons, take a nightly
  `pg_dump` (Supabase dashboard backups or a cron) so a platform hiccup never eats a ledger.

## Option B — Docker on any VM (DigitalOcean/Kenyan VPS)

```bash
# on the server
git clone <your repo> && cd serviceproof-dj
docker compose up -d --build          # db + api (gunicorn) + web (next start)
docker compose exec api python seed_demo.py   # optional demo data
```

App is on port 3000. Put nginx or Caddy in front for HTTPS:

```nginx
server {
    server_name app.yourdomain.co.ke;
    location / {
        proxy_pass http://127.0.0.1:3000;   # Next.js (which proxies /api to Django)
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d app.yourdomain.co.ke
```

Then set `PUBLIC_BASE_URL=https://app.yourdomain.co.ke` in `docker-compose.yml` (api service)
and `docker compose up -d` again. **QR codes only work over HTTPS or LAN IPs on modern phones —
plain HTTP public URLs get blocked by Chrome/Safari camera policies.**

## Option C — LAN demo today (no deployment)

For the 30-second salon pitch from a laptop:

```bash
# find your LAN IP
ip -4 addr show | grep inet
# start everything with QRs pointing at your machine
PUBLIC_BASE_URL=http://192.168.x.x:3000 ./start-next.sh
```

Staff opens `http://192.168.x.x:3000/app`, customer's phone scans the real QR —
works with no accounts, no deployment, no HTTPS (private LAN addresses are exempt
from the secure-context rule).

---

## Checklist for any deployment

- [ ] `SECRET_KEY` set to a long random value, `DEBUG=0`
- [ ] `ALLOWED_HOSTS` = your domain (not `*`)
- [ ] `PUBLIC_BASE_URL` = public `https://` frontend URL (QRs!)
- [ ] Postgres reachable (hosted `DATABASE_URL` or the `DB_*` parts)
- [ ] `seed_demo.py` NOT run on production data
- [ ] Run `e2e_test.sh` against the deployed URL once (edit `B=` at the top) — all 19 checks
- [ ] Postgres backups on (Supabase: dashboard → Database → Backups, or scheduled `pg_dump`)

## What's intentionally not deployed yet (per spec)

Redis, Celery, WhatsApp/SMS notifications, M-Pesa Daraja, staff auth beyond the owner PIN —
the "don't build yet" list. The env-driven settings above leave room for all of them.
