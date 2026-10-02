# RingFlow Implementation Agent Guide

**Read first**: [../AGENTS.md](../AGENTS.md) (system-wide guide for all agents)  
**This file**: Deep implementation details, file locations, phase progress

---

## 📍 You Are Here

```
symmetrical-memory/
└── RingFlow-CISCE/              ← YOU ARE IN THIS FOLDER
    ├── AGENTS.md                ← This file (implementation details)
    ├── CLAUDE.md                ← Quick instructions
    ├── src/
    │   ├── actions/             ← Server logic (76 files × 7 phases)
    │   ├── app/                 ← UI routes per role
    │   ├── lib/                 ← Helpers & engines
    │   ├── components/          ← React components
    │   └── db/schema/index.ts   ← DATABASE SCHEMA (SINGLE FILE)
    ├── docs/
    │   ├── roles/               ← Per-role docs
    │   └── PLAN.md              ← Open work tracking
    ├── supabase/migrations/     ← Migration scripts
    └── tests/http/              ← Integration tests (one per phase)
```

---

## 🔍 File Finder (By Task Type)

### Adding/Editing Server Logic

| Task | Primary File | Related Files |
|------|-------------|---------------|
| Admin actions | `src/actions/admin.ts` | `src/lib/auth/guards.ts` (requireAdmin) |
| Category/draw logic | `src/actions/categories.ts`, `src/actions/draws.ts` | `src/actions/balancing.ts` |
| Bout scoring (kumite) | `src/actions/matches.ts` | `src/lib/bouts/results.ts` |
| Judge/kata voting | `src/actions/kata.ts`, `src/actions/judgePanel.ts` | `src/lib/kata/tally.ts`, `src/actions/judgeAuth.ts` |
| Moderator queue | `src/actions/moderator.ts` | `src/app/moderator/` pages |
| Results export | `src/actions/resultsExport.ts` | `src/lib/` helpers |
| Ring/tatami logic | `src/actions/rings.ts` | `src/lib/matchClock.ts` |
| Live feed events | `src/lib/realtime/bus.ts` | `/api/live`, `/api/live/staff` routes |
| Audit logging | `src/lib/audit.ts` | Every action that writes |

### Adding UI

| Role | Primary Folder | Guard | Layout File |
|------|---------------|-------|------------|
| Admin dashboard | `src/app/admin/event/[id]/` | `requireAdmin()` | `src/app/admin/event/[id]/layout.tsx` |
| Organiser view | `src/app/organiser/event/[id]/` | `getOrganiserPrincipal()` | `src/app/organiser/event/[id]/layout.tsx` |
| Stager controls | `src/app/stager/event/[id]/` | `getTournamentStaff()` | `src/app/stager/page.tsx` |
| Moderator console | `src/app/moderator/ring/[ringId]/` | `requireRingModerator()` | `src/app/moderator/ring/[ringId]/layout.tsx` |
| Judge phone | `src/app/judge/ring/[ringId]/` | `requireJudge()` | N/A (single page) |
| Public scoreboard | `src/app/scoreboard/[ringId]/` | None (gated by event settings) | N/A |
| Public event | `src/app/public/event/[id]/` | None | N/A |

### Schema & Database

| Task | File | Command |
|------|------|---------|
| Add table/field | `src/db/schema/index.ts` | `npm run db:push` |
| Data migration | `supabase/migrations/migrationN_*.sql` | `npm run db:migrate` |
| Inspect current schema | `src/db/schema/index.ts` | (just read it) |
| Seed demo data | `scripts/seed-realistic-tournament.ts` | `npm run db:seed` |
| Reset everything | `scripts/reset-and-seed-clean.ts` | `npm run db:reset` |

---

## 🛡️ Auth Quick Reference

### Guards (Import from `src/lib/auth/guards.ts`)

