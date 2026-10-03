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
- Next only runs an action that is bundled into the page it's posted to, and cookies set by an action
  only stick on its own page. That's why calls often pass a page path.
- Login rate limits live in memory in the dev server, so restart it if a suite is throttled. Guessing
  loops send their own `X-Forwarded-For` so they don't throttle the other suites.
