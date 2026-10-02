# RingFlow — Agent Guide

RingFlow runs karate (WKF) tournaments in real time: it manages draws (brackets and kata pools),
assigns categories to tatamis, records bout scoring and results, and shows live scoreboards and a
public event view. **This folder (`RingFlow-CISCE/`) is the only live app.** `../silver-meme/` is dead:
don't read it, edit it, or copy from it.

Read this file first. Before touching anything role-related, read the role file you need in
[docs/roles/](docs/roles/README.md) instead of exploring the codebase. Open security and refactor
work is tracked in [docs/PLAN.md](docs/PLAN.md).

## Stack
Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind v4 · Drizzle ORM ·
PostgreSQL 16 · SSE (`/api/live` public, `/api/live/staff` staff-only) fed by Postgres `LISTEN/NOTIFY` and an
in-memory bus · pdf-lib · xlsx · zod. The environment is validated at boot (`src/lib/env.ts`); deployment modes
are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
There is no external auth provider (Supabase was removed). Sessions are random tokens in httpOnly
cookies; Postgres stores only their sha256 (`admin_sessions`, `*_requests.session_token_hash`).

## Commands
```bash
npm run dev            # dev server on 0.0.0.0:3000
npm run build          # production build + typecheck (the real CI gate)
npm run lint           # eslint
npm run db:push        # apply src/db/schema to the DB (drizzle-kit)
npm run db:migrate     # apply the SQL migrations 8+ (triggers etc.); idempotent
npm run db:seed        # realistic demo tournament
npm run db:reset       # wipe + clean seed
npm run db:create-admin -- --email=a@b.c --password=... --name="..."
```
Tests (`src/engine/**/*.test.ts`) use vitest, but vitest isn't installed yet (see PLAN Phase 7).
Local DB: `docker compose up -d db`. Env template: `.env.example`.

## Where things live
| Path | What |
|---|---|
| `src/actions/*.ts` | **All server-side logic.** Each file is a `"use server"` module, and every export is a publicly callable endpoint. |
| `src/app/<role>/...` | Route trees per role: `admin`, `organiser`, `stager`, `moderator`, `judge`, `scoreboard`, `public`, `login`. |
| `src/components/<area>/` | Client components (admin, moderator, judge, scoreboard, public, draw, layout, ui). |
| `src/db/schema/index.ts` | Entire Drizzle schema (single file). |
| `src/engine/draw-engine/` | Pure bracket generation/resolution (seeding, byes, repechage, kata flights). Imported as `@event-suite/draw-engine`. |
| `src/engine/rules-engine/` | WKF rulesets (kumite, kata, team). Imported as `@event-suite/rules-engine`. |
| `src/lib/` | Helpers: `staffAccess.ts` (who is staff for an event), `realtime/bus.ts`, `pdf/`, `results/`, `kata/scoringEngine.ts`, `matchClock.ts`, `serializers.ts`. |
| `src/lib/auth/` | Sessions and guards: who is calling, what they may touch. Every action uses it. |
| `src/lib/http/requestGate.ts` | Request gate (wired in `src/proxy.ts`): cookie-presence redirects + tunnel host block. **Not** a security boundary. |
| `supabase/migrations/` | SQL migrations (hand-written `migrationN_*.sql` + drizzle output). The folder name is legacy. |
| `docs/roles/` | One file per role: scope, permissions, workflow, key files, known gaps. |

## Roles (summary — details in docs/roles/)
| Role | Login | Scope |
|---|---|---|
| Admin | email + password (`/login/admin`) | only tournaments where `tournaments.admin_id` = self |
| Organiser | event code + admin approval | **read-only**, one tournament |
| Stager | stager code + admin approval | one tournament; marks categories calling/ready |
| Moderator | tatami access code + admin approval | one tatami; runs the queue AND scores bouts |
| Judge | tatami QR/PIN + moderator approval | one tatami seat; votes on the open kata bout only |
| Public / Scoreboard | none | read-only, controlled by the event's public toggles |

## Non-negotiable rules
1. **Every exported server action authorizes itself.** Page guards, `readOnly` props, and middleware
   do not protect actions, because anyone can POST to any action ID. Resolve the target's tournament
   (ring → tournament, category → tournament, match → category → tournament) and check that the caller
   holds an allowed role for **that** tournament, or for that ring if the caller is a moderator or judge.
2. **Tenancy:** an admin only touches tournaments they own (`tournaments.admin_id`). Never trust a
   `tournamentId` argument without checking that the target row belongs to it.
3. **Never send secrets to clients or the live feed.** That covers session tokens, request IDs used
   as credentials, judge PINs, device tokens, and access codes. SSE events carry only
   `{table, op, id, ringId, tournamentId, categoryId, matchId, status}`.
4. **Organiser is read-only.** Don't add organiser write paths.
5. **One running category per tatami.** One approved moderator per tatami. Approving a new one revokes the old.
6. **Audit what officials do.** Any action that changes scores, results, draws, approvals, or the
   queue must write an audit entry (actor role/id/name, target, before/after). See PLAN Phase 3.
7. Must work **offline on a venue LAN and online (hosted)**. Don't add runtime calls to external
   services. Turnstile is optional and is bypassed when `OFFLINE_MODE=true`.
8. Draw sheets and PDFs are internal staff documents. They are never public downloads.

## Conventions
- Server actions return `{ success, error? }` for expected failures and throw only on auth failures.
- Validate action inputs with zod. Don't use `any` in new code, and don't write empty `catch {}`.
- After a write, call `broadcastLiveEvent(...)` (scoped by ringId/tournamentId) and `revalidatePath(...)`.
  Screens subscribe with `useLiveEvents(scope, refetch)`; staff screens pass `{ feed: "staff" }`. Polling is only a slow fallback.
- Styling: Tailwind with the tokens in `src/app/globals.css`. New UI must match the existing design
  language (see `frontend-design/DESIGN.md`). Don't add new inline hex colours.
- Statuses are text columns. Valid values are listed in comments in `schema/index.ts`. Keep them consistent.
- Clock is authoritative on the server (`rings.timer_*` ms fields, `src/lib/matchClock.ts`).

## Gotchas
- Use the guards in `src/lib/auth/guards.ts`; there is no `ensureAdmin` any more. Guards throw
  `AuthError`; pages catch nothing and let the layout/page `redirect()` instead.
- A server action can be invoked with any page's path; never rely on the route to protect it.
- Seed scripts and other tooling call the cores in `src/lib/` (e.g. `lib/bouts/results.ts`,
  `lib/roster/*`), never the guarded actions — those need a browser session.
- Kata preliminary pool scores never carry into medal bouts. Medal bouts start at 0. Every finished
  bout (kumite or kata) has status `CONFIRMED`.
- Category discipline comes from `categories.event_type` (`lib/categories/eventType.ts`), not the name.
- `PRD.md` is the product spec. If you find older text (e.g. "no scoring, no brackets"), it's obsolete.
