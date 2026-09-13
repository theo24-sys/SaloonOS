# Deploying ServiceProof

Three components: **PostgreSQL** (database), **Django API** (gunicorn), **Next.js frontend**
(proxies `/api/*` to Django so the whole product lives on **one domain** — the setup the spec recommends).

All config is environment-driven — see `.env.example` for every variable.
The two that actually matter in production:

| Variable | Where | Why |
|---|---|---|
| `PUBLIC_BASE_URL` | API | Encoded into every QR code. Set it to your public **frontend** URL (`https://…`) or customers can't scan. |
| `API_ORIGIN` | Frontend (build time) | Where the Next.js proxy sends `/api/*` requests. |

---

## Option A — Render (recommended: free-ish, one click)

The repo ships a blueprint (`render.yaml`) that creates all three services wired together.

1. Push this folder to a GitHub repo.
2. Render dashboard → **New → Blueprint** → pick the repo. Render reads `render.yaml` and creates:
   - `serviceproof-db` — managed Postgres
   - `serviceproof-api` — Django under gunicorn (migrate + collectstatic on every deploy)
   - `serviceproof-web` — Next.js, proxying `/api/*` to the API service
3. On the `serviceproof-api` service → **Environment**, set:
   - `PUBLIC_BASE_URL` = `https://serviceproof-web.onrender.com` (your web service URL)
   - `CORS_ALLOWED_ORIGINS` = same URL (harmless; same-origin anyway)
4. **Manual deploy → Deploy** once more so the new env vars land.
5. Seed demo data (API service → **Shell**): `python seed_demo.py`
   (skip on a real deployment — you don't want the XYZ Salon demo business in production).
6. Open `https://serviceproof-web.onrender.com` — done.

**Free-plan caveats:** the free Postgres expires after 30 days (upgrade to keep data — it's
financial records, don't run a real salon on an expiring DB), free services sleep after
15 min of inactivity (first scan after idle takes ~30s to wake), and Render's free
instances need the paid `basic-256mb` DB in the blueprint.

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
- [ ] Postgres backups on (Render managed DBs: automatic; VM: `pg_dump` cron)

## What's intentionally not deployed yet (per spec)

Redis, Celery, WhatsApp/SMS notifications, M-Pesa Daraja, staff auth beyond the owner PIN —
the "don't build yet" list. The env-driven settings above leave room for all of them.
