# Public, Athletes & Scoreboard

**Who:** athletes, coaches, parents and spectators (on phones), plus the arena TV screens.

## Public event page
- Route: `/public/event/[id]`, opened from a shared link or QR code. No login, nothing to install.
- Shows every tatami's status (current category, current bout, queue, progress, ETA).
- Athlete search by name or chest number: which tatami and category, and whether they're up soon.
- Brackets: visible when the admin enables **Show draws publicly** (`tournaments.show_public_draws`).
  An athlete's own bracket, reached by searching their name, is always visible, with them highlighted.
- Component: `PublicEventClient`.

## Scoreboard TV
- Route: `/scoreboard/[ringId]`.
- Who can open it: the tatami's moderator, the owning admin, and organisers of the event.
  **Anyone** can open it only if the admin enabled `show_public_scoreboard`.
- Display only: names, school/country, score, penalties, senshu, clock, winner card, next bout.
- Component: `ScoreboardClient` and `src/components/scoreboard/*`.

## Data rules (best practice)
- Public reads go through **dedicated public actions** that return minimal DTOs: names, school,
  chest number, category, tatami, scores and status. They never include access codes, PINs, tokens,
  device info, IP addresses, admin email, the event log, or request lists.
- The public toggles are enforced **in the data actions**, not only in layouts.
- The public live feed only carries `{table, op, id, ringId, tournamentId, categoryId, matchId, status}`.
  Clients refetch through public actions.
- Never public: draw-sheet PDFs, the audit log, the activity log, staff names, and other tournaments' data.
- Read-only. There are no write actions for the public, ever.

## Known gaps (see [PLAN.md](../PLAN.md))
- P1: `PublicEventClient` calls `getAdminDashboardData`, which is an admin action with no guard and
  returns the full event log.
- P1: `getRingActiveBout` and `getTournamentActiveBouts` don't enforce `show_public_scoreboard`.
  Only the layout does.
- P1: `/api/live` events leak session tokens, request IDs and judge device tokens.
