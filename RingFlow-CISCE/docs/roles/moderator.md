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
- Confirmed results are final from the moderator's side. Corrections go through the audited
  correction flow (Phase 3).
- Every score change, result, override, and queue change is audited with the moderator's name and session.

## Known gaps (see [PLAN.md](../PLAN.md))
- P1: **every action in `matches.ts` and `kata.ts` is unauthenticated.** Anyone can change scores
  and results.
- P1: approving a moderator broadcasts their `sessionToken` over the unauthenticated `/api/live`
  feed. `checkModeratorStatus(requestId)` hands the cookie to anyone who has the request ID, and
  request IDs are broadcast too. `validateModeratorSession` accepts the request ID as a token.
- P1: `updateModeratorName` doesn't validate the session. `getModeratorRingAssignments` has no auth.
- P2: the same 4-line auth check is copy-pasted into about 10 actions. Replace it with
  `requireRingOperator(ringId)`.
- P3: `event_log.moderator_session_id` is never filled in, so there's no actor on any log entry.
