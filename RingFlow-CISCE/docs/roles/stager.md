# Stager (call area)

Volunteers in the warm-up and call area. They gather athletes for upcoming categories and tell the
tatami when a category is ready.

## Access

- Sign in at `/login/stager` with one of the tournament's stager codes and a name. The admin
  generates the codes ("Stager 1" to "Stager N").
- The request waits at `/stager/waiting/[requestId]` until the admin approves it. The browser then
  receives a `stager_token` session valid for 48 hours.
- One live session per code: approving a new request on a code revokes the previous session.
- Scope: one tournament.

## What a stager can do

| Action | Where | Server action |
|---|---|---|
| See every tatami's queue (current, next, upcoming) | `/stager/event/[id]/balance` | `getBalancingAssignments` |
| Mark a category **calling**, then **ready**, or clear it | same page | `updateCategoryStagerStatus` |
| View brackets to call athletes | bracket modal | `getCategoryDraw` |
| Search athletes by name or chest number | header search | `searchTournamentAthletes` |
| Mark athletes present, absent or withdrawn (optional) | attendance icon on a category card, or **Attendance** in search | `getCategoryAttendance`, `setAthleteAttendance` |

The calling and ready status is shown to the moderator and the admin as a status indicator
(`StagerStatusIndicator`).

## What a stager cannot do

Change queue order or tatami assignments, edit categories, athletes or draws, or score.

## Attendance

Attendance is a helper and never a gate. Nothing is blocked because it was not taken.

- One tap marks an athlete present, absent or withdrawn. Tapping the same value again clears it.
- If an athlete in the bout on the mat is marked absent or withdrawn, the moderator sees a hint
  above the scoring pad (`AttendanceHint`, for example "consider Kiken"). The moderator decides.
- Stagers and the event's admin can mark athletes. Moderators can read the marks. Organisers and
  the public never see them.
- Every mark is audited as `ATTENDANCE_SET`. Marks are stored in `category_attendance`, keyed by
  category and athlete, so they cover both ways an athlete reaches a category (official import
  entries and the athlete's own category).
