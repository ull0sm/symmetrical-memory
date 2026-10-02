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
| Brackets (view), results export, audit log (Phase 3) | via shared viewers |

## Cannot
Anything that writes: settings, categories, athletes, draws, assignments, approvals, clocks,
pausing, or scoring.

## Known gaps (see [PLAN.md](../PLAN.md))
- Results export is allowed server-side but there is no export button on the organiser screens yet.
