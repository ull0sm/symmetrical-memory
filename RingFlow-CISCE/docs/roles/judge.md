# Judge (Kata Panel, Own Phone)

**Status: rebuilt in PLAN Phase 4 (2026-10-02).** This file is both the spec and a description of
the code.

**Who:** the 5 kata judges seated at a tatami. They rotate between tatamis during the day and use
their own phones over guest Wi-Fi, mobile data, or the venue LAN.

**Kumite has no judge devices.** In kumite, the table moderator enters the referee panel's decisions.
That's standard table practice and avoids per-flag latency and dispute problems.

## Pairing flow
1. The moderator's kata screen has a **Judge phones** panel. It shows a **QR code**
   (`/judge/ring/[ringId]?k=<pairing key>`) and a 4-digit **tatami PIN** as a fallback. Both change
   when the moderator taps **Rotate**. Rotating drops every request that hasn't been approved yet;
   judges already on the panel keep their seats.
2. The judge opens the link (or types the PIN), enters their name, and picks a seat (J1–J5).
   Wrong PINs and keys are rate-limited per tatami and per address.
3. The moderator sees the request on that seat and taps **Approve** (or Reject). The approving
   browser then collects an httpOnly `judge_token` cookie. A second browser that knows the
   request can't collect it, because it doesn't hold the `judge_claim` cookie.
4. **Remove** (one phone) or **End panel** (all phones) ends sessions. A seat belongs to one phone
   at a time: approving a new phone for a seat ends the old one (a partial unique index enforces it).
5. Sessions expire after 12 h (`JUDGE_SESSION_TTL_MS`) and are bound to one tatami.

## Voting rules
- A judge votes only on the tatami's **current kata bout**, only while the moderator has
  **opened voting**, and always for their own seat. The seat comes from the session, not from the request.
- FLAG bouts: the vote is AKA or AO (one row per seat). POINTS bouts: a mark per side from 5.0 to
  10.0 in steps of 0.1. A solo pool performance has no AO mark.
- A judge may change their vote until the moderator **closes voting**. After that it's locked.
- The moderator can **void** a seat's vote (the judge votes again once voting is open) or overwrite it
  by typing into the desk grid (a judge's phone died). Both are audited (`KATA_VOTE_VOIDED`,
  `KATA_VOTE_OVERRIDDEN`, which keeps the replaced judge's name). Once the desk has entered a seat's
  mark, that judge's phone can't change it unless the desk voids it.
- Totals, flag counts, dropped marks and the winner are computed on the server
  (`src/lib/kata/tally.ts`). Clients never send totals. Finalizing uses the server's verdict. The
  moderator chooses the winner only when the votes tie or there are none, and that's recorded as
  `DESK_DECISION`.
- Small events can skip judge phones entirely. The moderator types all marks or flags at the
  desk, and that path always works. The desk sends only the cells it edited, so a phone vote that
  arrives meanwhile is never wiped by a stale blank.

## What judges see
Their seat and name, the current bout (AKA and AO names, declared kata), whether voting is open,
and their own vote. They don't see the PIN, the QR key, other judges' votes, tokens, or any admin data.

## Network
Judge routes are the only routes intended to be exposed via the tunnel or online host when the
rest of the venue is LAN-only. Server actions are still guarded individually, because the tunnel
host block alone doesn't protect them.

## Files
- Phone: `src/app/judge/ring/[ringId]/page.tsx`, `src/components/judge/JudgeMobileClient.tsx`,
  `src/components/judge/KataScoreWheelPicker.tsx`, `src/actions/judge.ts`
  (`requestJudgeSeat`, `getJudgeStatus`, `getJudgeBout`, `submitJudgeVote`, `leaveJudgePanel`).
- Desk: `src/components/moderator/JudgePanel.tsx` (inside `KataScoringPad`), `src/actions/judgePanel.ts`
  (`getJudgePanel`, `approveJudge`, `rejectJudge`, `kickJudge`, `endJudgePanel`, `rotateJudgePairing`),
  and in `src/actions/kata.ts`: `openKataVoting`, `closeKataVoting`, `voidJudgeVote`,
  `submitModeratorManualKataMarks`.
- Auth: `getJudgePrincipal` (`lib/auth/principal.ts`) and `requireJudge` (`lib/auth/guards.ts`). A judge is
  deliberately **not** a staff `Principal`.
- Tables: `judge_sessions`, `kata_scores` (`judge_session_id`, `judge_name`), `matches.kata_voting`,
  `rings.judge_pairing_key`. Migration: `db/migrations/migration12_judge_sessions.sql`.

## Known gaps
- Seven-judge panels: the server tally handles up to 7 seats, but the desk grid and the phone seat
  picker show 5 (`JUDGE_PANEL_SEATS`).
- Not yet tried on a real phone over the venue LAN or a tunnel/hosted URL. The flow was exercised
  in a browser at phone size against a local server (PLAN 4.5).
- The QR link uses the event's tunnel URL when one is set, otherwise the desk page's own origin.
  A single `APP_URL` setting arrives in PLAN Phase 5.
