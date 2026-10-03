# RingFlow

Real-time karate tournament floor management and scoring. RingFlow builds the draws, spreads
categories across tatamis, scores every bout at the table, drives the arena scoreboards, and tells
athletes and parents where and when they compete. At the end it produces an official record of the
event.

It is built for WKF karate and for school and grassroots events (it ships a CISCE category preset)
at venues where the internet is unreliable. The same build runs on an offline venue network or on a
hosted server.

## What it does

- **Kumite scoring pad** for the table official: Yuko, Waza-ari, Ippon, senshu, category 1 and 2
  penalties, and decisions by points, hantei, kiken, hansoku or shikkaku.
- **Authoritative match clock** with millisecond precision, kept on the server and corrected for
  drift on every screen.
- **Arena scoreboards** for each tatami, fullscreen on a TV, for kumite and kata.
- **Draw and bracket engine**: single elimination with byes, seeding, club separation, repechage and
  bronze options, an Official or organiser's rules profile, hand swaps, pools split across tatamis, and automatic advancement when a result is confirmed.
- **Kata** with pool flights and medal bouts or a knockout bracket, scored by flags or by marks.
  Judges vote from their own phones, or the moderator enters marks at the desk. Totals are computed
  on the server.
- **Ring balancing**: drag categories onto tatamis and order each queue, with bout counts and
  estimated finish times.
- **Staging**: marshals mark categories calling and ready, and optionally mark athletes present or
  absent.
- **Public portal**: spectators and athletes follow every tatami and search by name or chest number
  with no login.
- **Official record**: an append-only audit log of who did what, admin-only result corrections with
  a mandatory reason, and CSV and PDF exports. Draw-sheet PDFs are staff only.
- **Role-based access** for six kinds of user, enforced in every server action.

## Roles

Full rules: [docs/roles/README.md](docs/roles/README.md).

| Role | Entry point | How they get in | What they do |
|---|---|---|---|
| [Admin](docs/roles/admin.md) | `/login/admin` | Email and password | Owns an event: setup, draws, balancing, approvals, dashboard, corrections, exports |
| [Organiser](docs/roles/organiser.md) | `/login/organiser` | Event code, admin approval | Read-only view of one event |
| [Stager](docs/roles/stager.md) | `/login/stager` | Stager code, admin approval | Call area: calling and ready status, optional attendance. In a Local tournament, builds and locks each category's groups at the stager desk |
| [Moderator](docs/roles/moderator.md) | `/login/mod` | Tatami code, admin approval | Runs one tatami's queue and scores its bouts |
| [Judge](docs/roles/judge.md) | `/judge/ring/[ringId]` | QR or PIN and a seat, moderator approval | Votes on kata from a phone |
| [Public and scoreboard](docs/roles/public.md) | `/`, `/public/event/[id]`, `/scoreboard/[ringId]` | None | Follow the event live |

## Documentation

| Document | Contents |
|---|---|
| [QUICKSTART.md](QUICKSTART.md) | Run it locally with demo data and try each role |
| [OFFLINE_VENUE_GUIDE.md](OFFLINE_VENUE_GUIDE.md) | Set up a server on an air-gapped venue network |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | LAN, hybrid and hosted deployment, environment variables |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, layout, request flow, realtime, data model, limitations |
| [docs/DISCIPLINES.md](docs/DISCIPLINES.md) | How kumite and kata are scored, drawn and advanced |
| [docs/roles/](docs/roles/README.md) | Who can do what, per role |
| [PRD.md](PRD.md) | Product requirements and the event lifecycle |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow and conventions |
| [AGENTS.md](../AGENTS.md) | Engineering guide for working in the code (also for AI agents) |
| [db/migrations/README.md](db/migrations/README.md) | How the database is created and upgraded |
| [tests/http/README.md](tests/http/README.md) | The integration test suites |

## Tech stack

Next.js 16 (App Router, Server Actions), React 19, TypeScript, Tailwind CSS v4, PostgreSQL 16 with
Drizzle ORM, Server-Sent Events over Postgres `LISTEN/NOTIFY`, `pdf-lib`, `xlsx`, `zod`, vitest.

## Commands

```bash
npm run dev           # development server on 0.0.0.0:3000
npm run build         # production build
npm run start         # run the production build
npm run lint          # ESLint
npm test              # unit tests
npm run db:push       # create or update tables from the schema
npm run db:migrate    # apply SQL migrations (safe to repeat)
npm run db:bootstrap  # apply base schema SQL and migrations without drizzle-kit
npm run db:seed       # demo tournament, plus a small Local demo (development only)
npm run db:mock-local # a full-day Local event: 3 tatamis, 15 categories, 105 children (development only)
npm run db:reset      # wipe and reseed (development only)
npm run db:create-admin -- --email=director@example.org --password='...' --name="Tournament Director"
```

## Running in production

Docker (Node 22 Alpine, Next standalone output):

```bash
docker build -t ringflow:latest .
docker run -d --name ringflow-app -p 3000:3000 \
  -e DATABASE_URL="postgres://user:pass@db-host:5432/ringflow" \
  -e APP_URL="https://ringflow.example.org" \
  -e TRUST_PROXY="true" \
  ringflow:latest
```

Or without Docker: `npm ci && npm run build && npm run start`, optionally under PM2. Environment
variables, hybrid mode with a judge tunnel, and reverse-proxy notes are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
