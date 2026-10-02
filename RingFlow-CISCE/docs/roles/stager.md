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
| *(optional)* mark athletes present / absent / withdrawn | stager board: the attendance icon on a category card, or **Attendance** in search (`AttendanceModal`) | `attendance.getCategoryAttendance`, `attendance.setAthleteAttendance` |

The stager status shows to the moderator and admin as `StagerStatusIndicator`.

## Cannot
Change the queue order or ring assignments, edit categories, athletes or draws, or score.

## Attendance (optional)
Attendance is a **helper, never a gate.** Nothing blocks a category or bout because attendance wasn't
taken. One tap per athlete marks them present, absent or withdrawn, and tapping again clears it. If an
athlete in the bout on the mat is marked absent or withdrawn, the moderator sees a hint above the
scoring pad (`AttendanceHint`, for example "consider Kiken"). The moderator still makes the decision.
Stagers and the event's admin can mark athletes, the moderator reads the marks, and organisers and
the public never see them. Every mark is audited (`ATTENDANCE_SET`). Stored in `category_attendance`
(migration 13), keyed by category and athlete, so it covers both ways an athlete enters a category.

## Known gaps (see [PLAN.md](../PLAN.md))
- None known after Phase 6.
