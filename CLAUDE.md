# Claude Code — Quick Start

**Main Agent Guide**: [AGENTS.md](AGENTS.md)  
**Live App Documentation**: [RingFlow-CISCE/AGENTS.md](RingFlow-CISCE/AGENTS.md)

---

## 🚀 Quick Start (30 seconds)

1. **What are you working on?** → Go to [AGENTS.md](AGENTS.md)
2. **Need to find a file?** → Use the "File Finder" table in [RingFlow-CISCE/AGENTS.md](RingFlow-CISCE/AGENTS.md)
3. **Which guard should I use?** → [RingFlow-CISCE/AGENTS.md § Auth Quick Reference](RingFlow-CISCE/AGENTS.md#-auth-quick-reference)
4. **How do I test?** → [AGENTS.md § Testing](AGENTS.md#-testing)
5. **Where do I put my code?** → [RingFlow-CISCE/AGENTS.md § File Finder](RingFlow-CISCE/AGENTS.md#-file-finder-by-task-type)

---

## 📚 Documentation Files

| File | Purpose | For Whom |
|------|---------|----------|
| **[AGENTS.md](AGENTS.md)** | System overview, phases, non-negotiable rules | All agents (start here) |
| **[RingFlow-CISCE/AGENTS.md](RingFlow-CISCE/AGENTS.md)** | Implementation guide, file finder, patterns | Agents writing code |
| **[RingFlow-CISCE/docs/roles/admin.md](RingFlow-CISCE/docs/roles/admin.md)** | Admin role workflow & permissions | Agents working on admin features |
| **[RingFlow-CISCE/docs/roles/moderator.md](RingFlow-CISCE/docs/roles/moderator.md)** | Moderator workflow & permissions | Agents working on moderator/scoring |
| **[RingFlow-CISCE/docs/roles/judge.md](RingFlow-CISCE/docs/roles/judge.md)** | Judge workflow & permissions | Agents working on judge/voting |
| **[RingFlow-CISCE/docs/roles/organiser.md](RingFlow-CISCE/docs/roles/organiser.md)** | Organiser workflow (read-only) | Agents working on organiser views |
| **[RingFlow-CISCE/docs/roles/stager.md](RingFlow-CISCE/docs/roles/stager.md)** | Stager workflow & permissions | Agents working on category queue |
| **[RingFlow-CISCE/docs/PLAN.md](RingFlow-CISCE/docs/PLAN.md)** | Open work, known gaps, TODOs | Agents finding next tasks |
| **[RingFlow-CISCE/README.md](RingFlow-CISCE/README.md)** | Project history, setup, commands | Agents new to the codebase |

---

## ⚡ Common Questions

**Q: Where's the database schema?**  
A: `RingFlow-CISCE/src/db/schema/index.ts` (single file, SINGLE SOURCE OF TRUTH)

**Q: How do I know what a role can do?**  
A: Read the role doc: `RingFlow-CISCE/docs/roles/YOUR_ROLE.md`

**Q: Do I need to verify the caller in my action?**  
A: Yes. Import a guard from `src/lib/auth/guards.ts` as your first line.

**Q: What tables exist?**  
A: See [RingFlow-CISCE/AGENTS.md § Schema Structure](RingFlow-CISCE/AGENTS.md#-schema-structure-srcdbschemainndexts)

**Q: How do I log what an admin did?**  
A: Call `audit(...)` from `src/lib/audit.ts` (example in [AGENTS.md § Audit](AGENTS.md#-audit-logging-srclibaudits))

**Q: How do live screens get notified?**  
A: Call `broadcastLiveEvent(...)` after every write (example in [AGENTS.md § Broadcasting](AGENTS.md#-realtime--broadcasting-srclibreaaltimebusts))

**Q: Can I call an external API?**  
A: No (breaks offline mode). Only Postgres + in-memory state.

**Q: What's the difference between phases 1-7?**  
A: See [AGENTS.md § Development Phases](AGENTS.md#-development-phases) table.

**Q: Is `silver-meme/` still used?**  
A: No. Never read/edit it. It's dead.

---

## 🎓 How to Work Efficiently

1. **Read the relevant role doc first** (e.g., if adding admin features, read `docs/roles/admin.md`)
2. **Find an example in `src/actions/`** for that role
3. **Copy the pattern**: guard → validate → write → audit → broadcast → return
4. **Check the schema** (`src/db/schema/index.ts`) for tables/fields
5. **Run `npm run build`** to verify types
6. **Write a test** if logic is complex (see `tests/http/`)
7. **Commit** with proper attribution (see AGENTS.md)

---

## 📋 Commands

```bash
npm run dev              # Start dev server (0.0.0.0:3000)
npm run build            # Build + type-check (CI gate)
npm run lint             # ESLint
npm test                 # Unit tests (vitest)
npm run db:push          # Apply schema changes to database
npm run db:seed          # Seed demo tournament
npm run db:reset         # Wipe + reseed
bash tests/http/run-suite.sh test-phase4.mjs  # Run integration tests
docker compose up -d db  # Start local Postgres (needs .env)
```

---

## 🚫 Don't Do These

- ❌ Skip guards in server actions
- ❌ Trust a `tournamentId` parameter without verifying the row belongs to it
- ❌ Send session tokens, PINs, or secrets to the client
- ❌ Use `any` types
- ❌ Call external APIs
- ❌ Edit migrations after they're run
- ❌ Assume judges are stateless
- ❌ Add Supabase or any third-party auth

---

## ✅ Phase Status

| Phase | Complete | What |
|-------|----------|------|
| 1 | ✅ | RBAC hardening, secure auth |
| 2 | ✅ | Hashed sessions, no Supabase |
| 3 | ✅ | Audit logging |
| 4 | ✅ | Judge panel redesign |
| 5 | ✅ | Online deployment ready |
| 6 | ✅ | Attendance tracking |
| 7 | ✅ | Type safety & quality |

**All phases complete as of 2026-10-02.**

---

**Next time you work on RingFlow**: Open [AGENTS.md](AGENTS.md) first. It has everything you need.
