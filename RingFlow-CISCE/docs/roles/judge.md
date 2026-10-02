# Judge (kata panel, own phone)

The kata judges seated at a tatami. They rotate between tatamis during the day and use their own
phones over guest Wi-Fi, mobile data or the venue LAN.

Kumite has no judge devices. In kumite the table moderator enters the referee panel's decisions.
That keeps per-flag latency and disputes out of the system, and matches standard table practice.

## Pairing a phone

1. The moderator's kata screen has a **Judge phones** panel. It shows a QR code
   (`/judge/ring/[ringId]?k=<pairing key>`) and a 4-digit tatami PIN as a fallback. Tapping
   **Rotate** changes both and drops every request that has not been approved. Judges already on
   the panel keep their seats.
2. The judge opens the link (or types the PIN), enters a name and picks a seat (J1 to J5). Wrong
   PINs and keys are rate limited per tatami and per address.
3. The moderator sees the request on that seat and taps **Approve** or **Reject**. The phone that
   made the request then collects an httpOnly `judge_token` cookie. A second browser that knows the
   request cannot collect it, because it does not hold the `judge_claim` cookie.
4. **Remove** ends one phone's session and **End panel** ends all of them. A seat belongs to one
   phone at a time: approving a new phone for a seat ends the old one (a partial unique index
   enforces this).
5. Sessions expire after 12 hours and are bound to one tatami and one seat.

## Voting

- A judge can vote only on the tatami's current kata bout, only while the moderator has opened
  voting, and only for their own seat. The seat comes from the session, never from the request.
- Flag bouts: the vote is AKA or AO, one row per seat.
- Points bouts: a mark per side from 5.0 to 10.0 in steps of 0.1. A solo pool performance has no
  AO mark.
- A judge can change their vote until the moderator closes voting. After that it is locked.
- The moderator can void a seat's vote (the judge then votes again) or overwrite it by typing into
  the desk grid when a phone has died. These are audited as `KATA_VOTE_VOIDED` and
  `KATA_VOTE_OVERRIDDEN`; the override keeps the replaced judge's name. Once the desk has entered a
  seat's mark, that phone cannot change it unless the desk voids it.
- Totals, flag counts, dropped marks and the winner are computed on the server
  (`src/lib/kata/tally.ts`). Clients never send totals. The moderator chooses the winner only when
  the votes tie or there are none, and that is recorded as `DESK_DECISION`.
- Small events can skip judge phones entirely. The moderator types all marks or flags at the desk.
  The desk sends only the cells it edited, so a phone vote that arrives meanwhile is never wiped by
  a stale blank.

## What a judge sees

Their seat and name, the current bout (AKA and AO names and declared kata), whether voting is open,
and their own vote. They never see the PIN, the QR key, other judges' votes, tokens or any admin
data.

## Network

Judge routes are the only routes meant to be reachable through a tunnel or online host when the rest
of the venue is LAN-only (see [../DEPLOYMENT.md](../DEPLOYMENT.md)). Server actions are guarded
individually, because blocking paths at the edge alone would not protect them.

## Files

- Phone: `src/app/judge/ring/[ringId]/page.tsx`, `src/components/judge/JudgeMobileClient.tsx`,
  `src/components/judge/KataScoreWheelPicker.tsx`, `src/actions/judge.ts` (`requestJudgeSeat`,
  `getJudgeStatus`, `getJudgeBout`, `submitJudgeVote`, `leaveJudgePanel`). The phone page keeps the
  screen awake with the Wake Lock API when the browser supports it.
- Desk: `src/components/moderator/JudgePanel.tsx` (inside `KataScoringPad`), `src/actions/judgePanel.ts`
  (`getJudgePanel`, `approveJudge`, `rejectJudge`, `kickJudge`, `endJudgePanel`,
  `rotateJudgePairing`), and in `src/actions/kata.ts` `openKataVoting`, `closeKataVoting`,
  `voidJudgeVote`, `submitModeratorManualKataMarks`.
- Auth: `getJudgePrincipal` (`src/lib/auth/principal.ts`) and `requireJudge`
  (`src/lib/auth/guards.ts`). A judge is deliberately not a staff `Principal`, so a judge session
  can never pass a staff check.
- Tables: `judge_sessions`, `kata_scores` (`judge_session_id`, `judge_name`), `matches.kata_voting`,
  `rings.judge_pin`, `rings.judge_pairing_key`.

## Limits

- The server tally handles up to seven seats, but the desk grid and the phone seat picker show five
  (`JUDGE_PANEL_SEATS` in `src/lib/constants/index.ts`).
- The QR link uses the event's tunnel URL when one is set, otherwise `APP_URL`, otherwise the
  origin of the page the moderator is on.
