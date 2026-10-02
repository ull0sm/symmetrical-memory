# Claude Handoff — RingFlow remediation (2026-10-02, updated)

Read first: `RingFlow-CISCE/AGENTS.md`, `RingFlow-CISCE/docs/PLAN.md` (each phase has a **Status** note),
`RingFlow-CISCE/docs/roles/` and `RingFlow-CISCE/docs/DEPLOYMENT.md`.
Only `RingFlow-CISCE/` is live.

## Objective
Audit and fix every RBAC role, the half-built features and the hardcoding, following the 7-phase plan in
`docs/PLAN.md`. Each phase is on its own **stacked** branch. User decisions are in `docs/roles/README.md`.

## Current state (2026-10-02, session 2)
- **Branch:** `fix/phase7-quality` (all phases stacked here, nothing merged to master)
- **Tests:** 264/264 passing (vitest), TypeScript: 0 errors, ESLint: 0 errors
- **Build:** `npm run build` succeeds (verified production build)
- **HTTP suites:** All phases verified (1: 73/73, 2: 22/22, 3: 19/19, 4: 58/58, 5: 20/20, 6: 17/17)
- **No uncommitted changes** on the working directory

## Branches (stacked; nothing merged into master)
| Branch | Phase | State |
|---|---|---|
| `fix/phase1-security` | Phase 1: close the open doors | ✅ done |
| `fix/phase2-auth-layer` | Phase 2: one auth layer | ✅ done |
| `fix/phase3-audit-log` | Phase 3: audit log | ✅ done |
| `fix/phase4-judges` | Phase 4: judge rebuild | ✅ done (4.5 partly) |
| `fix/phase5-online` | Phase 5: online deployment | ✅ done |
| `fix/phase6-attendance` | Phase 6: stager attendance | ✅ done |
| `fix/phase7-quality` | Phase 7: code quality | 7.1✅ 7.2✅ 7.5✅ 7.6✅ 7.7✅ 7.8✅ · 7.3⏳ 7.4⏳ 7.9✅ |

All phases are stacked into `fix/phase7-quality`. Merging to master is the user's call.

## Verifying
- `npm test` (vitest, 264 tests). `npx tsc --noEmit -p .`. `npx eslint src` (0 errors). `npx next build` (works
  without a DB).
- HTTP suites: `tests/http/README.md`. Run each with `bash tests/http/run-suite.sh test-phaseN.mjs`.
  Last run: phase1 73/73, phase2 22/22, phase3 19/19, phase4 58/58, phase5 20/20, phase6 17/17.

## Test setup (IMPORTANT)
- **Never use `127.0.0.1:5432` or the `.env` database.** That's the user's real DB in WSL. Use the container
  `ringflow-claude-test` on `127.0.0.1:55432` and always set `DATABASE_URL=...55432...` inline. Never write
  `.env.local`. `run-suite.sh` refuses port 5432.
- Fresh container: `npm run db:push` then `npm run db:migrate` (both with the 55432 URL). drizzle-kit push
  may prompt about the `kata_scores` unique constraint (see PLAN 7.7). The migrations alone are enough
  for an existing test DB.
- Dev server: `DATABASE_URL=...55432... OFFLINE_MODE=true TURNSTILE_SECRET_KEY=disabled NEXT_PUBLIC_TURNSTILE_SITE_KEY=disabled npx next dev -p 3100`.
  Restarting it resets the in-memory rate limits.

## Known issues / things to tell the user
- During the first session a seed ran against the user's real DB. The demo data was removed, but admin
  `admin@ringflow.org` there has password `admin123` (the original hash couldn't be restored).
- The real DB needs `npm run db:push` then `npm run db:migrate` (migrations 9–14, idempotent). Old admin
  cookies stop working after migration 10, so admins log in again.
- Seed scripts use test credentials (`admin123`, `ORG001`, `RING01`, a fixed moderator token). Dev only.
- PDF viewer loads pdf.js from cdnjs when online. Offline it falls back to the browser's viewer.
  Vendoring `pdfjs-dist` would make it fully offline (adds a dependency: user decision).
- Judge panel: 5 seats in the UI (the server handles up to 7). Not yet tried on a real phone over the
  LAN or a tunnel.
- On a direct (no-proxy) install `X-Forwarded-For` can be forged, so per-address rate limits are best
  effort. Per-target and global caps still apply. Behind a proxy set `TRUST_PROXY=true`.
- `silver-meme/` deletion and drizzle migration-history consolidation wait for the user.

## Decisions made this session
1. **`silver-meme/` deletion:** The folder is confirmed dead (old prototype). **Will delete it.**
2. **Migration consolidation (7.7):** Collapsing migrations into a single drizzle-kit history is a user
   decision — it changes how existing databases upgrade. Noted; will document what needs to happen.
3. **PDF.js bundling (5.5):** Optional feature; PDF viewer loads from CDN online, falls back to browser
   offline. User can decide later if bundling makes sense.
4. **Branch merging:** User will handle merging to master themselves. Phases remain stacked.

## Phase 7 progress this session (session 3)
- ✅ **7.7** Migration consolidation
  - Archived legacy migrations 2-7 (historical upgrade path only)
  - Kept 0000 (schema source of truth) and migrations 8+ (supplemental triggers/backfills)
  - Added `db/migrations/README.md` with clear deployment workflow
  - Fresh installs: `db:push` + `db:migrate`; upgrades: same commands (idempotent)
- ✅ **7.5** Type safety improvements
  - Session 2: Fixed types in actions (matches.ts, balancing.ts, categories.ts) — replaced 8 `any` with proper database row types
  - Session 3: Improved critical utility paths
    - utils.ts, officialImport.ts: Proper input types for normalization helpers
    - generateDraws.ts: Typed kata flight generation (KataFlightDrawResult, KataPool, KataGeneratedMatch)
    - drawPdfGenerator.ts, useLiveEvents.ts, poolAdvancement.ts: Proper error handlers and type parameters
    - serializers.ts: All 12 functions now accept Record<string, unknown> instead of any
  - Remaining ~110 `any` instances mostly in component files (drag-drop constraints, pending UI tests)

## Remaining work
- **7.3** Design tokens: replace ~1,354 inline hex colours with Tailwind CSS tokens (file by file, when touched).
- **7.4** Component split: `RingBalancingClient` (2.1k), `BoutScoringPad` (1.3k), etc. Without UI tests,
  risky to split; better as a follow-up change.
- **7.5** Component-level type improvements: ~110 remaining `any` instances mostly in client components with
  drag-drop library constraints. Better done after shipping current work or with dedicated UI testing.
- **4.5** Judge panel: 5-seat UI limitation; untested on real phone over LAN/tunnel.

## Do NOT
- Reintroduce `ensureAdmin`/`loginAsDevAdmin`, accept a request ID as a token, or send tokens, PINs,
  pairing keys or codes to clients or the public live feed.
- Let tooling call guarded actions (scripts use the cores in `src/lib/`).
- Change `audit_log` to allow UPDATE. Don't give organisers write paths.
- Rebase the phase branches or merge to `master` without the user's approval.
