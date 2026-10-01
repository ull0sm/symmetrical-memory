# Claude Handoff — RingFlow remediation (checkpoint 2026-10-01)

Read first: `RingFlow-CISCE/AGENTS.md`, `RingFlow-CISCE/docs/PLAN.md` and `RingFlow-CISCE/docs/roles/`.
Only `RingFlow-CISCE/` is live. `silver-meme/` is dead, so leave it untouched.

## Objective
The user (ull0sm) asked for every RBAC role to be audited and fixed, plus the half-built features and
the hardcoding, following the 7-phase plan in `docs/PLAN.md`. Each phase goes on its own **stacked** branch, is
tested and committed, and the user gets a report at the end. User decisions are recorded in
`docs/roles/README.md`: organiser is read-only, admins only see their own tournaments (tenancy),
one moderator per tatami runs the queue and scores, judges get a redesign, an audit log is required,
and the app must work both offline on a LAN and online.

## Branches (stacked, none merged into master)
| Branch | State |
|---|---|
| `fix/phase1-security` | f32ca5f docs + **beb0ec1 Phase 1**. Done and tested: 72/72 HTTP checks |
| `fix/phase2-auth-layer` | + **e4795d3 Phase 2**. Done and tested: 22/22 checks, and the Phase 1 suite re-passed |
| `fix/phase3-audit-log` | + **Phase 3 checkpoint commit** (this one). Mostly done, see below |

## Phase status
- **Phase 1, done.** Central guards live in `src/lib/auth/` (`principal`, `guards`, `scope`, `claims`,
  `cookies`, `tokens`). Every action authorizes itself. The backdoors are removed, tenancy is enforced,
  and the claim-cookie flow is in place. The live feed (`src/app/api/live/route.ts`) is scoped and
  sanitized, and no secrets reach clients. Many features were fixed along the way; the PLAN Phase 1
  status lists them. Migration: `supabase/migrations/migration9_security_hardening.sql`.
- **Phase 2, done.** Admin sessions live in `admin_sessions`, and staff sessions are stored only as a
  hash (`session_token_hash`), minted when the requesting browser claims them. Inputs are validated
  with zod (`src/lib/validation.ts`) and rate limits live in `src/lib/rateLimit.ts`. Supabase is
  removed: category PDFs are stored in `category_documents` and served by
  `/api/category-docs/[categoryId]`. Migration: `migration10_sessions_and_documents.sql`.
- **Phase 3, implemented. Static checks pass; one change is not re-tested at runtime.**
  - `audit_log` table, append-only via a trigger (migration `migration11_audit_log.sql`, plus the
    schema in `src/db/schema/index.ts`).
  - `src/lib/audit.ts` holds `audit()` and the action labels. It is wired into every accountable
    action across admin, moderator, organiser, stager, rings, settings, categories,
    categoryDefinitions, categoryDocs, athletes, officialImport, draws, balancing, matches, kata,
    judgeAuth and resultsExport.
  - Corrections: `confirmBoutResult` requires a `reason` (at least 5 characters) when the result is
    already CONFIRMED. The new admin-only `correctBoutResult` in `actions/matches.ts` works after the
    category has left the mat. `BoutScoringPad.tsx` prompts for the reason.
  - Official Record page at `/admin/event/[id]/record` and `/organiser/event/[id]/record`
    (`components/record/*`, `actions/audit.ts`), with sidebar links. It holds the audit log viewer
    and the CSV/PDF export buttons, which also fixes the missing organiser export.
  - Exports now show "Confirmed by", corrections and the correction reason
    (`lib/results/officials.ts`, `resultsDataset.ts`, `drawStatePdfGenerator.ts`). Kata POOL bouts
    and kata score totals now appear in the PDF; before this they were missing.
  - **Changed last, not re-run at runtime:** `src/lib/rateLimit.ts` now counts **only failed**
    attempts (`isBlocked` / `recordFailure`) instead of every attempt. It's wired into `auth.ts`,
    `moderator.ts`, `organiser.ts`, `stager.ts` and `judgeAuth.ts`. Typecheck and build pass.
  - Phase 3 suite: 17/19 passed **before** that change. The two failures were test-harness issues
    (CSV decoding), now fixed in the test. Its last full run was blocked by the old limiter, which
    counted successful logins. **Re-run all three suites first** (see below).
