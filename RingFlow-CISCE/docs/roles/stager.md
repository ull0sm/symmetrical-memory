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
| View brackets and draw-sheet PDFs to call athletes | `DrawBracketModal`, `PdfViewerModal` | `draws.getCategoryDraw`, `drawPdfs.*` |
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
- P1: the cookie isn't `httpOnly`. The request ID is accepted as a token (`ensureStager*` uses `or(sessionToken, id)`).
- P1: `getBalancingAssignments(ringIds)` has no auth or tenancy check.
- P2: the dead Supabase admin fallback needs removing. The real admin cookie should be recognised instead.
