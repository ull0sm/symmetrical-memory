# RingFlow: engineering guide

For anyone (human or AI agent) changing the code. For what the product does, read
[README.md](README.md) and [PRD.md](PRD.md). For who may do what, read
[docs/roles/](docs/roles/README.md). For how it fits together, read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Rules that must hold

1. **Every exported server action authorizes itself**, as its first step, with a guard from
   `src/lib/auth/guards.ts`. Page layouts, `readOnly` props and the request gate do not protect
   anything, because anyone can POST to an action.
2. **Resolve ownership from the target row.** Never trust a `tournamentId`, `ringId` or `categoryId`
   from the client on its own. Guards such as `requireTournamentAdmin`, `requireMatchModerator` and
   `requireRingModerator` check the row's real tournament and tatami.
3. **Never send secrets to a browser or the live feed**: session tokens, claim secrets, request IDs
   as credentials, judge PINs, pairing keys, access codes, device tokens. The live feed carries ids
   and status only. Use the functions in `src/lib/serializers.ts` for client-bound data.
4. **The organiser is read only.** Do not add an organiser write path.
5. **A tatami runs one category (or one part of a split category) at a time and has one approved moderator.** Approving a new
   moderator revokes the old session. A seat on a judge panel belongs to one phone (partial unique
   index on `judge_sessions`).
6. **Official actions are audited** with `audit()` (scores, results, corrections, draws, approvals,
   queue, settings, roster, attendance). `audit_log` is append-only; do not add an UPDATE path.
7. **No runtime calls to outside services.** The app must work on a network with no internet.
   Cloudflare Turnstile is optional and off when `OFFLINE_MODE=true`.
8. **Draw sheets and category PDFs are staff documents**, never public downloads.
9. **Scripts must not call guarded actions.** Seed and maintenance scripts use the request-free
   cores in `src/lib/` (for example `performGenerateAllTournamentDraws`, `commitBoutResult`).
10. **Do not edit a migration that has been applied.** Add a new one.

## Where things live

| I want to change | Look in |
|---|---|
| Any server behavior | `src/actions/<area>.ts` (one file per area: `admin`, `athletes`, `attendance`, `audit`, `auth`, `balancing`, `categories`, `categoryDefinitions`, `categoryRouting`, `categoryDocs`, `clock`, `drawPdfs`, `draws`, `judge`, `judgePanel`, `kata`, `matches`, `moderator`, `officialImport`, `organiser`, `public`, `resultsExport`, `rings`, `settings`, `stager`, `tournament`, `turnstile`) |
| Who can call what | `src/lib/auth/` ([roles/README.md](docs/roles/README.md)) |
| Database tables | `src/db/schema/index.ts`, plus `db/migrations/` for triggers and constraints |
| Allowed status values | `src/lib/statuses.ts` (then the schema check and a migration) |
| Shared tunables (session lifetimes, judge seats, polling, bout length) | `src/lib/constants/index.ts` |
| Kumite result and bracket advancement | `src/actions/matches.ts`, `src/lib/bouts/results.ts`, `src/engine/draw-engine/resolution.ts` |
| Kata voting, totals, pool advancement | `src/actions/kata.ts`, `src/lib/kata/` |
| Draw generation | `src/actions/draws.ts`, `src/lib/draws/`, `src/engine/draw-engine/` |
| Where a category runs (whole, or pools on different tatamis; parts, finals waiting) | `src/actions/categoryRouting.ts`, `src/lib/draws/partRouting.ts` (apply), `src/lib/draws/routingPlan.ts` (rules), `src/engine/draw-engine/parts.ts` |
| Rules (durations, scoring, penalties) | `src/engine/rules-engine/rulesets/` |
| Match clock | `src/actions/clock.ts`, `src/lib/matchClock.ts`, `src/lib/ringClockStore.ts`, `src/hooks/useMatchClock.ts` |
| Live updates | `src/lib/realtime/` (`bus.ts`, `liveStream.ts`), `src/app/api/live/`, `src/hooks/useLiveEvents.ts` |
| Roster import and category definitions | `src/lib/roster/`, `src/lib/constants/categoryPresets.ts` |
| PDFs and exports | `src/lib/pdf/`, `src/lib/results/`, `src/actions/resultsExport.ts` |
| Environment and deployment mode | `src/lib/env.ts`, `src/lib/offline.ts`, `src/lib/http/` |
| Screens | `src/app/<role>/...` (admin, organiser, stager, moderator, judge, public, scoreboard) and `src/components/<role or feature>/` |

