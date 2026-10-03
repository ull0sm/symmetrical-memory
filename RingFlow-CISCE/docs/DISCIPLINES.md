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

**Draws**: single elimination, padded to a power of two with byes. A large bracket is divided into
pools of 16 places (a 64-place bracket is four pools) so its pools can run on different tatamis (see
[roles/admin.md](roles/admin.md)).

*Draw profile.* Each tournament's draws follow either **Official** (strict WKF procedure) or **Organiser's
rules** (WKF as a base, tweaked by the organiser), and a category can override the tournament
(`draw_profile`). The profile is resolved once by `src/lib/draws/drawRules.ts`. It is unrelated to the
tournament type (Official or Local), which decides who builds the draw:

| | Official | Organiser's rules |
|---|---|---|
| Bronze medals | Repechage with two bronzes | Set per tournament (`default_bronze_medals`) and per category (`bronze_medals`) |
| Club separation | Always on | On or off (`draw_separation`) |
| Hand swap of first-round athletes | Not allowed | Allowed in a draft bracket |

Bronze values are 0 (no bronze bout), 1 (a single bronze bout between the two ladder winners) and 2
(repechage: everyone beaten by a finalist gets a second chance, and two bronzes are awarded, the WKF
default).

*Seeding and separation.* Seeds are optional (`setCategorySeeds`): seeded athletes take the standard
seed positions and the rest are drawn at random around them. Entrants from the same club or school are
kept apart for as long as the bracket allows; athletes with no club are never grouped. The random seed
is stored with the draw and shown with its checksum, and generation is deterministic for a given seed
and roster.

