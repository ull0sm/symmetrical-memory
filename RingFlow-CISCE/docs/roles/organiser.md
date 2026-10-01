# Organiser (Read-Only Event Observer)

**Who:** federation or school officials, coordinators, and desk staff. They need to see everything
about one event but must not change anything.

## Access
- `/login/organiser`: organiser code (one per tournament, regenerated in admin settings) plus a name.
- Request → `/organiser/waiting/[requestId]` → the admin approves → `org_token` session (48 h).
  Several organisers can be approved at the same time.
- Scope: **one tournament, read-only.**

## Can (read-only)
| View | Route |
|---|---|
| Live overview of all tatamis | `/organiser/event/[id]/dashboard` (reuses `AdminDashboardClient readOnly`) |
| Athlete roster | `/organiser/event/[id]/athletes` (`AthletesClient readOnly`) |
| Categories | `/organiser/event/[id]/categories` (`CategoriesClient readOnly`) |
| Ring balance board | `/organiser/event/[id]/rings/balance` (`RingBalancingClient readOnly`) |
| Brackets, draw-sheet PDFs, results export, audit log | via shared viewers |

## Cannot
Anything that writes: settings, categories, athletes, draws, assignments, approvals, clocks,
pausing, or scoring.

## Known gaps (see [PLAN.md](../PLAN.md))
- P1: `clock.ts` (`authorizeRingControl`) and `rings.ts` (`setAllRingTimers`) let organisers control
  clocks. That's a write path and must be removed. `ensureOrganiser()` isn't tied to a tournament,
  so it currently works across events.
- P1: the session cookie isn't `httpOnly`. The request ID is accepted as a session token.
- P2: the dead Supabase `auth.getUser()` admin branch in `ensureOrganiser*` needs removing.
- The README used to describe organisers importing rosters and generating draws. That's obsolete:
  organisers are read-only by product decision.
