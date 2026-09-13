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

Render's blueprint flow steers you toward its **own** managed database (paid, card
required) — so skip Blueprint entirely. Bring the database from **Supabase** (free tier,
no card, no expiry) and create the two Render web services **by hand**, which is free and
card-less.

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

### Step 2 — Create the two web services manually (no Blueprint)

**Service 1 — API (create this one first):**
1. Render dashboard → **New → Web Service** → connect GitHub → pick `theo24-sys/SaloonOS`.
2. Fill in:
   - **Name:** `saloonos-api`
   - **Language:** Python 3
   - **Region:** Frankfurt (closest free region to Kenya)
   - **Instance Type:** Free
   - **Root Directory:** *(leave blank)*
   - **Build Command:**
     ```
     pip install -r requirements.txt && python manage.py collectstatic --noinput && python manage.py migrate --noinput
     ```
   - **Start Command:**
     ```
     gunicorn config.wsgi:application --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 30
     ```
3. **Advanced → Add Environment Variable**, add all of these:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase session-pooler string from Step 1 |
   | `SECRET_KEY` | click **Generate** |
   | `DEBUG` | `0` |
   | `PYTHON_VERSION` | `3.12.7` |
   | `ALLOWED_HOSTS` | `.onrender.com` |
   | `PUBLIC_BASE_URL` | `https://saloonos-web.onrender.com` |
   | `CORS_ALLOWED_ORIGINS` | `https://saloonos-web.onrender.com` |

4. Also under **Advanced → Health Check Path**: `/api/plans`.
5. **Create Web Service.** First build ≈ 5 min; it turns Live when the DB connection works.

**Service 2 — Frontend:**
1. **New → Web Service** again → same repo.
2. Fill in:
   - **Name:** `saloonos-web`
   - **Language:** Node
   - **Instance Type:** Free
   - **Root Directory:** `frontend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
3. **Advanced → Add Environment Variable**:

   | Key | Value |
   |---|---|
   | `API_ORIGIN` | `https://saloonos-api.onrender.com` |
   | `NODE_VERSION` | `22.14.0` |

4. **Create Web Service.**

> `API_ORIGIN` is read at **build time** — if you ever rename a service, re-trigger a
> deploy of the frontend so the new URL gets baked into the API proxy.

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
