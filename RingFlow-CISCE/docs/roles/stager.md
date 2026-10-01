# Stager (Marshalling / Call Area)

**Who:** volunteers in the warm-up and call area. They gather athletes for upcoming categories and
signal the tatami when a category is ready.

## Access
- `/login/stager`: one of the event's stager codes (the admin generates N codes, each labelled
  "Stager 1..N") plus a name.
- Request → `/stager/waiting/[requestId]` → the admin approves → `stager_token` session (48 h).
- **One live session per code.** Approving a new request on the same code revokes the old one.
- Scope: one tournament.

## Can
| Action | Where | Actions |
|---|---|---|
| See all tatamis' queues (current, next, upcoming) | `/stager/event/[id]/balance` (`StagerBalancingClient`) | `balancing.getBalancingAssignments` |
| Mark a category **calling** → **ready** → clear | same | `stager.updateCategoryStagerStatus` |
| View brackets to call athletes | `DrawBracketModal` | `draws.getCategoryDraw` |
| Search athletes | header search | `athletes.searchTournamentAthletes` |
| *(planned, optional)* mark athletes present / absent / withdrawn | stager board | Phase 6 |

The stager status shows to the moderator and admin as `StagerStatusIndicator`.

## Cannot
Change the queue order or ring assignments, edit categories, athletes or draws, or score.

## Attendance (optional, Phase 6)
Attendance is a **helper, never a gate.** Nothing blocks a category or bout because attendance wasn't
taken. If an athlete is marked absent, the moderator gets a hint (for example, "AO marked absent:
consider Kiken"). The moderator still makes the decision.

## Known gaps (see [PLAN.md](../PLAN.md))
- Phase 6: optional attendance marking is not built yet.
