# Judge (Kata Panel, Own Phone)

**Status: the current implementation is untested and considered broken. This file is the redesign
spec (PLAN Phase 4).** Don't extend the current code. Rebuild it to this spec.

**Who:** the 5 (sometimes 7) kata judges seated at a tatami. They rotate between tatamis during the
day and use their own phones over guest Wi-Fi, mobile data, or the venue LAN.

**Kumite has no judge devices.** In kumite, the table moderator enters the referee panel's decisions.
That's standard table practice and avoids per-flag latency and dispute problems.

## Pairing flow
1. The moderator's kata screen shows a **QR code** (`/judge/ring/[ringId]?k=<pairing key>`) and a
   4-digit **tatami PIN** as a fallback. Both rotate when the moderator taps "Rotate". Rotating
   invalidates any pairing that hasn't been approved yet.
2. The judge opens the link, enters their name, and picks a free seat (1–5, or 1–7).
3. The moderator sees the request in a seat panel and taps **Approve** (or Reject). Approval binds
   the phone to (tatami, seat) and issues an httpOnly `judge_token` cookie.
4. "Kick" or "End panel" ends the session. A seat can only belong to one phone at a time, and
   approving a new phone for a seat kicks the old one.
5. Sessions expire after at most 12 h and never carry over to a different tatami.

## Voting rules
- A judge can only vote on the tatami's **current kata bout**, and only while the moderator has it
  open for voting. They can only vote for their own seat.
- FLAG mode: the vote is AKA or AO. POINTS mode: the score is 5.0–10.0 in 0.1 steps, per side, as
  defined by the ruleset.
- A judge may change their vote until the moderator **closes voting**. After that it's locked.
- The moderator can **void** a vote (the judge re-votes) or **override** it with a manual entry
  (for example, a judge's phone died). Both are audited and shown on the bout record.
- Results are computed on the server from `kata_scores` (`src/lib/kata/scoringEngine.ts`). Clients
  never send totals.
- Small events can skip judge phones entirely. The moderator enters all marks or flags manually,
  and that path always works.

## What judges see
Their seat, the current bout (AKA and AO names, declared kata), their own vote, and the
connection/approval status. They don't see the PIN, other judges' votes, tokens, or any admin data.

## Network
Judge routes are the only routes intended to be exposed via the tunnel or online host when the
rest of the venue is LAN-only. Server actions are still guarded individually, because the tunnel
host block alone doesn't protect them.

## Files (current, to be rebuilt)
`src/app/judge/ring/[ringId]/page.tsx`, `src/components/judge/JudgeMobileClient.tsx`,
`src/components/judge/KataScoreWheelPicker.tsx`, `src/actions/judgeAuth.ts`, and in `src/actions/kata.ts`:
`submitJudgeVote`, `voidJudgeVote`, `getRingKataState`, `updateRingJudgePin`. Tables: `judge_requests`, `kata_scores`.

## Known gaps (current code)
- No moderator UI calls `approveJudgeRequest`, so judges stay pending forever.
- `submitJudgeVote` accepts any seat on any match without checking approval.
- `getRingKataState` returns `judgePin` to anyone, and the judge page fetches it, so the PIN is public.
  The default PIN is `1234`.
- Approve, reject, revoke and PIN changes have no auth. Device tokens are broadcast on the public feed.
