# RingFlow Remediation Plan

Created 2026-10-01 from a full audit of RBAC, roles and code quality. Product decisions are in
[roles/README.md](roles/README.md). Work the phases in order. Each phase ships on its own and leaves
the app working. Tick items as they land.

---

## Phase 1 — Close the open doors (security hotfix, small diffs)
Goal: nobody can become admin, change a score, or hijack a session without credentials.
This phase only adds guards and removes leaks. There are no new features and no schema changes.

- [x] **1.1 Remove the admin backdoors.** Delete `loginAsDevAdmin` and `logoutDevAdmin`, the
  `admin_dev_id` cookie everywhere (auth.ts, middleware, staffAccess, scoreboard layout), the
  non-production fallback in `ensureAdmin`, the `admin123` auto-password in `auth.ts`, and the
  credentials prefilled on `/login/admin`.
- [x] **1.2 Enforce tenancy.** `ensureAdminOwnsTournament` must check `tournaments.admin_id = adminId`.
  The admin event list must filter by owner.
- [x] **1.3 Guard bout control.** `matches.ts` (`setActiveBout`, `updateLiveMatchState`,
  `confirmBoutResult`) and `kata.ts` (`finalizeKataBout`, `submitModeratorManualKataMarks`,
  `advanceKataPoolFinalists`, `voidJudgeVote`, `updateRingJudgePin`, `regenerateRingJudgePin`) must
  require the moderator of the match's tatami (resolve match → category → assignment → ring).
  The match must also belong to the category running on that tatami.
- [x] **1.4 Guard admin reads and unguarded writes:** `getAdminDashboardData`, `getLiveLogs`,
  `getPendingModeratorRequests`, `getTournamentSearchMeta`, `getSidebarTournamentCounts`,
  `getStagerCodes`, `getBalancingAssignments` (staff of that tournament), `categoryDefinitions.*`,
  `importOfficialRoster`, `getModeratorRingAssignments` (moderator of the tatami or staff),
  `updateModeratorName` (validate the session).
- [x] **1.5 Stop leaking secrets on `/api/live`.** Remove `sessionToken` and device tokens from every
  `broadcastLiveEvent`. A `requestId` scope should only receive `{status}`, never tokens. A stream
  with no scope gets nothing. (`eventMatchesScope` currently returns `true` for an empty scope.)
- [x] **1.6 Stop accepting request IDs as credentials.** Remove the `or(sessionToken, id)` matches
  in organiser, stager and moderator auth. `check*Status(requestId)` may set the cookie **once**
  for the waiting-room browser: bind it with a one-time `claim_secret` cookie set when the request
  is created.
- [x] **1.7 Make the organiser truly read-only and scoped.** Drop organisers from `authorizeRingControl`
  and `setAllRingTimers`. Replace unscoped `ensureOrganiser()` checks with tournament-scoped checks.
- [x] **1.8 Stop exposing the judge PIN.** Remove `judgePin` from `getRingKataState` and everything
  else the judge page or public can reach. Remove the `"1234"` fallbacks. Generate a random PIN when
  a ring is created.
- [x] **1.9 Fix cookies.** Make all role cookies `httpOnly`, use `secureCookieFlag()` everywhere,
  and drop the `stager_name` / `org_name` cookies (read names from the DB).
- [x] **1.10 Protect public data.** Give `PublicEventClient` a public action that returns a
  minimal DTO instead of `getAdminDashboardData`. `getRingActiveBout` / `getTournamentActiveBouts`
  must enforce `show_public_scoreboard` for non-staff.

**Status (2026-10-01): done.** Guards live in `src/lib/auth/` (built here rather than in Phase 2). Also fixed while in there: kata results stored as `CONFIRMED` (they were missing from the official export), bracket-format kata now advances winners, kata draw sheets no longer crash, draws merge both athlete sources, unique access/organiser/stager codes, admin "resume" no longer starts the bout clock, safe queue reordering, zero-mark kata rows, fake 7.5/7.0 default kata scores removed, seed scripts work again. Verified by a 72-check HTTP attack/role suite.

**Done when:** an unauthenticated `curl` POST to any server action ID (other than the login,
request-access and public reads) fails, and `/api/live` with an empty scope receives nothing.

---

## Phase 2 — One auth layer (structure)
Goal: auth is declared once per action instead of being copy-pasted.

