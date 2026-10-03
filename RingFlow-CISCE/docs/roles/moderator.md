# Moderator (tatami table official)

The single person at a tatami's table. They run that tatami's category queue and score every bout.
A tatami runs one category at a time, so one login per tatami is enough.

## Access

- Sign in at `/login/mod` (`/moderator/login` redirects there) with the tatami's access code and a
  name.
- The request waits at `/moderator/waiting/[requestId]` until the admin approves it. The browser
  then receives a `mod_token` session valid for 24 hours.
- One approved moderator per tatami. Approving a new one revokes the previous session, which is how
  a shift change works.
- Scope: one tatami (`ringId`). A moderator cannot read or affect other tatamis.

## Screens

| Route | Purpose | Main components |
|---|---|---|
| `/moderator/ring/[ringId]/queue` | Pending categories for this tatami: start one, reorder the pending ones | `ModeratorQueueClient` |
| `/moderator/ring/[ringId]/current` | The running category: pick a bout, score it, run the clock, confirm results, see the bracket, manage judge phones | `ModeratorCurrentClient`, `BoutScoringPad`, `KataScoringPad`, `BoutPickerModal` |
| `/moderator/ring/[ringId]/controls` | Pause or resume, emergency alert, request assistance | `ModeratorControlsClient` |
| `/scoreboard/[ringId]` | The arena TV screen for this tatami | `ScoreboardClient` |

A category whose pools are split across tatamis shows up as separate cards in each tatami's queue
("Category · Pool 2", "Category · Finals"). You see and score only your own part: the bracket you open
shows just that pool (or just the finals), never the whole tree, and the server will not show a tatami
any other pool of the category even if it asks. The finals card cannot
be started until every pool has been finished on its tatami, and a pool cannot be reopened once the
finals have started.

In a Local tournament each card is a group ("Blue · 9 · M · Kumite · Group 1"), labelled with where its
stager is: *Waiting for stager*, *Being prepared by* (name), or *Ready* once it is locked. Only a ready
group shows Start, and `startCategory` refuses any other; the moderator can still reorder every pending
card. Starting a kumite group sets the tatami clock to its event's bout length when one is set, unless a
bout is on the clock.

A ranked kata group has a **Ranking** tab instead of the pool tables: the standings as performances come
in, the performance order (tap a pair to score it), and any tie that decides a medal. On the scoring pad,
*Confirm Scores* confirms a pair once both athletes have a total (there is no winner), and the next pair
comes up; *didn't perform* confirms it without a total for an athlete who didn't come out. When two
athletes are level on a medal after the tie-breaks, the moderator records the desk decision on the
Ranking tab once everyone has performed (the order, re-performance or flag vote, and a note), and the
group can't be finished until it is recorded (see [../DISCIPLINES.md](../DISCIPLINES.md#ranked-kata-groups)).

A guest (an athlete the admin entered from another category) is marked "(guest)" beside their name on
the moderator's bout, the ranking, the judge phones, the scoreboard feed and the printed draw.

## What a moderator can do (own tatami only)

- **Queue** (`moderator.ts`): `startCategory`, `finishCategory`, `returnCategoryToQueue`,
  `reorderCategory` (pending only), `setRingStatus`, `pauseCurrentRingAssignment`,
  `adjustMatchCount`, `logRingEvent` (emergency and assistance requests).
- **Kumite bouts** (`matches.ts`): `setActiveBout`, `updateLiveMatchState` (points, penalties,
  senshu), `confirmBoutResult` (points, hantei, kiken, hansoku, shikkaku). The winner advances
  through the draw.
- **Kata bouts** (`kata.ts`): open and close judge voting, void one seat's vote, enter marks or
  flags at the desk, finalize. The server computes the totals and the winner; the moderator only
  decides a tie. In a Local ranked group: confirm a pair's scores (`notPerformed` for an athlete who
  didn't perform), read the ranking (`getRankedStandings`) and record a medal tie's desk decision
  (`resolveKataTie`). See [judge.md](judge.md) and [../DISCIPLINES.md](../DISCIPLINES.md).
- **Clock** (`clock.ts`): start, pause, reset, adjust, finish, set duration, swap sides.
- **Judge phones** (`judgePanel.ts`): the Judge phones panel in the kata pad shows the QR code and
  PIN, approves or removes phones, rotates the QR and PIN, and ends the panel.
- **Attendance hint**: an amber hint above the pad when an athlete in the current bout was marked
  absent or withdrawn. It informs; the moderator decides whether to call kiken.

## What a moderator cannot do

Touch other tatamis, edit categories, athletes or draws, change tatami assignments, or approve
other staff.

## Rules the server enforces

- Only bouts of the category that is running or paused on this tatami can be made live, scored or
  confirmed (`requireMatchModerator`).
- A confirmed result can be changed by the moderator only while its category is still on their
  tatami, with a reason of at least five characters. A change that would undo later bouts asks for
  explicit confirmation first.
- Every score change, result, override and queue change is audited with the moderator's name.
- After the category leaves the mat, only the admin can correct a result (see [admin.md](admin.md)).
