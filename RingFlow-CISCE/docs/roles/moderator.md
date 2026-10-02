# Moderator (Tatami Table Official)

**Who:** the single person at a tatami's table. They run that tatami's category queue **and** score
every bout. A tatami runs exactly one category at a time, so one login per tatami is enough.

## Access
- `/login/mod`: the tatami's access code plus a name. Request → `/moderator/waiting/[requestId]` →
  the admin approves → `mod_token` session (24 h).
- **One approved moderator per tatami.** Approving a new one revokes the previous session (shift change).
- Scope: **one tatami** (`ringId`). Moderators can't read or affect other tatamis.

## Screens
| Route | Purpose | Component |
|---|---|---|
| `/moderator/ring/[ringId]/queue` | Pending categories for this tatami. Start one, reorder pending ones. | `ModeratorQueueClient` |
| `/moderator/ring/[ringId]/current` | The running category: pick a bout, score it, run the clock, confirm results, view the bracket, manage judges | `ModeratorCurrentClient`, `BoutScoringPad`, `KataScoringPad`, `BoutPickerModal` |
| `/moderator/ring/[ringId]/controls` | Pause/resume, emergency alert, request assistance | `ModeratorControlsClient` |
| `/scoreboard/[ringId]` | Opens the TV scoreboard for this tatami | `ScoreboardClient` |

## Can (own tatami only)
- Queue: `startCategory`, `finishCategory`, `returnCategoryToQueue`, `reorderCategory` (pending only),
  `setRingStatus` / `pauseCurrentRingAssignment`, `adjustMatchCount`, `logRingEvent`
  (emergency / assistance). These are in `moderator.ts`.
- Kumite bouts: `setActiveBout`, `updateLiveMatchState` (points, C1/C2 penalties, senshu),
  `confirmBoutResult` (points / hantei / kiken / hansoku / shikaku). The winner advances through the
  draw graph. These are in `matches.ts`.
- Kata bouts: manual marks/flags (`submitModeratorManualKataMarks`), `finalizeKataBout`,
  `advanceKataPoolFinalists`, and void/override of a judge vote. These are in `kata.ts`.
- Clock: start, pause, reset, adjust, finish, set duration, swap sides (`clock.ts`).
- Judges: show the QR/PIN, approve or kick judge phones, rotate the tatami PIN. See [judge.md](judge.md).

## Cannot
Touch other tatamis, edit categories, athletes or draws, change ring assignments, or approve other staff.

## Rules
- Only bouts in the category that is **running on this tatami** can be made live or confirmed.
- A confirmed result can be corrected by the moderator only while that category is still on their
  tatami (running or paused); a correction that would undo later bouts asks for explicit
  confirmation first. Every confirmation records who did it.
- Every score change, result, override, and queue change is audited with the moderator's name and session.

## Known gaps (see [PLAN.md](../PLAN.md))
- Corrections: the moderator can still re-confirm (correct) a bout while its category is on the
  mat; it is recorded with the moderator's name. Phase 3 adds a mandatory reason and the audit log.
- Phase 4: judge approval panel is not built yet.
