# Public, athletes and scoreboard

Athletes, coaches, parents and spectators on their phones, plus the arena TV screens.

## Home page

`/` lists the tournaments on the server with their date and status, and links to each event's public
page. No login.

## Public event page

- Route: `/public/event/[id]`, reached from a shared link or QR code. No login, nothing to install.
  A tournament still in `draft` has no public floor view yet.
- Shows every tatami's status: current category and bout, queue, progress and estimated finish. A
  category split across tatamis appears as a card per pool and for the finals ("Category · Pool 3").
- Athlete search by name or chest number shows the tatami and category and whether they are up soon.
- Brackets are visible when the admin turns on "show draws publicly"
  (`tournaments.show_public_draws`). An athlete's own bracket, reached by searching their name, is
  always visible with them highlighted.
- Finished podiums are listed (names, clubs and medals, no ids) when public draws are on
  (`getPublicPodiums`). The club medal tally is staff only.
- A Local group the stager hasn't locked shows by name only, "Being prepared": no members, count or
  draw, and its athletes show no group in search. Search lists a Local athlete's locked groups through
  their entries, and an athlete's link opens only a group they are in. A guest is marked "(guest)".
- Component: `PublicEventClient`. Data: `getPublicFloorData` in `src/actions/public.ts`,
  `getTournamentActiveBouts` and `getRingActiveBout` in `matches.ts`, `getCategoryDraw` and
  `getAthleteDraw` in `draws.ts`.

## Scoreboard TV

- Route: `/scoreboard/[ringId]`.
- Who can open it: the tatami's moderator, the owning admin and the event's organisers. Anyone can
  open it if the admin enabled "show scoreboard publicly" (`tournaments.show_public_scoreboard`).
  The check is in the route's layout and again in the data actions behind it.
- Display only: names, school, score, penalties, senshu, clock, winner card and next bout. Kata
  bouts show flags or marks (`KataScoreboardStage`).
- Components: `ScoreboardClient` and `src/components/scoreboard/*`. The scoreboard and the public
  page are the only pages that may be embedded in a frame (OBS, venue displays); see
  `FRAME_ANCESTORS` in [../DEPLOYMENT.md](../DEPLOYMENT.md).

## Data rules

- Public reads go through dedicated actions that return minimal data: names, school, chest number,
  category, tatami, scores and status. They never include access codes, PINs, tokens, device info,
  IP addresses, admin email, the event log or request lists.
- The public toggles are enforced in the data actions, not only in layouts.
- The public live feed (`/api/live`) carries only ids and status for public tables. Screens refetch
  through their own actions. `division_holds`, `group_drafts`, `category_entries` and
  `kata_tie_decisions` are on the staff feed only.
- Never public: draw-sheet PDFs, the audit log, the activity log, staff names, category PDFs, and
  other tournaments' data.
- The public side is read only. It has no write actions.
