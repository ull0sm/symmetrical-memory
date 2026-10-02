# Architecture

How RingFlow is put together. For who may do what, see [roles/](roles/README.md). For running it,
see [DEPLOYMENT.md](DEPLOYMENT.md).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions, standalone output), React 19, TypeScript |
| Styling | Tailwind CSS v4, design tokens in `src/app/globals.css` (design notes in `frontend-design/DESIGN.md`) |
| Database | PostgreSQL 16 through Drizzle ORM |
| Realtime | Server-Sent Events fed by Postgres `LISTEN/NOTIFY` and an in-process event bus |
| Documents | `pdf-lib` for draw sheets and the results PDF, `xlsx` for roster import |
| Validation | `zod` |
| Bot protection | Cloudflare Turnstile on staff code entry, optional and off in offline mode |

There is no external auth provider and no runtime call to any third-party service, which is what
lets the same build run on an air-gapped venue network.

## Layout

```
RingFlow-CISCE/
  src/
    actions/       Server actions: the only entry points a browser can call
    app/           Routes, one folder per role (admin, organiser, stager, moderator, judge,
                   public, scoreboard) plus /api/live and /api/category-docs
    components/    React components, grouped by role or feature
    db/schema/     The whole database schema in one file (index.ts)
    engine/        Pure engines with unit tests: draw-engine and rules-engine
    hooks/         Client hooks (live events, match clock, fallback polling)
    lib/           Auth, audit, realtime, kata tally, draws, PDFs, rate limiting, env
    proxy.ts       Request gate and security headers
  db/migrations/   Generated base schema plus hand-written SQL migrations
  scripts/         Database and seeding scripts
  tests/http/      Integration suites that call actions over HTTP
  docs/            This documentation
  frontend-design/ Design system notes and static screen mockups
```

## Request flow

1. The browser calls a server action (a form post or a client call).
2. The action's first line is a guard from `src/lib/auth/guards.ts`. The guard reads the session
   cookies, re-verifies the identity against the database and checks the target row's tournament
   (and tatami). It throws `AuthError` if the caller is not allowed.
3. The action validates its input (`src/lib/validation.ts`, zod), then reads or writes through Drizzle.
4. A write calls `audit(...)` (official record), `broadcastLiveEvent(...)` (screens) and
   `revalidatePath(...)` (server-rendered pages).
5. Screens that subscribed through `useLiveEvents` refetch through their own guarded actions.

The request gate in `src/proxy.ts` (`src/lib/http/requestGate.ts`) runs before this. It blocks
non-judge paths on tunnel hosts and redirects browsers with no session cookie to the right login
page. It is a convenience, not a security boundary: every page and action checks for itself.

## Authentication

| Role | How it signs in |
|---|---|
| Admin | Email and password. A random token goes in a cookie and its SHA-256 hash in `admin_sessions` |
| Organiser, stager, moderator | An access code creates a request. The admin approves it. The browser that asked, and only that one, collects the session token |
| Judge | The tatami QR link or PIN plus a seat creates a request. The moderator approves it |
| Public, scoreboard | No sign-in. Read-only, governed by the tournament's public toggles |

Requests carry a claim cookie, whose hash is stored with the request, so a request ID alone is
worthless. Session tokens are stored only as hashes. Details and lifetimes are in
[roles/README.md](roles/README.md).

## Realtime

- `src/lib/realtime/bus.ts` keeps one `LISTEN ringflow_events` connection per server process and
  fans notifications out to subscribers. Database triggers (`migration8_realtime_notify.sql`) raise
  the notifications for the tables live screens read. Actions also call `broadcastLiveEvent` so the
  change reaches screens without waiting for the database round trip.
- `/api/live` is the public feed (spectators, scoreboards, judge phones, waiting rooms). It carries
  ids and status for a fixed list of public tables.
- `/api/live/staff` is the staff feed. It returns 401 unless the caller is staff for the requested
  scope, and it adds the event log and access requests.
- A connection must name a scope (tournament, tatami, category or request). A connection with no
  scope receives nothing. A waiting room only hears its own request's status.
- Events never carry tokens, PINs or session data.
- Screens fall back to slow polling (`useFallbackPoll`, 15 seconds) only while their stream is down,
  and refetch once on reconnect.

## Data model

The schema is `src/db/schema/index.ts`. Status columns also have `CHECK` constraints; the allowed
values live in `src/lib/statuses.ts` and a unit test keeps the schema, that file and migration 14
in step.

