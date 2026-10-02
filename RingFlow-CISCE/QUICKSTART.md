# Quickstart: run RingFlow locally

Set up RingFlow on your machine, load a demo championship, and try every role. This setup is for
development. For a real event see [OFFLINE_VENUE_GUIDE.md](OFFLINE_VENUE_GUIDE.md) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Prerequisites

- Node.js 22 or newer (`node -v`)
- Docker Desktop, or a local PostgreSQL 16

## Setup

Run these in the `RingFlow-CISCE` folder.

```bash
npm install
cp .env.example .env.local
docker compose up -d db
npm run db:push
npm run db:migrate
npm run db:seed
npm run dev
```

Then open <http://localhost:3000>.

- `.env.example` points `DATABASE_URL` at `127.0.0.1:5432` with user and password `event_suite` and
  database `ringflow`, which matches `docker-compose.yml`.
- If PostgreSQL runs inside WSL2 and the app runs on Windows, use the WSL or container IP in
  `DATABASE_URL`.
- `npm run db:push` creates the tables from `src/db/schema/index.ts`. `npm run db:migrate` applies
  the SQL migrations (triggers, audit log, judge sessions, constraints) and is safe to repeat.
- To run the production build instead: `npm run build && npm run start`.

## What the seed creates

| Item | Value |
|---|---|
| Admin | `admin@ringflow.org`, password `admin123` |
| Tournament | CISCE National Karate Championship 2026 |
| Organiser code | `ORG001` |
| Tatamis | Tatami 1 to 4, access codes `RING01` to `RING04` |
| Categories and athletes | Under-14 boys and girls, kata and kumite entries, chest numbers 101 and up |
| Draws | Generated for every category |
| Moderator session | One approved session for Tatami 1 (a browser still has to hold its token, so sign in through `/login/mod` as below) |

These credentials exist for development only. Never run the seed against a real event database.
`npm run db:reset` wipes the data and reseeds. `npm run db:create-admin` creates a real admin.

## Guided tour

Open several browser windows or profiles, one per role. Each role keeps its own cookie, but one
browser profile can hold several roles at once.

### 1. Admin

1. Go to `/login/admin` and sign in with the seeded account.
2. Open the tournament. The dashboard shows each tatami's status, current bout and activity.
3. Open **Rings** then **Ring balance** to drag categories between tatamis and order each queue.
4. Moderator, stager and organiser requests appear here for approval.

### 2. Moderator and scoreboard

1. Go to `/login/mod`, enter `RING01` and a name. The request waits for approval.
2. In the admin window, approve it from the dashboard widget.
3. The moderator opens the queue, starts a category, and picks a bout on the **Current** screen.
4. Open `/scoreboard/<ringId>` in another window. The moderator's tatami (and the admin) may open
   it; the ring id is in the moderator URL. Press F11 for fullscreen.
5. Try the pad: start the clock, add Yuko, Waza-ari and Ippon points, set senshu, add category 1 and
   2 penalties, swap sides, then confirm a result with a decision. The bracket advances and the
   scoreboard updates without a reload.

### 3. Kata and judge phones

1. As admin, set a kata category to the scoring mode you want (flag or points) and generate its draw.
2. As moderator, start that kata category and open a bout. The kata pad has a **Judge phones** panel
   with a QR code and PIN.
3. Open the link on a phone (or another browser) at phone size, enter a name and a seat, and approve
   it on the moderator pad.
4. Open voting, vote from the phone, close voting, then finalize. You can also type marks or flags at
   the desk without any phone.

### 4. Organiser and stager

- Organiser: `/login/organiser`, code `ORG001`. Approve the request as admin. The organiser sees the
  dashboard, roster, categories, ring balance and the official record, all read only.
- Stager: the seed creates no stager codes. As admin, generate them on the Rings page, then sign in at
  `/login/stager`, approve, and mark categories calling or ready.

### 5. Public view

Open `/`, pick the tournament, and search for an athlete by name (for example `Ananya`) or chest
number (`101`). Brackets for everyone appear only if "show draws publicly" is on in the event
settings; an athlete's own bracket always opens from search.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server on `0.0.0.0:3000` |
| `npm run build` | Production build (also type-checks; see the known type errors in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (vitest) |
| `npm run db:push` | Apply the schema with drizzle-kit |
| `npm run db:migrate` | Apply the SQL migrations in `db/migrations` |
| `npm run db:bootstrap` | Apply the base schema SQL and the migrations directly, without drizzle-kit (`scripts/bootstrap-db.ts`) |
| `npm run db:seed` | Load the demo tournament |
| `npm run db:reset` | Wipe and reseed |
| `npm run db:create-admin` | Create or update an admin account |

## Troubleshooting

- **Cannot connect to the database**: check `docker compose ps`, and that `DATABASE_URL` matches the
  host and port you are running.
- **Port 3000 or 5432 in use**: change the port mapping in `docker-compose.yml` and `DATABASE_URL`,
  or run `npx next dev -p 3001`.
- **No bell sound**: browsers block audio until you interact. Click the page once.
- **Opening the app from another device in development**: Next blocks dev assets from unknown
  origins. Add your address to `allowedDevOrigins` in `next.config.ts` (private ranges are already
  listed), then use `http://<your-ip>:3000`.
