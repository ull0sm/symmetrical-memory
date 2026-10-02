# Claude Handoff — RingFlow remediation (2026-10-02)

Read first: `RingFlow-CISCE/AGENTS.md`, `RingFlow-CISCE/docs/PLAN.md` (each phase has a **Status** note),
`RingFlow-CISCE/docs/roles/` and `RingFlow-CISCE/docs/DEPLOYMENT.md`.
Only `RingFlow-CISCE/` is live. `silver-meme/` is dead, so leave it untouched.

## Objective
Audit and fix every RBAC role, the half-built features and the hardcoding, following the 7-phase plan in
`docs/PLAN.md`. Each phase is on its own **stacked** branch. User decisions are in `docs/roles/README.md`.

## Branches (stacked; nothing merged into master)
| Branch | Top commit | State |
|---|---|---|
| `fix/phase1-security` | Phase 1 | done |
| `fix/phase2-auth-layer` | Phase 2 | done |
| `fix/phase3-audit-log` | Phase 3 + admin correction UI | done |
| `fix/phase4-judges` | Phase 4 judge rebuild | done (no real-phone/tunnel test yet) |
| `fix/phase5-online` | Phase 5 env/headers/feeds | done |
| `fix/phase6-attendance` | Phase 6 attendance | done |
| `fix/phase7-quality` | Phase 7 | 7.1/7.2/7.6/7.8 done; 7.7/7.9 partial; 7.3–7.5 ongoing |

`fix/phase7-quality` contains everything. Merging to master is the user's call.

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

## Do NOT
- Reintroduce `ensureAdmin`/`loginAsDevAdmin`, accept a request ID as a token, or send tokens, PINs,
  pairing keys or codes to clients or the public live feed.
- Let tooling call guarded actions (scripts use the cores in `src/lib/`).
- Change `audit_log` to allow UPDATE. Don't give organisers write paths.
- Touch `silver-meme/`, rebase the phase branches, or merge to `master` without the user.