*Hand swap* (`swapDrawAthletes`, organiser's rules only): the admin can trade two first-round athletes in a draft
bracket. The new graph is stored as the next draw version, so the history keeps the original. It is
refused for official draws, locked draws, categories with fought bouts, and kata flights. Audited.

*Safety.* A draw cannot be regenerated while any bout is live or confirmed, or while the draw is locked,
and the check runs inside the same transaction as the rewrite. The only way to discard fought bouts is
**Flush**, which needs the typed word `FLUSH` and a reason, is admin only and is audited.

Walkovers and empty matches are resolved without a contest and are excluded from the bout count, so
progress bars reach 100%. Confirming a result advances the winner (and sends the loser to repechage)
through the stored draw graph (`src/lib/bouts/results.ts`).

*Draw sheets* are PDFs for staff. An unlocked draw prints as a Draft with a DRAFT watermark on every page. A locked draw is
"Official" under the Official profile and "Final" under organiser's rules. They show the draw only (no scores). Names print in Latin, Devanagari and
Kannada using bundled Noto Sans fonts (`public/fonts/pdf`), so they work offline. Each pool page prints
the tatami that runs it.

## Local tournaments: groups

In a Local tournament a category (an age, belt and sex block) holds a kumite and a kata event, and
each event splits into groups that compete separately: every group has its own gold, silver and
bronzes, and groups never meet. The starting groups are built from the event's plan
(`src/lib/local/rules.ts`): as few groups as the group size allows (16 athletes in groups of 8 make
8 + 8; 7 in groups of 4 make 4 + 3), sizes within one of each other, and the biggest clubs dealt
across the groups first so club-mates are spread out.

Bronzes are set per tournament and per event. With **2 bronzes** (the default) both semi-final losers
take bronze with no extra bout (the draw engine's joint-bronze option). With **1 bronze** the two
semi-final losers fight one bronze bout. Full repechage is not offered for Local groups. Kumite
groups are knockout brackets; kata groups are ranked groups, where every athlete performs once.

A group's draw is built from its draft (`src/engine/draw-engine/groupDraw.ts`,
`rankedKataDraw.ts`): athletes the stager pinned keep their places; byes go where the standard bracket
puts them (moving on when a pin takes the place), and no bout ever has two byes; everyone else is
shuffled from the group's stored seed, keeping club-mates apart in the first round. A ranked kata
group is a performance order called in pairs, with a solo for an odd last athlete. Locking a group
stores exactly the draw the stager was shown (same members, pins and seed, same checksum) as a locked
draw, and only then can it start.

### Changes after lock

Only the admin changes a locked group, with a reason, and each change is a new draw version
(`src/lib/local/lateChanges.ts`). Before the group's first bout the draw is rebuilt from its new
members with everyone else pinned where they were (`kumitePinCandidates` in
`src/lib/local/lateChangePlan.ts`): a late kumite athlete takes a bye, and the athlete who had it now
has an opponent; an athlete taken out leaves a bye. If that would leave a bout with nobody in it (the
leaver had the bye), one athlete moves into it rather than the draw being redone. A bracket that has to
grow or shrink to the next size is drawn again from the group's seed. In kata the order closes up or
the newcomer performs last.

Once bouts have been fought, nothing that has been fought changes:

- **Kumite: fill a bye.** A late athlete takes a first-round bye whose holder hasn't started their next
  bout (`fillByeWithEntrant`). That bout becomes a real one, the walkover is undone, and the next bout
  waits for its winner. Once the bye-holder has fought on, that bye is closed; if no bye is open the
  athlete goes into a group that hasn't started, or a new one.
- **Kata: append.** A late athlete performs at the end (`appendRankedPerformer`): in the last solo if it
  hasn't started, otherwise as a new solo after it. The ranking waits for their performance, so the
  podium stays open until then.
- **Withdrawals** need no change: kiken in the bout, or "didn't perform" in a ranked group.

A finished group never changes. A guest (an athlete from another category, entered by the admin)
competes like any member and is marked as a guest; their own category is unchanged.

### Ranked kata groups

Every athlete of a ranked group performs once and is scored with marks (judge phones or the desk, as
for any kata bout; always points, never flags). A pair is called to the mat together, but each
performance stands on its own: confirming the bout needs a total for each athlete, names no winner
(`decision_method` `RANKED`), and brings the next pair up on the tatami. An athlete who doesn't perform
is confirmed with no total and ranks last, with no medal ("DNP").

The ranking (`src/lib/kata/ranking.ts`) orders athletes by:

1. the higher total;
2. then, when 5 or 7 judges marked, the higher of the lowest dropped marks (with 7, the lower of the
   two is compared first);
3. then the higher of the highest dropped marks.

Medals go by position: gold, silver, bronze, and a second bronze for 4th under the 2-bronze setting
(a group of 3 is gold, silver, bronze; of 2, gold and silver; of 1, gold). A tie still standing after
the tie-breaks is shared ("5=") unless it decides a medal (for example level for gold and silver).
Then, once everyone has performed, the moderator records a **desk decision** after a re-performance
or a flag vote between the tied athletes: their order, the method and a note
(`resolveKataTie`, stored in `kata_tie_decisions` and audited as `KATA_TIE_DECIDED`). Recording the same
tie again replaces the order. A tie that is level on bronze under the 2-bronze setting (3rd and 4th)
shares bronze and needs no decision. The podium is final once every performance is confirmed and
every medal tie is decided, and the group can't be finished on the tatami before that.

## Kata

A kata category chooses a **format** and a **scoring mode** (`updateCategoryKataSettings`):

| Setting | Values | Meaning |
|---|---|---|
| `kata_format` | `GROUP_POOLS` (default), `BRACKET` | Pools with a medal flight, or a head-to-head knockout tree |
| `kata_scoring_mode` | `FLAG` (default), `POINTS` | Majority vote of the panel, or marks from 5.0 to 10.0 |
| `pool_size` | default 8 | Athletes per pool |
| `advance_per_pool` | default 2 | Stored and editable, but not yet used: advancement fills the medal-flight bouts the draw contains |

### Group pools

Athletes are split into at most two balanced pools (Pool A and Pool B; larger categories simply get
larger pools). Clubs are spread across the pools and club-mates are not paired in a pool bout where
the numbers allow. The draw is reproducible from its stored seed. Each athlete performs solo, once. Their mark
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
