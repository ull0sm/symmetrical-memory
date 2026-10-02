# Deploying RingFlow

The same build runs in three ways. Pick the one that matches the venue.

| Mode | Who reaches the server | Typical setup |
|---|---|---|
| **LAN (offline)** | Devices on the venue Wi-Fi only | Laptop/VM on the venue router, `OFFLINE_MODE=true`. Step by step: [OFFLINE_VENUE_GUIDE.md](../OFFLINE_VENUE_GUIDE.md). |
| **Hybrid** | Staff on the LAN; judge phones over the internet | LAN install plus a tunnel (Cloudflare Tunnel / ngrok) that exposes only `/judge` and the public live feed. |
| **Hosted (online)** | Everyone, over HTTPS | One container plus PostgreSQL behind a reverse proxy. |

## Environment
Checked at start-up by `src/lib/env.ts`. A wrong value stops the server with a message naming
the variable. Template: [.env.example](../.env.example).

| Variable | Needed | Meaning |
|---|---|---|
| `DATABASE_URL` | always | `postgres://user:pass@host:5432/ringflow`. There is no default, so a missing value never falls back to some other database. |
| `OFFLINE_MODE` | LAN | `true` turns off everything external (Turnstile, the cdnjs PDF viewer). |
| `APP_URL` | hosted | Public base URL, e.g. `https://ringflow.example.org`. Judge QR codes use it, unless an event has its own tunnel URL. |
| `TRUST_PROXY` | behind a proxy | `true` when a reverse proxy appends the client address to `X-Forwarded-For`. Rate limits then use that address. |
| `FRAME_ANCESTORS` | optional | Who may frame `/scoreboard` and `/public` (OBS, venue displays). CSP syntax. Default `'self'`. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | optional online | Cloudflare Turnstile on the staff code-entry forms. Set both, or both to `disabled`. |

## Database
```bash
npm run db:push      # tables from src/db/schema (drizzle-kit)
npm run db:migrate   # SQL migrations 8+ (triggers, audit log, judge sessions); safe to re-run
npm run db:create-admin -- --email=director@example.org --password='...' --name="Tournament Director"
```
Run both `db:push` and `db:migrate` after every upgrade. Scripts read `.env.local` and `.env` the
same way the app does. A variable set on the command line wins.

## Hosted (online)
1. Build the image (`Dockerfile`, Next standalone output) or run `npm run build && npm run start`.
   The build doesn't need a database.
2. Put it behind a TLS reverse proxy (Caddy, nginx, Cloudflare). Forward `X-Forwarded-Proto` and
   `X-Forwarded-For`, and set `TRUST_PROXY=true`.
3. Set `APP_URL` to the public HTTPS address. Leave `OFFLINE_MODE` unset.
4. Turn off response buffering for `/api/live` and `/api/live/staff` (Server-Sent Events). In
   nginx that's `proxy_buffering off;`. The app already sends `X-Accel-Buffering: no`.
5. Run a single app instance. The live feed fans out through Postgres `LISTEN/NOTIFY`, so several
   instances would still see each other's changes. But the login rate limits are kept in memory
   per process, and with several instances each one would allow the full budget. A shared store
   comes before scaling out.

## Hybrid (LAN + tunnel for judges)
- Run the LAN install, then start a tunnel to it. Tunnel hosts (`judge.*`, `*.trycloudflare.com`,
  `*.ngrok-free.app`, `*.loca.lt`) can reach only `/judge/*`, the public `/api/live` feed and static
  assets. Everything else gets 403, and that includes `/api/live/staff`.
- Paste the tunnel URL into the event's **Settings → Tunnel URL**. Judge QR codes then point at it.
- The tunnel block is a convenience. Every page and action still checks its own session.

## What the server sends to browsers
- **Security headers** (`src/lib/http/securityHeaders.ts`, applied in `src/proxy.ts` per request):
  a same-origin CSP (online mode also allows Turnstile and cdnjs), `frame-ancestors 'none'` and
  `X-Frame-Options: DENY` everywhere except `/scoreboard` and `/public`, `nosniff`, a referrer
  policy, a permissions policy, and HSTS on HTTPS requests only, so plain-HTTP LAN installs keep working.
- **Cookies**: httpOnly and `SameSite=Lax`. `Secure` is decided per request from the actual protocol
  (`X-Forwarded-Proto`), so the same install works over LAN HTTP and hosted HTTPS.
- **Live feeds**: `/api/live` is public (scoreboards, spectators, judge phones, waiting rooms) and
  carries ids and status only, for public tables. `/api/live/staff` returns 401 unless the caller is
  staff for the scope, and adds the event log and access requests.

## Not supported yet
- Syncing an offline venue database with an online one (PLAN 5.6). For now an event runs on one
  database: the venue laptop or the hosted server.
- Several app instances (see the rate-limit note above).
