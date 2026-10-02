# RingFlow — Complete Agent & Development Guide

**Latest Update**: 2026-10-02 (Phase 7 quality improvements complete)

> This guide helps any agent understand the RingFlow codebase, its architecture, phases, and how to work on features efficiently.

---

## 🎯 Quick Start for Agents

1. **Understand the system**: Read [System Architecture](#-system-architecture) below
2. **Know the phases**: Review [Development Phases](#-development-phases) to see what's complete
3. **Pick your area**: Go to the relevant role doc in [Workspace Structure](#-workspace-structure)
4. **Find the code**: Use the file paths in the role docs to navigate directly
5. **Verify guards**: Every server action must call a guard from `src/lib/auth/guards.ts`

---

## 📁 Workspace Structure

```
symmetrical-memory/
├── AGENTS.md                    ← You are here (workspace guide)
├── CLAUDE.md                    ← Points to this file
├── RingFlow-CISCE/              ← THE LIVE APP (only thing that matters)
│   ├── AGENTS.md                ← RingFlow-specific agent guide
│   ├── CLAUDE.md                ← RingFlow-specific instructions
│   ├── src/
│   │   ├── actions/             ← All server logic (ENTRY POINT)
│   │   ├── app/<role>/          ← UI per role (admin, organiser, stager, moderator, judge, public, scoreboard)
│   │   ├── components/          ← Shared React components
│   │   ├── db/schema/           ← Drizzle schema (single file, SINGLE SOURCE OF TRUTH)
│   │   ├── lib/auth/            ← Authentication & authorization (critical)
│   │   ├── lib/kata/            ← Kata scoring logic
│   │   └── lib/                 ← Helpers (audit, realtime, serializers, etc.)
│   ├── db/migrations/           ← Legacy migrations (history)
│   ├── supabase/migrations/     ← Current migrations (migration9_security_hardening.sql, migration10_sessions...)
│   ├── docs/
│   │   ├── roles/               ← One file per role (admin.md, organiser.md, etc.)
│   │   └── PLAN.md              ← Open work tracking
│   └── tests/
│       └── http/                ← Integration tests per phase (test-phase1.mjs, etc.)
├── silver-meme/                 ← 🚫 DEAD (earlier prototype, ignore)
└── skills-mds/                  ← Reference docs for agents
```

**Golden Rule**: Only `RingFlow-CISCE/` is live. Never read/edit `silver-meme/`.

---

## 🏗️ System Architecture

### Tech Stack
- **Framework**: Next.js 16 (App Router, Server Actions)
- **UI**: React 19, TypeScript, Tailwind v4
- **Database**: PostgreSQL 16 (Drizzle ORM, single schema file)
- **Auth**: No external provider. Session tokens in httpOnly cookies, sha256 hashes in Postgres
- **Realtime**: SSE (`/api/live` for public, `/api/live/staff` for staff-only) fed by Postgres `LISTEN/NOTIFY`
- **Tools**: pdf-lib, xlsx, zod for validation

### Request Flow
1. **Browser** sends POST to a server action
2. **Action** imports & calls a guard (e.g., `requireAdmin()`, `requireMatchModerator(matchId)`)
3. **Guard** verifies caller from session cookies & database
4. **Guard throws** `AuthError` if not authorized (page layout catches & redirects)
5. **Action** reads/writes database
6. **Action** calls `broadcastLiveEvent(...)` to notify subscribed screens
7. **Action** calls `revalidatePath(...)` for static regeneration

### Auth Model
- **Admin**: Email + password → `admin_sessions` table (token hash only)
- **Staff** (organiser, stager, moderator): PIN + browser claim secret → approval → session token
- **Judge**: Tatami PIN + device token → approval → judge session (seat-bound)
- **Public/Scoreboard**: No auth (read-only, gate controlled by event settings)

**Key**: Every identity is re-verified on every request (no persistent sessions outside the DB).

---

## 🚀 Development Phases

| Phase | Status | What | Key Files | Commits |
|-------|--------|------|-----------|---------|
| **1** | ✅ COMPLETE | RBAC hardening, guards, secure auth | `src/lib/auth/guards.ts`, `src/lib/auth/principal.ts`, `src/actions/auth.ts`, `migration9_security_hardening.sql` | 1375dae (phase1 security base) |
| **2** | ✅ COMPLETE | Hashed sessions, remove Supabase, validation | `src/lib/validation.ts`, `src/lib/auth/cookies.ts`, `migration10_sessions_and_documents.sql` | e4795d3 (phase2 auth layer) |
| **3** | ✅ COMPLETE | Audit logging, correction UI | `src/lib/audit.ts`, `src/db/schema/auditLog`, `docs/roles/` per-role docs | 1375dae (phase3 audit log) |
| **4** | ✅ COMPLETE | Judge panel redesign, pairing, approval, voting window | `src/actions/judgePanel.ts`, `src/actions/judgeAuth.ts`, `judgeSessions` table | 7773f36 (phase4 judge panel) |
| **5** | ✅ COMPLETE | Online-ready: env validation, APP_URL, headers, split feeds | `src/lib/env.ts`, `/api/live` & `/api/live/staff` separation, `docs/DEPLOYMENT.md` | 8b813a0 (phase5 online) |
| **6** | ✅ COMPLETE | Optional call-area attendance tracking | `categoryAttendance` table, `src/actions/attendance.ts` | daee348 (phase6 attendance) |
| **7** | ✅ COMPLETE | Type safety, serializers, migration consolidation | `src/lib/serializers.ts`, proper types on all actions, schema consistency | 647b356 (phase7 quality) |

---

## 🔐 Non-Negotiable Rules

**Every agent MUST follow these** or things break:

1. **Every server action authorizes itself.**
   - Page guards, `readOnly` props, middleware do NOT protect (anyone can POST to `/api/action`)
   - Resolve the tournament (ring → category → tournament) and call appropriate guard
   - Example: `const moderator = await requireMatchModerator(matchId);`

2. **Tenancy enforcement.**
   - Admins only touch tournaments where `tournaments.admin_id = their_id`
   - Never trust a `tournamentId` parameter; always verify the row belongs to it

3. **Never send secrets to clients or live feed.**
   - No session tokens, request IDs, judge PINs, device tokens
   - Live feed carries only: `{ table, op, id, ringId, tournamentId, categoryId, matchId, status }`

4. **Organiser is read-only.**
   - No write paths for organiser role
   - If you add one, the design is wrong

5. **One running category per tatami, one approved moderator per tatami.**
   - Approving a new moderator revokes the old one (enforced by `judgeSessions` unique partial index)

6. **Audit what officials do.**
   - Any action that changes scores, results, draws, approvals, queue → audit entry
   - Use `src/lib/audit.ts` (it's in every action that writes)

7. **Offline + online deployment.**
   - No external API calls (Turnstile is optional, bypassed when `OFFLINE_MODE=true`)
   - Check `src/lib/env.ts` for deployment mode detection

8. **Draw sheets & PDFs are internal staff docs.**
   - Never public downloads

---

## 📚 Role Documentation

For detailed workflows, permissions, and known gaps per role, see `RingFlow-CISCE/docs/roles/`:

- **[admin.md](RingFlow-CISCE/docs/roles/admin.md)** — Tournament owner, creates staff, settings, audit viewer
- **[organiser.md](RingFlow-CISCE/docs/roles/organiser.md)** — Read-only event viewer (draws, results, categories)
- **[stager.md](RingFlow-CISCE/docs/roles/stager.md)** — Marks categories calling/ready, optional attendance
- **[moderator.md](RingFlow-CISCE/docs/roles/moderator.md)** — Runs one tatami, scores kumite bouts, opens kata voting
- **[judge.md](RingFlow-CISCE/docs/roles/judge.md)** — Votes on kata bouts from phone (seat-bound), moderator approval
- **[public.md](RingFlow-CISCE/docs/roles/public.md)** — Event draws & scoreboard (if enabled), no auth
- **[stager.md](RingFlow-CISCE/docs/roles/stager.md)** — Attendance helper (optional, per-category)

Each role doc includes:
- What they see (page tree)
- What they can do (permissions matrix)
- How they authenticate
- Key files they touch
- Known gaps / future work

---

## 🔧 Common Tasks for Agents

### "I need to add a new admin action"

1. Open `RingFlow-CISCE/src/actions/admin.ts` (or create new file)
2. Start with a guard: `const admin = await requireAdmin();`
3. Write your logic
4. If you write: call `audit(...)` and `broadcastLiveEvent(...)` and `revalidatePath(...)`
5. Return `{ success: true }` or `{ success: false, error: "..." }`
6. Validate inputs with zod (example in `src/lib/validation.ts`)

### "I need to add a new field to the database"

1. Edit `RingFlow-CISCE/src/db/schema/index.ts` (single file, SINGLE SOURCE OF TRUTH)
2. Run `npm run db:push` to apply the schema change
3. If you need a migration script: create `RingFlow-CISCE/supabase/migrations/migrationN_*.sql`
4. Run `npm run db:migrate` to apply it
5. Never edit migrations by hand after they're run (they're history; new changes go in the schema)

### "The schema changed but my TypeScript doesn't know"

1. Check `src/db/schema/index.ts` — is your field there?
2. Re-run `npm run db:push` to sync
3. TypeScript will auto-detect changes (Drizzle types are generated from schema)

### "I need to verify a judge can vote on this bout"

```typescript
import { requireJudge } from "@/lib/auth/guards";

const judge = await requireJudge(ringId);
// judge.seat is 1-7, judge.ringId, judge.tournamentId
// throws AuthError if not approved for this ring
```

### "I need to log what an official did"

```typescript
import { audit } from "@/lib/audit";

await audit({
  tournamentId,
  ringId,
  categoryId,
  matchId,
  actor: describePrincipal(moderator), // role, id, name
  action: "SCORE_ENTERED",            // action name
  targetType: "match",
  targetId: matchId,
  before: oldValues,
  after: newValues,
});
```

### "I need to notify a screen of a change"

```typescript
import { broadcastLiveEvent } from "@/lib/realtime/bus";

broadcastLiveEvent({
  table: "matches",
  op: "UPDATE",
  id: matchId,
  matchId,
  ringId,                    // so screens watching ringId get the update
  tournamentId,              // so admin/organiser watching tournamentId get it
});
```

---

## 🧪 Testing

### Unit Tests
```bash
npm test
```
- Location: `src/**/*.test.ts` (vitest)
- Covers: engines, kata tally, auth guards (with DB mocked), status lists, env

### Integration Tests (HTTP)
```bash
bash tests/http/run-suite.sh test-phase4.mjs
```
- Location: `tests/http/test-phaseN.mjs` (one per phase)
- Calls server actions like a browser would against a running dev server
- Never run against real database; it seeds a fresh one

**Golden Rule**: TypeScript build gate (`npm run build`) must pass. That's the real CI gate.

---

## 🗂️ Key Files to Know

| File | What | Why Important |
|------|------|---------------|
| `src/lib/auth/guards.ts` | All authorization checks | Every action calls one |
| `src/lib/auth/principal.ts` | "Who is calling" (principals) | Session lookup & verification |
| `src/lib/auth/cookies.ts` | Session cookie management | Secure httpOnly, protocol-aware |
| `src/lib/auth/claims.ts` | Browser claim binding for access requests | Prevents request hijacking |
| `src/db/schema/index.ts` | Entire Postgres schema | SINGLE SOURCE OF TRUTH |
| `src/actions/*.ts` | All server-side logic | Every export is a public endpoint |
| `src/lib/audit.ts` | Append-only audit logging | Compliance, disputes, debugging |
| `src/lib/realtime/bus.ts` | Live event broadcasting | Screens stay in sync |
| `src/lib/kata/tally.ts` | Kata scoring calculation | Judge votes → winner |
| `src/lib/serializers.ts` | Type-safe response formatting | Never send secrets by accident |
| `supabase/migrations/` | SQL migrations | Idempotent; newer = higher number |
| `docs/roles/` | Per-role workflows & permissions | Reference before adding features |

---

## ⚡ Fast Lookup by Task

**"I'm adding X. Where do I look?"**

| What | Where | Guard | Migration? |
|------|-------|-------|-----------|
| New admin endpoint | `src/actions/admin.ts` | `requireAdmin()` | Maybe (if schema change) |
| New moderator feature | `src/actions/moderator.ts` | `requireMatchModerator(matchId)` | Maybe |
| New judge flow | `src/actions/judge.ts` or `judgePanel.ts` | `requireJudge(ringId)` | Maybe |
| New organiser read | `src/actions/organiser.ts` | `getOrganiserPrincipal()` | No |
| New UI for role X | `src/app/<role>/...` | Guard in parent layout or action | No |
| New table | `src/db/schema/index.ts` | N/A | Yes (run `db:push`) |
| Fix a type error | `src/lib/serializers.ts` or schema | N/A | No (TypeScript only) |
| New realtime event | Call `broadcastLiveEvent(...)` in action | N/A | No |
| New audit entry | Call `audit(...)` in action | N/A | No |

---

## 🚨 Common Mistakes (Don't Do These)

❌ **Trust a `tournamentId` parameter**  
→ Always verify the resource (ring, category, match) belongs to it

❌ **Skip guards**  
→ Page guards don't protect actions; only server-side guards do

❌ **Write empty `catch {}` blocks**  
→ Log or handle the error

❌ **Use `any` types in new code**  
→ TypeScript will guide you

❌ **Add Supabase or external API calls**  
→ Breaks offline mode; use only Postgres & in-memory state

❌ **Change a migration after it's been run**  
→ Migrations are history; new changes go in the schema or a new migration file

❌ **Send session tokens or PINs to the client**  
→ Check `publicScore()` in `src/actions/kata.ts` for example (removes secrets)

❌ **Trust `NODE_ENV` for protocol detection**  
→ Use `isHttpsRequest()` from `src/lib/auth/cookies.ts`

❌ **Assume judges are stateless**  
→ Judges have approved sessions bound to rings and seats

---

## 📞 Getting Help

- **"What can role X do?"** → `docs/roles/X.md`
- **"How do I verify the caller?"** → `src/lib/auth/guards.ts` + read `principal.ts`
- **"What's the schema?"** → `src/db/schema/index.ts` (single file)
- **"How do I test?"** → `tests/http/README.md` + run `bash tests/http/run-suite.sh test-phaseN.mjs`
- **"What's not done yet?"** → `docs/PLAN.md` (tracks open work)

---

## 📋 Commands at a Glance

```bash
# Development
npm run dev              # Dev server on 0.0.0.0:3000
npm run build            # Production build + typecheck (CI gate)
npm run lint             # ESLint check
npm test                 # Unit tests (vitest)

# Database
npm run db:push          # Apply schema to DB (drizzle-kit)
npm run db:migrate       # Apply migration scripts (idempotent)
npm run db:seed          # Realistic demo tournament
npm run db:reset         # Wipe + clean seed

# Admin CLI
npm run db:create-admin -- --email=a@b.c --password=... --name="..."

# Integration tests
bash tests/http/run-suite.sh test-phase4.mjs

# Local Postgres
docker compose up -d db  # Start container (env from .env)
```

---

## 🎓 Learning Path for New Agents

1. **First 10 min**: Read this file (you're doing it!)
2. **Next 15 min**: Read the role doc for your task (`docs/roles/X.md`)
3. **Next 5 min**: Find example code in `src/actions/` for your role
4. **Start coding**: Copy the pattern, update for your feature
5. **Before PR**: 
   - Run `npm run build` (must pass)
   - Run `npm test` (coverage for new logic)
   - Run `bash tests/http/run-suite.sh test-phaseN.mjs` (one integration test)

---

**Last Updated**: 2026-10-02 | **Phases Complete**: 7/7 | **Status**: Stable, well-tested, ready for tournament use.