- [x] **2.1 `src/lib/auth/` module** (plain module, not `"use server"`) — landed in Phase 1:
  - `principal.ts`: `getPrincipal()` resolves cookies to
    `{ role, actorId, actorName, tournamentId?, ringId?, seat? }`, cached per request.
  - `guards.ts`: `requireAdmin()`, `requireTournamentAdmin(tid)`, `requireStaff(tid, roles[])`,
    `requireRingOperator(ringId)` (the moderator of the ring, or the owning admin for overrides),
    `requireJudge(ringId)`.
  - `scope.ts`: `tournamentIdFor({ ringId | categoryId | matchId | athleteId | assignmentId })`.
  - `permissions.ts`: the matrix from `roles/README.md` as data, so the UI can hide buttons from
    the same source.
- [x] **2.2 Admin sessions table.** Add `admin_sessions(id, admin_id, token_hash, created_at,
  expires_at, last_seen_at, user_agent, ip)`. The cookie holds a random token and the DB stores a
  SHA-256 hash. Logout deletes the row.
- [x] **2.3 Hash the staff session tokens** in `*_requests.session_token` (store a hash, compare the hash).
- [x] **2.4 Validate action inputs with zod** at the top of every action, through a small
  `action(schema, guard, fn)` wrapper.
- [x] **2.5 Delete the Supabase leftovers:** `src/utils/supabase/*` (move the middleware to
  `src/middleware/`), `src/app/auth/callback`, the `@supabase/*` dependencies, `signInWithGoogleAdmin`,
  and the anon/service keys in `.env.example`.
- [x] **2.6 Simplify the middleware.** Keep the cookie-presence redirects as UX only. On tunnel or
  judge hosts, also reject server-action POSTs (`Next-Action` header) on non-judge paths, as defence in depth.
- [x] **2.7 Rate-limit code entry** (organiser, stager, moderator, judge PIN). Codes are 6 characters
  and the PIN is 4, so they need per-IP and per-code attempt limits. Use an in-memory store, with a
  DB table when running multi-instance.

---

**Status (2026-10-01): done.** Admin logins live in `admin_sessions` (random token in the cookie,
sha256 in the DB). Staff sessions are minted when the requesting browser collects them and stored
only as `session_token_hash`. zod schemas in `src/lib/validation.ts` cover object inputs; scalar ids
are checked by the guards. Rate limits in `src/lib/rateLimit.ts` (per address, per email, per
tatami; the shared "direct" LAN bucket gets 10×). Supabase is gone: category PDFs are stored in
`category_documents` and served staff-only by `/api/category-docs/[categoryId]`. The request gate
moved to `src/lib/http/requestGate.ts`; Next only executes actions bundled into the posted page,
and tunnel hosts may only reach `/judge` + `/api/live`, so 2.6 needed no extra code.
Migration: `supabase/migrations/migration10_sessions_and_documents.sql`. Verified by a 22-check
suite plus the 72-check Phase 1 suite.

---

## Phase 3 — Audit log (official record)
Goal: every official action can be traced to a person, so results can be defended to the governing body.

- [ ] **3.1 Table `audit_log`** (append-only): `id, tournament_id, ring_id?, category_id?, match_id?,
  actor_role, actor_id, actor_name, session_id, ip, user_agent, action, target_type, target_id,
  before jsonb, after jsonb, reason?, created_at`. Index it on `(tournament_id, created_at)`.
- [ ] **3.2 Write audit entries automatically** from the Phase 2 action wrapper for every write
  action. Cover approvals, score changes, results, overrides, draw generate/lock/flush, queue
  changes, settings, and deletes.
- [ ] **3.3 Result correction flow.** The admin (only) can reopen a confirmed bout with a mandatory
  reason. Downstream bouts are invalidated or flagged, and the whole thing is audited.
- [ ] **3.4 Audit viewer** for the admin, plus a read-only view for organisers: filter by tatami,
  category, actor and action.
- [ ] **3.5 Official results PDF** includes, for each bout, the officiating moderator's name and
  every correction or override.
- [ ] **3.6** Keep `event_log` for the operational feed and ETA calculations. Fill in its actor fields as well.

---

## Phase 4 — Judge system rebuild (kata)
Spec: [roles/judge.md](roles/judge.md).

- [ ] 4.1 Schema: rework `judge_requests` into `judge_sessions` (ring, seat, name, token_hash,
  status, approved_by, expires_at). Add `rings.judge_pairing_key`. Add a voting-open flag to the
  current kata match.
- [ ] 4.2 Moderator seat panel (QR, PIN, pending requests, approve/kick, rotate) inside `KataScoringPad`,
  matching the existing UI.
- [ ] 4.3 Judge phone flow: pair, wait, vote, locked. Rebuild `JudgeMobileClient` on top of
  `requireJudge` and server-side scoring.
- [ ] 4.4 Open and close voting, plus void and override (audited). Totals are computed on the server.
- [ ] 4.5 Test on a real phone over the LAN and over the tunnel/hosted URL.

---