```typescript
// Admin tier
await requireAdmin()              // ✓ Authenticated admin
await requireTournamentAdmin(tid) // ✓ Admin for THIS tournament (tenancy)
await getTournamentAdmin(tid)     // ✓ Admin or null

// Staff tier (one per tournament)
await requireTournamentStaff(tid, allowed)  // ✓ Any approved staff
await getTournamentStaff(tid, allowed)      // ✓ Any staff or null

// Moderator/ring specific
await requireRingModerator(ringId)     // ✓ Moderator for THIS ring
await getRingModerator(ringId)         // ✓ Moderator or null
await requireMatchModerator(matchId)   // ✓ Moderator + bout scope
await requireRingOperator(ringId)      // ✓ Moderator OR tournament admin (override)

// Judge (seat-bound)
await requireJudge(ringId)    // ✓ Judge approved for THIS ring

// Organiser (read-only, same tournament)
await getOrganiserPrincipal()

// Helper
await hasAnyStaffIdentity()   // UX: show staff menu?
describePrincipal(p)          // Actor for audit (role, id, name)
```

### Session Lookup (Import from `src/lib/auth/principal.ts`)

```typescript
const principals = await getPrincipals()    // All identities in this cookie
const admin = await getAdminPrincipal()     // Admin or null
const judge = await getJudgePrincipal()     // Judge or null
const mod = await getModeratorPrincipal()   // Moderator or null
```

### Sessions Table

| Table | Fields | Verification |
|-------|--------|--------------|
| `admin_sessions` | `adminId`, `tokenHash`, `expiresAt`, `ip`, `userAgent` | Hash-verified, expiry checked |
| `judge_sessions` | `ringId`, `seat`, `tokenHash`, `status`, `claimHash`, `expiresAt` | Hash-verified, expiry checked, seat-bound, partial unique index (one per seat) |
| `moderator_requests` | `ringId`, `sessionTokenHash`, `status`, `claimHash`, `expiresAt` | Hash-verified, status=approved, expiry checked |
| `organiser_requests` | `tournamentId`, `sessionTokenHash`, `status`, `claimHash`, `expiresAt` | Hash-verified, status=approved |
| `stager_requests` | `tournamentId`, `sessionTokenHash`, `status`, `claimHash`, `expiresAt` | Hash-verified, status=approved |

---

## 🗄️ Schema Structure (src/db/schema/index.ts)

The schema file is organized in sections:

### Section 1: Core Tournament Tables
- `admins`, `admin_sessions`, `tournaments`, `rings`, `categories`, `athletes`, `categoryAssignments`
- `matches`, `matchSlots`, `kataScores`, `matchEvents`
- `moderator_requests`, `organiser_requests`, `stager_requests`, `judge_sessions`, `judge_rackets` (old, deprecated)

### Section 2: Decoupled Registration & Setup
- `tournament_category_definitions`, `tournament_registrations`, `category_attendance`, `category_entries`
- `category_documents` (PDF storage, no Supabase)

### Section 3: Draws & Matches
- `draws`, `drawBrackets`, `drawMatchCopies`

### Section 4: Audit & Logs
- `audit_log` (append-only, trigger prevents UPDATE)
- `event_log` (legacy, being replaced by audit_log)

**Key Field Naming**:
- Database: `snake_case` (e.g., `ring_id`, `judge_pin`)
- Drizzle exported: camelCase (e.g., `ringId`, `judgePi`)
- Always use Drizzle exports, never raw SQL

---

## 📦 Realtime & Broadcasting (src/lib/realtime/bus.ts)

### When to Broadcast

**Every write operation** must broadcast:
```typescript
import { broadcastLiveEvent } from "@/lib/realtime/bus";

// Syntax
broadcastLiveEvent({
  table: "matches" | "rings" | "categories" | ... (see schema tables),
  op: "INSERT" | "UPDATE" | "DELETE",
  id: rowId,
  matchId?: matchId,
  ringId?: ringId,
  tournamentId?: tournamentId,
  categoryId?: categoryId,
  status?: status, // for *_requests tables
});
```

### Who Listens

- **Moderator pad**: `useLiveEvents({ feed: "staff", ringId }, refetch)`
- **Admin dashboard**: `useLiveEvents({ feed: "staff", tournamentId }, refetch)`
- **Public scoreboard**: `useLiveEvents({ ringId }, refetch)` (public feed only)

