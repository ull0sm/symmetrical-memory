# HTTP suites

These scripts call server actions over HTTP, the way a browser (or an attacker) would, against a
running dev server and a throwaway database. Unit tests (`npm test`) cover pure logic; these cover
authorization, sessions and the flows that need a database.

| Suite | Covers |
|---|---|
| `test-access-control.mjs` | Backdoors, tenancy, bout control, secrets on the live feed, request-id-as-credential, organiser read-only, cookies, public data |
| `test-sessions.mjs` | Hashed admin and staff sessions, logout, rate limits, input validation, staff-only PDFs |
| `test-audit.mjs` | Audit entries, corrections with reasons, official record access, accountable exports |
| `test-judge-panel.mjs` | Judge pairing and approval, seat ownership, the voting window, void and override, server totals |
| `test-live-feeds.mjs` | Public and staff live feeds, security headers, HSTS, tunnel isolation |
| `test-attendance.mjs` | Attendance permissions, the desk hint, staff-only visibility |
| `test-pool-split.mjs` | Splitting a category's pools across tatamis: who may split, which tatami may score which bout, finals waiting for pools, the balancing board leaving pools alone |
| `test-local-setup.mjs` | Local setup: settings, the category generator, the roster import and its report, chest numbers, starting groups (sizes, club spread, drafts, counts), a category's tatami, moves and participation, what a locked group or a hold protects, the organiser's read-only views, and who is refused (organiser, stager, another admin, Official tournaments, Official tools in a Local one) |
| `test-local-late-changes.mjs` | A Local group after lock: only the admin may unlock or change it (stager, moderator, organiser, visitor, another admin's group and an Official category refused); unlocking before the first bout and locking again; adding, taking out and moving athletes before it starts with everyone else in place, and a bracket that grows; a stale preview and a missing reason refused; a guest filling a bye in a group under way (the walkover undone, fought results kept), a bye whose holder fought on refused, a finished group refused; kata performers appended; walk-in review, correction and merge (refused once either has competed) |
| `test-local-results.mjs` | Local results: podiums of a kumite group and a ranked kata group ("In progress" until the medals stand), the club medal tally and its order, the podiums and tally CSVs and the results PDF, who may export them, the public podiums, and a ranked group's kata pool sheet |
| `test-local-visibility.mjs` | What the public sees of a Local tournament: a group being prepared by name only, search through entries, an athlete's link scoped to their own group, an unlocked group hidden again, guests marked, and the staging tables kept off the public live feed |
| `test-local-ranked.mjs` | A Local ranked kata group on the mat: the moderator queue's labels (waiting, being prepared, ready), confirming pairs with no winner, an athlete who didn't perform, the ranking and its tie-breaks, the desk decision on a medal tie (who may record it, and only once everyone has performed), and that the group can't be finished while a medal tie is undecided |
| `test-local-staging.mjs` | The Local stager desk: the screens, who may read the desk or take a category, the take race, one holder per category and one category per stager, drafts seen only by the holder (and the admin, read only), every change refused to anyone but the holder, stale views, undo, walk-ins, locking the shown draw, the admin's release and hand-on with reasons, a hold surviving a fresh sign-in, removing a code, and no stager code in any response |
| `test-local-tournaments.mjs` | Local tournaments: choosing the type at creation, switching it in settings only before anything is set up, who may switch it, and the database check on the type |

## Database checks (no server needed)
`npm run test:db` runs the draw guard, setup, manual-swap, kata-flow, pool-routing and Local staging checks
(holds, every draft change, locking a group, the start gate) straight against the database.
They write a throwaway tournament and refuse to run unless `DATABASE_URL` points at the isolated test database on port 55432:
```bash
DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npm run test:db
```

## Running
1. Start a **throwaway** Postgres. The suites seed data and hammer the logins:
   ```bash
   docker run -d --name ringflow-test -e POSTGRES_USER=event_suite -e POSTGRES_PASSWORD=event_suite -e POSTGRES_DB=ringflow -p 127.0.0.1:55432:5432 postgres:16-alpine
   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npm run db:push
   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npm run db:migrate
   ```
2. Start the dev server against it on port 3100:
   ```bash
   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow OFFLINE_MODE=true npx next dev -p 3100
   ```
   If your normal dev server is already running, give this one its own build folder (two servers
   cannot share `.next`) and pass the same value to the suites:
   ```bash
   export NEXT_DIST_DIR=.next-test
   ```
3. Run one or more suites. Each run seeds a fresh tournament first:
   ```bash
   bash tests/http/run-suite.sh test-judge-panel.mjs
   ```
   `TEST_DATABASE_URL` and `BASE` override the defaults above. The script refuses port 5432.

## How it works
- `rbac-lib.mjs` reads action ids from `.next/dev/server/server-reference-manifest.json`, so every page
  has to be compiled first. `run-suite.sh` and `warm.mjs` load them.
- An action answers only on routes whose bundle includes it. Posted to any other page, Next replies
  with an empty `{}`, which a loose "denied" check would count as a refusal. The Local suites use a
  `refused()` check that rejects that, and post to the action's own page. The request gate only looks
  for a session cookie, so to test an action's own guard for a caller the gate would turn away, they
  add a made-up cookie (`pastGate()`).
- Next only runs an action that is bundled into the page it's posted to, and cookies set by an action
  only stick on its own page. That's why calls often pass a page path.
- Login rate limits live in memory in the dev server, so restart it if a suite is throttled. Guessing
  loops send their own `X-Forwarded-For` so they don't throttle the other suites.