## Phase 5 — Online-ready deployment
Goal: the same build runs on a venue LAN (offline) and on a hosted server (online).

- [ ] 5.1 Validate the environment with zod at boot (`DATABASE_URL`, `OFFLINE_MODE`, `APP_URL`,
  Turnstile keys optional). Fail fast with clear messages.
- [ ] 5.2 Single `APP_URL` setting, used for QR codes, links and cookie security (replaces
  `NEXT_PUBLIC_SUPABASE_URL` and `tunnelUrl` guessing).
- [ ] 5.3 Security headers: CSP, `X-Frame-Options` (the scoreboard may need framing, so make it
  configurable), and HSTS when on HTTPS.
- [ ] 5.4 Split the SSE stream into public (tournament-scoped, minimal) and staff (requires a session) feeds.
- [ ] 5.5 Document both deployment modes in `OFFLINE_VENUE_GUIDE.md`, plus a hosted guide.
- [ ] 5.6 (Later) Offline ↔ online sync is out of scope for now. Note it as a future decision.

---

## Phase 6 — Stager attendance (optional feature)
- [ ] 6.1 `category_entries.attendance` (`unknown | present | absent | withdrawn`), plus who set it and when.
- [ ] 6.2 Stager board: a quick tap per athlete. It is never required.
- [ ] 6.3 Moderator bout view: show a hint when an athlete is marked absent. The moderator decides
  whether to call Kiken.

---

## Phase 7 — Code quality (continuous, after Phase 2)
- [ ] 7.1 Install vitest, add `npm test`, and make the existing engine tests run. Add tests for the
  auth guards and for `confirmBoutResult` progression.
- [ ] 7.2 `src/lib/constants.ts`: session TTLs, PIN length, code length, poll intervals, default clock
  durations. Replace the magic numbers.
- [ ] 7.3 Design tokens: replace about 2,100 inline hex colours in TSX with the Tailwind theme tokens
  from `globals.css`. Do this file by file, when a file is already being touched.
- [ ] 7.4 Split the giant components (`RingBalancingClient` 2.1k lines, `BoutScoringPad`, `KataScoringPad`,
  `ModeratorCurrentClient`, `CategoriesClient`). The admin and stager balancing clients share logic,
  so extract it.
- [ ] 7.5 Remove `any` (248 uses) and empty `catch {}` (60) in touched files. Log, or return typed errors.
- [ ] 7.6 Status enums: add Postgres `CHECK` constraints or pg enums for the status columns, with
  matching TS union types.
- [ ] 7.7 Migrations: consolidate into a single drizzle-kit migration history and rename `supabase/`
  to `db/`.
- [ ] 7.8 Remove the polling that duplicates SSE where the stream is healthy. Keep only a slow fallback.
- [ ] 7.9 Remove the stale tsconfig aliases (`@event-suite/protocol|domain|scoring` point to folders
  that don't exist). Delete `silver-meme/` from the repo once you confirm.

---

## Findings index (from the 2026-10-01 audit)
| # | Severity | Finding | Phase |
|---|---|---|---|
| F1 | Critical | `loginAsDevAdmin` public action grants admin | 1.1 |
| F2 | Critical | `ensureAdmin` treats everyone as admin when `NODE_ENV` isn't production | 1.1 |
| F3 | Critical | Bout and kata scoring/result actions have no auth | 1.3 |
| F4 | Critical | Moderator session token broadcast on unauthenticated SSE | 1.5 |
| F5 | High | Admin cookie is the raw admin ID. `admin_dev_id` is readable by scripts. Default `admin123` | 1.1, 2.2 |
| F6 | High | No tenancy between admins | 1.2 |
| F7 | High | Request ID accepted as a session token. Request IDs broadcast | 1.5, 1.6 |
| F8 | High | Tunnel isolation bypassable via server-action POST | 1.x guards, 2.6 |
| F9 | High | Judge PIN public. Judge approval missing. Votes unvalidated | 1.8, 4 |
| F10 | High | Admin read and write actions unguarded (dashboard, logs, stager codes, definitions, import) | 1.4 |
| F11 | Medium | Organiser can control clocks. Organiser guard not tournament-scoped | 1.7 |
| F12 | Medium | Role cookies not httpOnly | 1.9 |
| F13 | Medium | Public page uses an admin action. Scoreboard toggle only enforced in the layout | 1.10 |
| F14 | Medium | Dead Supabase auth paths break admin recognition on stager and organiser views | 2.5 |
| F15 | Medium | No audit trail of actors | 3 |
| F16 | Low | No rate limit on 4/6-character codes | 2.7 |
| F17 | Low | Tests can't run (no vitest). Stale aliases. Dead silver-meme copy | 7.1, 7.9 |
