# Stager (call area)

Volunteers in the warm-up and call area. In an Official tournament they gather athletes for upcoming
categories and tell the tatami when a category is ready. In a Local tournament they also build each
category's groups at the venue and send them to the tatami ([the stager desk](#local-tournament-the-stager-desk)).

## Access

- Sign in at `/login/stager` with one of the tournament's stager codes and a name. The admin
  generates the codes ("Stager 1" to "Stager N").
- The request waits at `/stager/waiting/[requestId]` until the admin approves it. The browser then
  receives a `stager_token` session valid for 48 hours.
- One live session per code: approving a new request on a code revokes the previous session.
- Scope: one tournament.

## What a stager can do (Official tournament)

| Action | Where | Server action |
|---|---|---|
| See every tatami's queue (current, next, upcoming) | `/stager/event/[id]/balance` | `getBalancingAssignments` |
| Mark a category **calling**, then **ready**, or clear it | same page | `updateCategoryStagerStatus` |
| View brackets to call athletes | bracket modal | `getCategoryDraw` |
| Search athletes by name or chest number | header search | `searchTournamentAthletes` |
| Mark athletes present, absent or withdrawn (optional) | attendance icon on a category card, or **Attendance** in search | `getCategoryAttendance`, `setAthleteAttendance` |

A category whose pools run on different tatamis appears as a card per pool and for the finals, each on its own
tatami: athletes are called to the tatami they will fight on, and **calling** and **ready** are set per card. The
finals card shows which pools it is still waiting for.

The calling and ready status is shown to the moderator and the admin as a status indicator
(`StagerStatusIndicator`).

## What a stager cannot do

Change queue order or tatami assignments, edit categories, athletes or draws, or score. In a Local
tournament a stager builds groups only in the category they hold, and cannot change a group once it
is locked, review walk-ins, or enter a guest from another category: those are the admin's.

## Local tournament: the stager desk

There is no calling board in a Local tournament (`/stager/event/[id]/balance` goes to the desk). The
stager's job is to take a category from "on the list" to "on the tatami": check who is here, adjust
the groups, and lock each one.

**The desk** (`/stager/event/[id]`) lists every category, soonest first by where its next group sits
in its tatami's queue ("Tatami 1 · 3rd in line"), with chips to filter by tatami and a search for any
athlete's category. Each category is Waiting, With (a stager's name), Partly sent or Sent; categories
with no athletes, and finished ones, come last. The category you hold is at the top.

**Holding a category.** One person prepares a category at a time, and a stager holds one category at
a time. *Take* gives you a category (and builds its starting groups if it has none); *Hand back*
returns it with its groups as they are. The hold belongs to the stager code, not the phone: signing
out, or a phone that dies, keeps it, and signing in again with the same code carries on. Locking the
category's last group ends the hold. The admin can release a hold, or hand it to another stager.
Other stagers see a held category's status and holder, never its draft groups.

**The workspace** (`/stager/event/[id]/category/[divisionId]`) has a tab for the athletes and one per
event:

- **Athletes**: the roll call (Here, Absent), kumite and kata per athlete, and *Add athlete*: search
  the tournament and move someone here with a reason, or register a walk-in (name and club; age, belt
  and sex come from the category). A walk-in whose name is already entered is offered the existing
  athlete first. Marking an athlete absent takes them out of their groups.
- **Kumite** and **Kata**: the event's groups as chips, the present athletes in no group
  (*Unplaced*), and each group's draw: first-round bouts with red and blue sides and byes (kumite),
  or the performance order in pairs (kata).

Tap an athlete, then tap where they go: another athlete of the group swaps them (both are then
pinned), a bye moves them there (pinned), a group chip moves them to that group, *New group* starts
one, *Unplaced* takes them out. On a wide screen the groups show side by side and athletes can also be
dragged. Each group has *Shuffle* (pinned athletes stay), *Clear pins* and *Remove group*; each event
has *Fill* (unplaced athletes into the smallest groups) and *Rebalance*. *Undo* steps back through the
last 20 changes to the groups. Every change is saved at once; one that fails says so, with *Retry*.

*Lock and send* shows the group exactly as it will be drawn, its tatami and any warnings. Locking
stores that draw, and the moderator can start the group when its turn comes; from then on only the
admin can change it ([admin.md](admin.md#changing-a-local-group-after-lock)), and the stager sees it
read only, as its stored draw. An empty group, an absent athlete in it, or pins that leave a bout with
nobody in it block the lock. A group of one, more athletes than the plan, club-mates meeting in the
first round, or a walk-in the admin hasn't reviewed only warn. A guest the admin entered from another
category is marked *guest* in the group; an athlete who competes as a guest elsewhere isn't unplaced
here and can't be put in a group of that event.

| Action | Server action |
|---|---|
| Read the desk, find an athlete's category | `getStagerDesk`, `searchDeskAthletes` |
| Take or hand back a category | `takeDivision`, `handBackDivision` |
| Open the workspace (holder, or the admin read only) | `getDivisionWorkspace` |
| Roll call, kumite and kata | `setAttendanceLocal`, `setParticipationLocal` |
| Add an athlete | `searchAthletesForDivision`, `moveAthleteIntoDivision`, `registerWalkIn` |
| Change the groups | `moveAthlete`, `placeAthlete`, `swapAthletes`, `unpinAthletes`, `shuffleGroup`, `addGroup`, `removeGroup`, `autoFillEvent`, `rebalanceEvent`, `restoreEventDraft` (undo) |
| Lock and send a group | `lockGroup` |

Every action checks that the caller holds the category (`requireDivisionHolder`). Taking, handing
back, attendance, participation, moves, walk-ins, adding or removing a group and locking are audited.

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
