# Handoff: Local tournaments (branch `feature/local-tournaments`)

> **Temporary file.** AGENTS.md forbids handoff and plan files in the repository; this one exists only
> because the owner asked for a checkpoint. Delete it before the branch is merged.

Written 2026-10-03 at commit `52d2f42`. Read `AGENTS.md` (repo root) first: its rules apply to all work.

## 1. Objective

RingFlow gets a second tournament type. **Official** is the existing flow, unchanged. **Local**:

- The admin defines categories by age, belt and sex (in code: **divisions**; never say "division" in
  the Local UI).
- Each category has a kumite and a kata event (`division_events`); each event has **groups**. A group
  is an ordinary `categories` row, so everything from the draw onward is shared with Official.
- A **stager** takes a category at the venue (a hold) and builds its groups by hand: pins, swaps,
  shuffle, walk-ins, moves. Then they lock each group, which sends it to its tatami.
- Kumite groups are knockout brackets with their own podium. Kata groups are **ranked**: everyone
  performs once in pairs, marks decide.
- The admin changes groups after lock; there are results and visibility rules.

The full spec is a Claude Doc (owner's account): https://claude.ai/code/artifact/b179e4b9-0216-4c16-8f0c-73d8f633f17e
It is not in the repo (AGENTS.md forbids plan files).

**Working agreement with the owner:**
- Build one step at a time. After each step, stop, report and wait for "ok continue with step N".
- **Never start a step without that message.**
- Commit messages explain why, and carry **no** `Co-Authored-By` line (owner's explicit rule).

## 2. Plan: 9 steps (the owner's message called it 7 phases; it is 9)

| Step | What | State | Commit |
|---|---|---|---|
| 1 | Tournament type, migration 18, guards, settings switch, "Organiser's rules" rename | done | `e17362b`, `c037106` |
| 2 | Engine: `groupDraw`, `rankedKataDraw`, `fillBye` (pure, unit tested) | done | `14c7e09` |
| 3 | Admin setup: categories generator, roster import, plans, starting groups, tatami per category | done | `e5a9c53` |
| 4 | Staging core: holds, drafts, lock, start gate, `writeDrawGraph` shared | done | `864f2ec` |
| 5 | Stager desk and category workspace UI, admin Staging overview, undo | done | `231f77b` |
| 6 | Ranked kata scoring, tie-breaks, desk tie decision (migration 19), moderator queue labels | done | `e4ec971` |
| 7 | Admin unlock, changes after lock (add, remove, move, fill a bye, append, guest), walk-in review and merge | done | `52d2f42` |
| 8 | Results and visibility | **not started** | - |
| 9 | Seed a Local demo, QUICKSTART/README, mock event | **not started** | - |

**Nothing is in progress.**
- The worktree is clean apart from the untracked repo-root `.claude/`, which must never be committed.
- Step 7 was completed, tested and committed; its report was sent.
- The owner has **not** yet said "continue with step 8".

## 3. What to do next

1. Wait for the owner's go-ahead for step 8. Do not start it on your own.
2. **Step 8 scope** (from the spec):
   - **Podiums.** A `podiumFor(category)` core (`src/lib/results/podium.ts`):
     - kumite from `resolveDraw(...).podium`;
     - an Official kata flight from its medal bouts;
     - a ranked kata group from `loadRankedStandings` (`src/lib/kata/rankedGroup.ts`, final only when
       `final === true`).
     - Until a podium is final the group shows "In progress".
   - **Club medal tally** (`medalTally.ts`):
     - one row per club, keyed by `clubKey`;
     - columns gold, silver, bronze, total;
     - sorted by gold, then silver, then bronze; ties share a rank;
     - athletes with no club are listed individually as "Independent", never pooled.
   - **Exports.** Add both to `src/lib/results/resultsDataset.ts` and `src/actions/resultsExport.ts`:
     - CSV: `podiums.csv` and `medal-tally.csv`;
     - results PDF: a Podiums section and a Medal tally page.
   - **Public pages.**
     - Podiums per group when public results are on.
     - The tally is admin and organiser only.
     - A draft group shows "Being prepared" with no members.
     - Draft members must not leak through public search, `getCategoryDraw` or the public event page.
     - Athlete search lists an athlete's groups through `category_entries`.
     - `division_holds` and `group_drafts` stay off the public live feed.
   - **PDFs and scoreboard.**
     - A ranked kata group prints the kata pool sheet with one pool, and its scoreboard is the kata
       pool scoreboard.
     - Mark guests on moderator screens, public pages and PDFs (today only the staging views mark them).
   - **Suites:** `test-local-visibility.mjs` and `test-local-results.mjs`.
3. **Step 9 scope** (when approved):
   - `npm run db:seed` adds a small Local demo tournament next to the CISCE one.
   - Update `QUICKSTART.md` and the README commands.
   - Hands-on mock event: 3 tatamis, about 100 children, 15 categories, walk-ins, absentees, a late add
     into a running group, stager screens at 360 px.

## 4. Must not do

- **Do not touch 127.0.0.1:5432.** It is the owner's real WSL database: never seed, migrate, test or
  build against it. Use only the Docker container `ringflow-claude-test` on **127.0.0.1:55432**
  (`postgres://event_suite:event_suite@127.0.0.1:55432/ringflow`). `run-suite.sh` refuses 5432.
- **Never write `.env.local`**, and never kill the owner's dev server on **:3000**. Never write to their
  `.next/`; use `NEXT_DIST_DIR=.next-test`.
- **Never commit repo-root `.claude/`.**
- **Leave the old stash alone.** `stash@{0}` (from `feat/draws-overhaul`) is unrelated to this work.
- **Never edit an applied migration** (`migration18_local_tournaments.sql`, `migration19_kata_tie_decisions.sql`).
  Add a new one.
- **No `Co-Authored-By` lines.**
- **Never reset, revert or force-push this branch.**
- **Do not redo finished steps.** In particular, don't rebuild the group draw engine, the hold model,
  the staging actions or the ranked kata ranking. Extend them.

## 5. Decisions to keep

**Security and RBAC** (see AGENTS.md rules 1–10):
- Every exported action guards first, resolving the tournament from the target row:
  - `scopeForDivision`, `scopeForGroup` and `scopeForDivisionEvent` in `src/lib/auth/localScope.ts`;
  - `requireLocalTournament` and `requireOfficialTournament`;
  - `requireDivisionHolder` for draft changes;
  - `requireTournamentAdmin` for everything after lock and for walk-in review.
- About 24 Official-only actions call `requireOfficialTournament`.
- Holds store a SHA-256 of the normalized stager code (`hashStagerCode`), never the code. No code or
  hash is ever sent to a browser; the suites assert this.
- `division_holds`, `group_drafts` and `kata_tie_decisions` are on the staff live feed only.
- The organiser stays read-only.

**Model:**
- A group is a `categories` row with `division_event_id` and `group_no`. Kata groups use
  `kata_format='RANKED'` and the draw format `KATA_RANKED`.
- In Local groups the draw engine's `registrationId` is the athlete id.
- One group per athlete per event type, tournament-wide (home or guest). This is enforced in
  `lateChanges.ts` and by the partial unique index on `category_entries (division_event_id, athlete_id)`.
- Bout ids are deterministic (`matchIdFor(categoryId, matchNo)`), so a rebuilt draw reuses ids, and
  rebuilds clear `rings.current_match_id`.

**Lock and after lock:**
- Lock re-validates and stores exactly the previewed draw (same checksum).
- Only the admin changes a locked group. Every change:
  - needs a reason of at least 5 characters;
  - is previewed, and the confirm checks the preview's fingerprint;
  - writes a new draw version;
  - is audited (`GROUP_CHANGED_AFTER_LOCK`, `GROUP_UNLOCKED`).
- **Unlock** is allowed only before the first bout and not while the group is on the mat. Bouts are
  deleted; the `draws` row stays as a hidden `DRAFT` with its history.
- **Before the first bout:** the draw is rebuilt with everyone else pinned (`kumitePinCandidates`). A
  bracket that must grow or shrink is drawn again.
- **Under way:** only adds.
  - Kumite fills a bye whose holder hasn't fought on. The writes are incremental and
    `resyncBracket` undoes the walkover; fought bouts are never touched.
  - Kata appends a performer (`appendRankedPerformer`).
- Finished groups never change.
- **Guests:**
  - They go only into locked groups; a group with a guest can't be unlocked.
  - At home, a guest counts as placed (`guestsElsewhere` in `startingGroups.ts`).
- **Walk-in merge:**
  - The registered athlete keeps their record.
  - Where they compete comes from whichever of the two is in a group, else from the walk-in.
  - Refused if both are in groups, or if either has fought a bout or has kata marks.
- **Ranked kata:**
  - Order: total, then the higher lowest dropped mark, then the higher highest dropped mark.
  - Medals by position.
  - A medal tie waits for the moderator's desk decision (`kata_tie_decisions`, migration 19), and the
    group can't be finished while one is undecided.
  - DNP ranks last with no medal.
- **Audit labels:** every Local audit action has a label in `AUDIT_ACTION_LABELS` (`src/lib/audit.ts`).
  Add new ones there.

## 6. Where the code is

- **Cores:** `src/lib/local/`:
  - `rules`, `divisions`, `localRoster`, `startingGroups`, `tatami`, `setupView`;
  - `holds`, `groupBuild`, `groupDraft`, `stagingView`, `startGate`, `queueLabels`;
  - `lateChanges`, `lateChangePlan`, `walkIns`.
- **Ranked kata:** `src/lib/kata/ranking.ts`, `rankedGroup.ts`.
- **Engine:** `src/engine/draw-engine/groupDraw.ts`, `rankedKataDraw.ts`, `fillBye.ts`.
- **Actions:**
  - `src/actions/divisions.ts`: setup;
  - `localAthletes.ts`: roster, walk-in review;
  - `staging.ts`: desk, drafts, lock, holds, unlock, late changes;
  - `kata.ts`: ranked confirm, `resolveKataTie`, `getRankedStandings`.
- **Screens:**
  - `src/components/stager/local/` and its `workspace/` folder;
  - `src/components/admin/local/`;
  - `src/components/moderator/RankingPanel.tsx`.
- **Routes:**
  - `/stager/event/[id]` and `/stager/event/[id]/category/[divisionId]`;
  - `/admin/event/[id]/staging` and `/admin/event/[id]/staging/[divisionId]`.
- **Files changed on the branch:** 128 in total. List them with
  `git diff --name-status master...HEAD`. All were reviewed for this checkpoint; nothing unrelated.
- **Docs** are updated through step 7: roles, the role matrix, ARCHITECTURE, DISCIPLINES, PRD, AGENTS.md
  and `tests/http/README.md`.

## 7. Verification at this checkpoint (all passing)

Run from `RingFlow-CISCE/`:

| Command | Result |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| `npx eslint .` | 0 errors, 68 warnings (all from before this work) |
| `npx vitest run` | 30 files, 423 tests pass |
| `DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npm run test:db` | all pass (Local staging: 36 checks) |
| `NEXT_DIST_DIR=.next-test DATABASE_URL=<55432 url> OFFLINE_MODE=true npm run build` | success |
| HTTP suites (below) | 12 suites, 541/541 |

**HTTP suites.** They need the test server running (below). Then:
`export NEXT_DIST_DIR=.next-test && bash tests/http/run-suite.sh test-local-tournaments.mjs test-local-setup.mjs test-local-staging.mjs test-local-ranked.mjs test-local-late-changes.mjs test-access-control.mjs test-sessions.mjs test-audit.mjs test-attendance.mjs test-pool-split.mjs test-judge-panel.mjs test-live-feeds.mjs`

Results: tournaments 14, setup 49, staging 65, ranked 33, late-changes 90, access-control 103,
sessions 22, audit 19, attendance 17, pool-split 51, judge-panel 57, live-feeds 21.
`NEXT_DIST_DIR` is required; without it `rbac-lib` reads the owner's `.next`.

**Test server** (port 3100, isolated build folder):

```
cd RingFlow-CISCE
DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow OFFLINE_MODE=true NEXT_DIST_DIR=.next-test npx next dev -p 3100
```

- **The launch config won't carry over.** The untracked `.claude/launch.json` entry `ringflow-test`
  points at a launcher script in the old session's temporary folder. In a new session, recreate the
  entry with the command above.
- **The database container** may need `docker start ringflow-claude-test`.
- **Don't overlap heavy jobs.** Running tsc, lint or vitest alongside the suites can make the dev
  server restart on memory. If a suite is cut off, rerun it; it isn't a failure.

## 8. Known issues and traps

- **No failing tests or open errors.**
- **The empty `{}` reply.** An action posted to a route whose bundle doesn't include it returns `{}`,
  which loose "denied" checks count as a refusal.
  - The Local suites use `refused()` (rejects that reply) and `pastGate()` (a made-up session cookie,
    since the request gate only checks that a cookie is there).
  - The older Official suites still use the loose check and haven't been audited.
- **Stale dev routes.** After many edits, Turbopack sometimes returns 404 for a dynamic route (seen on
  `/staging/[divisionId]` and the stager workspace). Touching the page file fixes it; it isn't a code bug.
- **Guests are marked only in the staging views** (step 8 extends this).
- **Public visibility of Local groups hasn't been audited yet** (step 8). Draft groups have no bouts,
  so bracket views show nothing, but entry lists and public search haven't been checked.
- **Protection messages after an unlock.** `rebuildRefusal` (`startingGroups.ts`) and
  `divisionProtection` (`divisions.ts`) treat any draw row, including an unlocked `DRAFT`, as
  protected. They are conservative, but their messages say "locked".
- **Pins after an unlock.** After a late change, the group's draft has every athlete pinned, so an
  unlock shows them all pinned ("Clear pins" frees them). This is intended.
- **Stager undo** lives in the open page (listed in ARCHITECTURE's Known limitations).
- **Browser checks** (built-in pane):
  - `localhost:3100` carries a test-admin session; sign stagers in on `127.0.0.1:3100` instead.
  - At mobile width, coordinate clicks can miss; JS `.click()` is reliable.