## Anatomy of an action (illustrative)

```typescript
"use server";

export async function renameRing(tournamentId: string, ringId: string, name: string) {
  const admin = await requireTournamentAdmin(tournamentId);        // 1. guard
  const params = parseInput(renameSchema, { ringId, name }, "rename");  // 2. validate (zod)
  // 3. confirm the ring belongs to that tournament, then write with Drizzle
  await audit({ tournamentId, ringId, actor: admin, action: "RING_RENAMED",
                targetType: "ring", targetId: ringId, before, after });  // 4. audit
  broadcastLiveEvent({ table: "rings", op: "UPDATE", id: ringId, ringId, tournamentId }); // 5. notify
  revalidatePath(`/admin/event/${tournamentId}/rings`);             // 6. refresh pages
  return { success: true };
}
```

Guards throw `AuthError`; non-throwing `get...` variants return `null`. Actions return
`{ success, error? }` for expected failures. `audit()` never fails the action it records.

Guard cheat sheet (`src/lib/auth/guards.ts`):

| Need | Guard |
|---|---|
| The tournament's owner | `requireTournamentAdmin(tid)` |
| Any staff of a tournament, limited to some roles | `requireTournamentStaff(tid, ["admin", "organiser"])` |
| The moderator of a tatami | `requireRingModerator(ringId)` |
| A moderator or the owning admin (clock, judge panel) | `requireRingOperator(ringId)` |
| Scoring a bout | `requireMatchModerator(matchId)` (also checks the category is running or paused on that tatami) |
| A judge phone on a tatami | `requireJudge(ringId)` |
| Resolve which tournament a row belongs to | `src/lib/auth/scope.ts` |

## Database changes

1. Edit `src/db/schema/index.ts`.
2. `npm run db:push` applies tables and columns.
3. Anything the schema cannot express (triggers, backfills, data fixes) goes in a new idempotent
   `db/migrations/migrationN_description.sql`, applied by `npm run db:migrate`. If a new table
   should drive live screens, add its trigger to the `ringflow_events` function
   (`migration8_realtime_notify.sql`).
4. A new status value goes in `src/lib/statuses.ts` first.

Fresh installs and upgrades use the same two commands. See [db/migrations/README.md](db/migrations/README.md).

## Testing

- **Unit tests**: `npm test` (vitest, `src/**/*.test.ts`). They cover the draw and rules engines,
  the kata tally, auth guards (database mocked), status lists, environment validation and security
  headers.
- **HTTP suites**: `tests/http/`, run with `bash tests/http/run-suite.sh test-<name>.mjs`. They call
  actions against a running dev server and a throwaway database. See
  [tests/http/README.md](tests/http/README.md).
- **Use a disposable database for the suites.** They create tournaments and hammer logins. Never
  point them, or the seed scripts, at a database with real event data. `run-suite.sh` refuses port
  5432.
- Static checks: `npm run lint`, `npx tsc --noEmit`. The type check is clean and `npm run build`
  depends on it, so keep it that way.

## Conventions

- TypeScript throughout; no new `any`. Use Drizzle's inferred row types.
- Database columns are `snake_case`; Drizzle exports are camelCase.
- Use `isHttpsRequest()` (`src/lib/auth/cookies.ts`), not `NODE_ENV`, to decide cookie security, so
  LAN installs over HTTP keep working.
- Style new UI with the theme tokens in `src/app/globals.css`, not inline hex colours.
- Do not leave empty `catch {}` blocks; log or return a typed error.
- Commit messages explain why. Branch names: `feature/`, `bugfix/`, `docs/`, `chore/`
  ([CONTRIBUTING.md](CONTRIBUTING.md)).