- **Phases 4–7, not started.**
  - 4: rebuild the judge system to the spec in `docs/roles/judge.md`. No moderator approval UI
    exists today, so judges can't vote.
  - 5: online readiness.
  - 6: optional stager attendance.
  - 7: code quality. Includes installing vitest and making `src/engine/**/*.test.ts` run.

## Next steps (in order)
1. Re-run the HTTP suites (each one seeds fresh data):
   `bash RingFlow-CISCE/tests/http/run-suite.sh RingFlow-CISCE/tests/http/test-phase1.mjs`, then
   the same for phase2 and phase3. The dev server must be running first (see Test setup).
   Fix any failures.
2. Update `docs/PLAN.md` (tick Phase 3 and add a status note) and the "Known gaps" sections in
   `docs/roles/*.md`. Then amend or add a commit on `fix/phase3-audit-log`.
3. Create `fix/phase4-judges` from phase 3 and continue with Phases 4–7. Each phase gets a commit,
   tests, and doc updates.
4. Final report to the user. It must include the known issues listed below.

## Test setup (IMPORTANT)
- **Never use `127.0.0.1:5432` or the `.env` database.** It is the user's real dev database in WSL.
  Use only the isolated container `ringflow-claude-test` on `127.0.0.1:55432`. If it is gone,
  recreate it:
  `docker run -d --name ringflow-claude-test -e POSTGRES_USER=event_suite -e POSTGRES_PASSWORD=event_suite -e POSTGRES_DB=ringflow -p 127.0.0.1:55432:5432 postgres:16-alpine`.
  Then run `DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npx drizzle-kit push --force`,
  and apply `migration8` through `migration11` with `docker exec -i ringflow-claude-test psql -U event_suite -d ringflow < file`.
- Always set `DATABASE_URL=...55432...` inline. **Never write `.env.local`.**
- Dev server:
  `DATABASE_URL=...55432... OFFLINE_MODE=true TURNSTILE_SECRET_KEY=disabled NEXT_PUBLIC_TURNSTILE_SITE_KEY=disabled npx next dev -p 3100`.
- `tests/http/*` calls server actions over HTTP. The scripts hold absolute paths for this machine
  (`APP_DIR` in `run-suite.sh`), and they read action IDs from `.next/dev/server/server-reference-manifest.json`.
  That is why the pages have to be warmed first; `run-suite.sh` does this. A dev-server restart
  resets the in-memory rate limits.
- Harness facts learned the hard way:
  - Cookies set by an action only stick when the action is POSTed to its own page.
  - Next 16 only executes actions that are bundled into the page being posted to; other actions return `{}`.
  - Thrown errors arrive as `1:E{...}`.
- Commands that pass right now: `npx tsc --noEmit -p .`, `npx eslint src` (0 errors), `npx next build`.

## Known issues / things to tell the user
- During setup a seed accidentally ran against the user's real database (WSL, port 5432). The demo
  tournament it added was removed. **Admin `admin@ringflow.org` had its password hash reset to the
  seed value `admin123`; the original could not be restored.**
- The user's real database still needs migrations 9, 10 and 11 applied (they're idempotent), plus
  `npm run db:push`. Existing sessions are migrated to hashes, but old admin cookies stop working:
  admins log in again.
- The seed scripts still use test credentials (`admin123`, `ORG001`, `RING01`, and a fixed
  moderator token). They're for dev only.
- `tests/http` are scratch-quality scripts with hard-coded paths. Phase 7 should turn them into proper tests.

## Do NOT
- Reintroduce `ensureAdmin` or `loginAsDevAdmin`, accept a request ID as a token, or send
  tokens, PINs or codes to clients or the live feed.
- Let tooling or scripts call guarded actions. Scripts use the cores in `src/lib/`
  (`lib/bouts/results.ts`, `lib/roster/*`, `lib/kata/*`).
- Change `audit_log` to allow UPDATE.
- Touch `silver-meme/`, reset or rebase the phase branches, or merge to `master` without the user.
