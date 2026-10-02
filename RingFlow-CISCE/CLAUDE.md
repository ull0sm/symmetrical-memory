# RingFlow — Claude Code Instructions

**Read first**: [../CLAUDE.md](../CLAUDE.md) (workspace quick start)  
**Full guide**: [AGENTS.md](AGENTS.md) (this folder's implementation guide)

---

## Start Here (Choose Your Task)

### "I'm adding a new feature"
1. What role does it affect? → Go to [docs/roles/ROLE.md](docs/roles/)
2. Where should the code go? → See [AGENTS.md § File Finder](AGENTS.md#-file-finder-by-task-type)
3. What guard do I need? → [AGENTS.md § Auth Quick Reference](AGENTS.md#-auth-quick-reference)
4. What's the pattern? → Copy example from `src/actions/`

### "I'm fixing a bug"
1. Is it in `src/actions/`? → Add a guard if missing
2. Is it in the schema? → Edit `src/db/schema/index.ts` and run `npm run db:push`
3. Is it type-related? → Check `src/lib/serializers.ts` or add types

### "I'm reviewing someone's PR"
1. Does the action have a guard? → Must call `requireXXX()` or `getXXX()`
2. Does it audit? → Must call `audit(...)` if it writes
3. Does it broadcast? → Must call `broadcastLiveEvent(...)` if it writes
4. Are types safe? → No `any`, use schema types

### "I'm reading the code"
1. **Entry point**: Server actions in `src/actions/*.ts`
2. **Database**: `src/db/schema/index.ts` (schema is the source of truth)
3. **Auth**: `src/lib/auth/guards.ts` (every action calls a guard)
4. **Business logic**: `src/lib/` (kata tally, match clock, draws, etc.)

---

## 🔑 Key Files by Role

### Admin Feature
- **Action file**: `src/actions/admin.ts`
- **Guard**: `requireAdmin()`
- **UI**: `src/app/admin/event/[id]/`
- **Doc**: [docs/roles/admin.md](docs/roles/admin.md)

### Moderator/Scoring Feature
- **Action file**: `src/actions/matches.ts` (kumite) or `src/actions/kata.ts` (kata)
- **Guard**: `requireMatchModerator(matchId)`
- **UI**: `src/app/moderator/ring/[ringId]/`
- **Doc**: [docs/roles/moderator.md](docs/roles/moderator.md)

### Judge Feature
- **Action file**: `src/actions/judge.ts` or `src/actions/judgePanel.ts`
- **Guard**: `requireJudge(ringId)`
- **UI**: `src/app/judge/ring/[ringId]/`
- **Doc**: [docs/roles/judge.md](docs/roles/judge.md)

### Public/Scoreboard Feature
- **Action file**: `src/actions/public.ts`
- **Guard**: None (gated by event settings)
- **UI**: `src/app/scoreboard/[ringId]/` or `src/app/public/event/[id]/`
- **Doc**: [docs/roles/public.md](docs/roles/public.md)

---

## 📋 Checklist Before Committing

- [ ] `npm run build` passes (types must be correct)
- [ ] If schema changed: `npm run db:push` and verified migration
- [ ] If action changed: has guard at top (`requireXXX()` or `getXXX()`)
- [ ] If writes data: calls `audit(...)` and `broadcastLiveEvent(...)`
- [ ] If complex logic: added unit test in `src/**/*.test.ts`
- [ ] If integrating: ran relevant `bash tests/http/run-suite.sh test-phaseN.mjs`
- [ ] Commit message explains **why** not what (git will show the what)

---

## 🆘 Quick Help

**"What's the schema?"**
→ `src/db/schema/index.ts` (read it, it's one file)

**"How do I add a table?"**
→ Edit `src/db/schema/index.ts`, run `npm run db:push`

**"How do I migrate data?"**
→ Create `supabase/migrations/migrationN_NAME.sql`, run `npm run db:migrate`

**"How do I verify the user?"**
→ Import guard, call it: `const admin = await requireAdmin();`

**"How do I log what someone did?"**
→ `await audit({ tournamentId, actor, action, targetType, targetId, before, after })`

**"How do I notify the screen?"**
→ `broadcastLiveEvent({ table, op, id, ringId, tournamentId })`

**"The schema changed, types are wrong"**
→ `npm run db:push` syncs types automatically

**"How do I test?"**
→ Unit: `npm test` | Integration: `bash tests/http/run-suite.sh test-phaseN.mjs`

---

## 🏗️ Architecture Map (3-Minute Version)

```
request (POST to /api/action/myAction)
  ↓
server action in src/actions/*.ts
  ↓
import guard from src/lib/auth/guards.ts
  ↓
guard verifies session from cookie + database
  ↓ (throws AuthError if not authorized)
action reads/writes database (src/db/schema/index.ts)
  ↓ (if writing)
call audit(...) for compliance
call broadcastLiveEvent(...) to notify screens
call revalidatePath(...) for static regen
  ↓
return { success: true, data } or { success: false, error }
  ↓
screen re-fetches via useLiveEvents hook
screen re-renders
```

---

## 📖 All Documentation

| What | Where |
|------|-------|
| System overview, phases, rules | [../AGENTS.md](../AGENTS.md) |
| Implementation guide, patterns, file finder | [AGENTS.md](AGENTS.md) |
| Admin workflows & features | [docs/roles/admin.md](docs/roles/admin.md) |
| Moderator scoring & controls | [docs/roles/moderator.md](docs/roles/moderator.md) |
| Judge voting & pairing | [docs/roles/judge.md](docs/roles/judge.md) |
| Organiser read-only views | [docs/roles/organiser.md](docs/roles/organiser.md) |
| Stager queue & attendance | [docs/roles/stager.md](docs/roles/stager.md) |
| Public & scoreboard gates | [docs/roles/public.md](docs/roles/public.md) |
| What's left to do | [docs/PLAN.md](docs/PLAN.md) |
| Setup, commands, history | [README.md](README.md) |

---

## 🎯 Common Patterns

**Guard + Validate + Write + Audit + Broadcast:**

```typescript
const moderator = await requireMatchModerator(matchId);
const params = parseInput(scoreSchema, input, "score");
await db.update(matches).set({ akaScore: params.akaScore }).where(...);
await audit({ tournamentId, ringId, matchId, actor, action: "MATCH_SCORED", after: match });
broadcastLiveEvent({ table: "matches", op: "UPDATE", matchId, ringId, tournamentId });
return { success: true };
```

---

**Last updated 2026-10-02. All 7 phases complete. Ready for tournament use.**