| Group | Tables |
|---|---|
| Accounts and sessions | `admins`, `admin_sessions`, `organiser_requests`, `stager_requests`, `moderator_requests`, `judge_sessions` |
| Event setup | `tournaments`, `rings` (tatamis), `categories`, `category_assignments` (queue and status per tatami), `tournament_category_definitions`, `category_documents` |
| People | `athletes`, `tournament_registrations`, `category_entries`, `category_attendance` |
| Draws | `draws`, `draw_versions` (the full graph as JSON), `matches`, `match_slots`, `match_events` |
| Kata | `kata_scores` (one row per judge seat and side), kata columns on `categories` and `matches` |
| Records | `audit_log` (append-only), `event_log` (operational feed) |

Notes:

- An athlete reaches a category in two ways: `category_entries` (official import) and
  `athletes.category_id` (manual add or move). `src/lib/roster/categoryAthletes.ts` merges both and
  is used for counts, draws and attendance.
- A category normally has one assignment (`part = 'ALL'`) on one tatami. When the admin splits its
  pools across tatamis it has one per part instead: `POOL:n` for each pool and `FINALS` for the
  semi-finals, final, repechage, bronze and kata medal flight. `(category_id, part)` is unique and a
  partial unique index keeps one primary row (`ALL` or `FINALS`) per category. Each bout carries the
  same `matches.part`, so a bout's tatami is found through its own part (`scopeForMatch`), and a
  tatami scores only its own part. The finals card cannot start until every pool card is completed.
  A tatami still has at most one category part running or paused.
- A match ID is text, for example `<categoryId>-m1`.
- `audit_log` rejects UPDATE through a trigger; rows only disappear when their tournament is deleted.

## Engines

Both live in `src/engine/` as pure modules with unit tests, with no database or clock access.

- **rules-engine**: WKF rulesets as validated data (zod schema in `schema.ts`) plus helpers such as
  `matchDurationSeconds`, `pointsFor` and `hikiwakeAllowed`.
- **draw-engine**: builds a single-elimination graph with byes, seeding, club separation and a
  repechage ladder (`generate.ts`), resolves results into advancement (`resolution.ts`), and builds
  kata pools and a medal flight (`kataFlightDraw.ts`). Output is canonical JSON with a checksum.

`src/lib/draws/` turns an engine graph into `draws`, `matches` and `match_slots` rows, and
`src/lib/bouts/results.ts` commits a confirmed result and advances the draw. Seed scripts call the
same cores that the guarded actions wrap.

## Audit

`src/lib/audit.ts` writes one `audit_log` row per official action with the actor's role, id and
name, IP and user agent, the target, the before and after values and an optional reason. Writing the
row never makes the action fail; a failed insert is logged loudly. The viewer and the results
export are on the Official Record page of the admin and organiser. Action names include
`BOUT_CONFIRMED`, `BOUT_CORRECTED`, `KATA_VOTE_VOIDED`, `DRAW_LOCKED`, `MODERATOR_APPROVED` and
`ATTENDANCE_SET`; search `action:` in `src/actions/` for the full list.

`event_log` is separate: it feeds the live activity widget and the dashboard, and is not the
official record.

## Reports

- Draw-sheet PDFs (`src/lib/pdf/drawPdfGenerator.ts`): admin only, never public.
- Results CSV and PDF (`src/lib/results/`, `src/lib/pdf/resultsPdfGenerator.ts`): one row per bout
  with athletes, score line, decision, winner and the officiating moderator, plus corrections.
- Category athlete-list PDFs uploaded by the admin are stored in Postgres (`category_documents`) and
  served to staff only by `/api/category-docs/[categoryId]`.

## Security headers

`src/lib/http/securityHeaders.ts`, applied per request in `src/proxy.ts`: a same-origin
Content-Security-Policy (online mode also allows Turnstile and the cdnjs PDF viewer), no framing
except for `/scoreboard` and `/public` (configurable by `FRAME_ANCESTORS`), `nosniff`, a referrer
policy, a permissions policy, and HSTS on HTTPS only so plain-HTTP LAN installs keep working.

## Known limitations

- **Single process.** Login rate limits are in memory per process, so run one app instance.
  Scaling out needs a shared store for them.
- **No offline-to-online sync.** An event runs on one database, either the venue server or the
  hosted one.
- **PDF viewer** loads pdf.js from cdnjs when online and falls back to the browser's viewer when
  offline.
- **Judge panel** shows five seats (the server handles seven) and has been exercised in a browser at
  phone size but not yet on real phones over a venue LAN or tunnel.
- **Team events** have no floor operations (see [DISCIPLINES.md](DISCIPLINES.md)).
- **Styling debt.** Many components use inline hex colours instead of the theme tokens, and a few
  components (`RingBalancingClient`, `BoutScoringPad`) are very large.
- **Unreliable client IP** on a direct install: without a proxy a client can forge
  `X-Forwarded-For`, so per-address rate limits are best effort. Per-target and global caps still
  apply. Behind a proxy set `TRUST_PROXY=true`.