### Secrets Never Leave DB
- Never broadcast: session tokens, claim hashes, judge PINs, device tokens
- Only broadcast: `status`, `id`, structural IDs (`ringId`, `tournamentId`, etc.)
- See `src/lib/serializers.ts` for safe response formatting

---

## 📝 Audit Logging (src/lib/audit.ts)

**Every change to scores, results, approvals, draws** needs an audit entry:

```typescript
import { audit } from "@/lib/audit";

await audit({
  tournamentId,     // Required
  ringId,           // Required
  categoryId,       // Optional
  matchId,          // Optional
  actor: {          // describePrincipal(principal)
    role: "moderator" | "admin" | "stager" | "organiser" | "judge",
    id: principalId,
    name: principalName,
  },
  action: "MATCH_SCORED" | "RESULT_FINALIZED" | ... (free text, ~30 chars),
  targetType: "match" | "draw" | "entry" | ... (free text),
  targetId: rowId,
  before: oldValues,   // Optional (JSON)
  after: newValues,    // Optional (JSON)
  reason: "Appeals", // Optional
});
```

Table: `audit_log` (append-only, trigger prevents UPDATE/DELETE on rows, cascade on tournament delete only)

---

## 🧪 Testing Patterns

### Unit Test (vitest, src/**/*.test.ts)

```typescript
import { describe, it, expect, beforeEach } from "vitest";

describe("calculateKataTally", () => {
  it("sums judge flags correctly", () => {
    const result = calculateKataTally(scores);
    expect(result.akaFlags).toBe(4);
  });
});
```

### Integration Test (HTTP, tests/http/test-phaseN.mjs)

```javascript
import { test } from "./harness.mjs"; // Seeds DB, starts dev server

test("Moderator scores a kumite bout", async () => {
  const res = await POST("/api/action/scoreMatch", {
    matchId: "...",
    akaScore: 3,
    moderatorToken: "...",
  });
  expect(res.success).toBe(true);
  expect(res.matchStatus).toBe("COMPLETED");
});
```

**Run**: `bash tests/http/run-suite.sh test-phase4.mjs`

---

## 🚨 Phase-by-Phase Bug History

### Phase 1: `judgeRequests` Import Error (FIXED)
- **Bug**: `src/actions/kata.ts` imported non-existent `judgeRequests` table
- **Fix**: Changed to correct table name (which got added in Phase 2)
- **Lesson**: Phases build on each other; Phase 1 auth code assumes Phase 2 schema

### Phase 2: Schema Expansion (COMPLETE)
- Added `judgeRequests` table for judge approval flow
- Added hashed session tokens (`sessionTokenHash` on all `*_requests` tables)
- Added `category_documents` table (Postgres storage, no Supabase)

### Phases 3-7: No Critical Bugs Detected
- Consistent schema usage
- Proper guard placement in all actions
- Type safety improvements throughout

---

## 🎯 Quick Wins (Easy Tasks for New Contributors)

1. **Add a status check**: Edit `src/lib/statuses.ts`, update schema status columns
2. **New serializer**: Add type-safe response in `src/lib/serializers.ts`
3. **Audit a missing action**: Find action in `src/actions/`, add `audit()` call
4. **Fix a typo in docs**: Edit `docs/roles/*.md`
5. **Add a test case**: Create `src/actions/newFeature.test.ts` with vitest
6. **Extract a helper**: Create `src/lib/newHelper.ts` and import in actions
7. **Update PLAN.md**: Track what you're working on in `docs/PLAN.md`

---

## 💾 State Management

**No Redux, Zustand, or Jotai.** Instead:

- **Server state**: Database (source of truth)
- **Client cache**: React Query / SWR (via `useLiveEvents`)
- **Form state**: React hook `useFormState()` (Next.js 15+)
- **UI state**: React hooks (`useState`)

**Pattern**:
1. Action writes to DB
2. Action calls `broadcastLiveEvent()`
3. Client re-fetches via `useLiveEvents()` hook
4. Component re-renders

---

## 🔗 Dependency Graph

