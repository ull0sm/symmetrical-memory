#!/usr/bin/env bash
# Usage: run-suite.sh test-phaseN.mjs [...more suites]
# Seeds a fresh tournament in the throwaway test DB, warms every page so all
# server actions are compiled, then runs each suite against it. Exits non-zero
# if any check fails. See README.md in this folder.
set -u
SP="$(cd "$(dirname "$0")" && pwd)"
export APP_DIR="$(cd "$SP/../.." && (pwd -W 2>/dev/null || pwd))"
export DATABASE_URL="${TEST_DATABASE_URL:-postgres://event_suite:event_suite@127.0.0.1:55432/ringflow}"
export BASE="${BASE:-http://127.0.0.1:3100}"

# These suites seed data and hammer logins. Never let them near a real database.
case "$DATABASE_URL" in
  *:5432/*) echo "Refusing to run against port 5432 (a real database). Set TEST_DATABASE_URL to a throwaway one."; exit 2 ;;
esac

for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code}" "$BASE/login/admin" 2>/dev/null | grep -q 200 && break
  sleep 2
done

OUT=$(cd "$APP_DIR" && npm run db:seed 2>&1)
T=$(echo "$OUT" | grep "Tournament ID" | sed 's/.*: //' | tr -d '\r')
R=$(echo "$OUT" | grep "Moderator URL" | sed 's#.*/ring/##' | tr -d '\r')
echo "tournament $T ring $R"
if [ -z "$T" ]; then echo "$OUT" | grep -iE "error|fail" | head -20; exit 1; fi

for p in /login/admin /login/mod /login/organiser /login/stager /admin/create \
         /moderator/waiting/x /stager/waiting/x /organiser/waiting/x \
         "/public/event/$T" "/judge/ring/$R"; do
  curl -s -o /dev/null --max-time 180 "$BASE$p"
done
cd "$SP"
node warm.mjs "$T" "$R" > /dev/null 2>&1
# Record pages compile getAuditLog/getAuditFilterOptions.
node --input-type=module -e "
const {Jar,call,loadActions,BASE}=await import('./rbac-lib.mjs');
const A=loadActions(); const j=new Jar();
await call(A,'signInWithAdminPassword',[{email:'admin@ringflow.org',password:'admin123'}],j);
for (const p of ['/admin/event/$T/record','/organiser/event/$T/record']) await fetch(BASE+p,{headers:{Cookie:j.header()}});
" > /dev/null 2>&1

STATUS=0
for suite in "$@"; do
  echo "=== $suite"
  node "$suite" "$T" "$R" > "$SP/.last-run.log" 2>&1 || STATUS=1
  grep -E "FAIL|passed|Error" "$SP/.last-run.log" || true
done
exit $STATUS
