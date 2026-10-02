# Disciplines: how RingFlow handles kumite and kata

RingFlow follows the WKF 2026 rules for the events it supports. The rules are encoded as data in
`src/engine/rules-engine/rulesets/` (`wkf-kumite-2026.ts`, `wkf-kata-2026.ts`,
`wkf-team-kata-2026.ts`, `wkf-team-kumite-2026.ts`), each value annotated with the rule article it
comes from, so a rules revision can be diffed line by line.

Every category has an `event_type`: `kumite`, `kata`, `team_kumite` or `team_kata`.

| Event type | Status in the app |
|---|---|
| `kumite` | Fully supported: draw, scoring pad, clock, scoreboard, results |
| `kata` | Fully supported: pool or bracket draw, judge phones or desk marks, scoreboard, results |
| `team_kata`, `team_kumite` | Athletes can be registered and categories created, and they run through the kata or kumite flow. There is no team lineup, bout order form, bunkai timer or team-match aggregation yet |

## Kumite

**Scoring** (`BoutScoringPad`): Yuko 1, Waza-ari 2, Ippon 3, category 1 and 2 penalties, and senshu
(the first unopposed score). A decision is recorded as points, hantei, kiken, hansoku or shikkaku.
The pad sends live state with `updateLiveMatchState`, and the moderator confirms the result with
`confirmBoutResult`.

**Clock** (`src/actions/clock.ts`, `src/lib/matchClock.ts`): the server holds the authoritative
clock with millisecond precision. A tatami stores the instant the current run segment began and the
milliseconds accumulated before it, so a server restart does not lose the time. Screens estimate
the offset to the server clock from recent samples and compensate for drift. The default bout length
is 180 seconds (`DEFAULT_BOUT_DURATION_MS`) and can be set per tatami. The sides can be swapped to
match the referee's orientation.

**Draws**: single elimination, padded to a power of two with byes. Medal structure is set per
tournament (`default_bronze_medals`) and can be overridden per category (`bronze_medals`):

| Value | Result |
|---|---|
| 0 | No bronze bout |
| 1 | A single bronze bout between the two ladder winners |
| 2 | Repechage: everyone beaten by a finalist gets a second chance, and two bronzes are awarded (WKF default) |

Bracket generation is deterministic for a given random seed. Entrants
from the same school or club can be kept apart in the first round. Walkovers and empty matches are
resolved without a contest and are excluded from the bout count, so progress bars reach 100%.
Confirming a result advances the winner (and sends the loser to repechage) through the stored draw
graph (`src/lib/bouts/results.ts`).

## Kata

A kata category chooses a **format** and a **scoring mode** (`updateCategoryKataSettings`):

| Setting | Values | Meaning |
|---|---|---|
| `kata_format` | `GROUP_POOLS` (default), `BRACKET` | Pools with a medal flight, or a head-to-head knockout tree |
| `kata_scoring_mode` | `FLAG` (default), `POINTS` | Majority vote of the panel, or marks from 5.0 to 10.0 |
| `pool_size` | default 8 | Athletes per pool |
| `advance_per_pool` | default 2 | Pool finalists who reach the medal flight |

### Group pools

Athletes are split into at most two balanced pools (Pool A and Pool B; larger categories simply get
larger pools), with larger clubs spread across pools. Each athlete performs solo, once. Their mark
ranks them within their pool only.

When the pool bouts are finished, the top finalists from each pool advance automatically
(`advanceKataPoolFinalists`) into the medal flight: a gold and silver bout (Pool A first against
Pool B first) and bronze bouts. Medal bouts start from zero. The pool score is shown only as a
qualification score; it never carries over into the medal bout, and medals depend only on the medal
bouts.

### Bracket

Head-to-head knockout: AKA and AO both perform, the panel votes, and the winner advances like a
kumite bout. A bracket kata category takes the same path as kumite for progression.

### Scoring modes

- **Flag**: each judge raises AKA or AO. At least three flags are needed for a decision, and the
  side with more flags wins. A tie or too few flags goes to the desk (`DESK_DECISION`).
- **Points**: each judge gives a mark from 5.0 to 10.0 in 0.1 steps. Fewer than three marks give no
  total. With three or four marks all are summed. With five marks the highest and lowest are
  dropped and the middle three summed. With seven marks the two highest and two lowest are dropped
  (`src/lib/kata/scoringEngine.ts`). Dropped marks are flagged on each bout.
  A solo pool performance has only an AKA total and wins by having a valid total.

All totals and winners are computed on the server from the stored judge rows
(`src/lib/kata/tally.ts`); clients never send them. For a small event without judge phones, the
moderator types marks or flags at the desk. A total typed from a paper score sheet is kept only
when that side has no per-judge marks. Judges and the pairing flow are described in
[roles/judge.md](roles/judge.md).

## Rulesets and what they drive

`generateCategoryDraw` picks `WKF_KATA_2026` for kata categories and `WKF_KUMITE_2026` for the
rest. The ruleset supplies bout durations by age group, scoring values, tie-break order, penalty
escalation, whether a draw (hikiwake) is allowed, and the repechage rule. Team rulesets exist for
the team events but are not yet wired to floor operations.

## Team events: what the rules require

Recorded here so the gap is explicit. None of this is built.

- **Team kata**: three athletes of one sex, no commands or cadence. In medal bouts the team also
  performs bunkai, and kata plus bunkai has a hard 5:00 limit (buzzer at 4:30 and 5:00; going over
  is disqualification).
- **Team kumite**: male teams fight five bouts and female teams three. The coach submits a bout
  order before each match and it cannot change. A bout may end in hikiwake. The match is decided
  by bout wins, then by total points (difference capped at 8 per bout), then by an extra
  deciding bout between one chosen fighter per team, then by hantei.