```
src/lib/auth/
  ├─ guards.ts          (exports all guard functions)
  ├─ principal.ts       (session lookup)
  ├─ claims.ts          (browser claim binding)
  ├─ cookies.ts         (httpOnly management)
  └─ errors.ts          (AuthError)

src/lib/
  ├─ audit.ts           (append-only logging)
  ├─ realtime/bus.ts    (live event broadcast)
  ├─ serializers.ts     (type-safe responses)
  ├─ kafka/
  ├─ draws/
  ├─ kata/              (tally, scoring)
  └─ ... (other helpers)

src/actions/
  ├─ *.ts               (all import guards + audit + broadcast)
  └─ (every export needs a guard)

src/db/
  └─ schema/index.ts    (SINGLE SOURCE OF TRUTH)
```

**Golden Rule**: Always import guards at the top of your action.

---

## 🛠️ Common Patterns

### Pattern: Protected Action with Validation

```typescript
"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { parseInput } from "@/lib/validation";
import { z } from "zod";
import { db } from "@/db";
import { tournaments } from "@/db/schema";

const createTournamentSchema = z.object({
  name: z.string().min(1).max(100),
  eventDate: z.string().date().optional(),
});

export async function createTournament(input: z.input<typeof createTournamentSchema>) {
  const admin = await requireAdmin(); // GUARD FIRST
  const params = parseInput(createTournamentSchema, input, "create tournament"); // VALIDATE

  const [tournament] = await db
    .insert(tournaments)
    .values({
      adminId: admin.adminId,
      name: params.name,
      eventDate: params.eventDate,
    })
    .returning();

  await audit({
    tournamentId: tournament.id,
    ringId: null,
    actor: describePrincipal(admin),
    action: "TOURNAMENT_CREATED",
    targetType: "tournament",
    targetId: tournament.id,
    after: tournament,
  });

  broadcastLiveEvent({ table: "tournaments", op: "INSERT", id: tournament.id, tournamentId: tournament.id });
  revalidatePath("/admin");

  return { success: true, tournament };
}
```

### Pattern: Query with Permission Check

```typescript
export async function getTournamentDetails(tournamentId: string) {
  const admin = await getTournamentAdmin(tournamentId); // Check tenancy
  if (!admin) {
    return { success: false, error: "Tournament not found or not yours" };
  }

  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  return { success: true, tournament };
}
```

### Pattern: Judge Seat Validation

```typescript
export async function approveJudge(ringId: string, seat: number) {
  const mod = await requireRingModerator(ringId);
  
  if (seat < 1 || seat > 7) {
    return { success: false, error: "Judge seat must be 1-7" };
  }

  // Approve: insert into judge_sessions with status='approved'
  // Old one on same ring/seat is revoked (enforced by unique partial index)
}
```

---

## 📊 Database Diagram (Simplified)

```
admins
  ├─ admin_sessions (one-to-many)
  │   └─ tokenHash (verified per request)
  └─ tournaments (one-to-many)
      ├─ rings
      │   ├─ categoryAssignments (queue)
      │   ├─ moderator_requests / judge_sessions
      │   └─ matches
      │       ├─ matchSlots (aka/ao athletes)
      │       └─ kataScores (judge votes)
      ├─ categories
      │   ├─ athletes
      │   ├─ categoryEntries
      │   ├─ draws
      │   └─ category_documents (PDF storage)
      ├─ organiser_requests
      ├─ stager_requests
      └─ audit_log (append-only)
```

---

## 🎓 Study Order for New Agents

1. Read **[../AGENTS.md](../AGENTS.md)** (system overview)
2. Read **this file** (you are here)
3. Read **[docs/roles/YOUR_ROLE.md](docs/roles/)** (workflow for your task)
4. Read **[docs/PLAN.md](docs/PLAN.md)** (what's left to do)
5. Find example in **[src/actions/](src/actions/)** (copy the pattern)
6. Run **`npm run build`** (verify types)
7. Write test in **[tests/http/](tests/http/)** (integration test)
8. Submit PR with commit message attribution

---

**Last Updated**: 2026-10-02 | **Schema Version**: Phase 7 | **Test Coverage**: Phases 1-7 complete
