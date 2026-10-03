# Organiser (read-only observer)

Federation or school officials, coordinators and desk staff. They need to see everything about one
event and must not be able to change anything.

## Access

- Sign in at `/login/organiser` with the tournament's organiser code and a name. The admin can
  regenerate the code in settings.
- The request waits at `/organiser/waiting/[requestId]` until the admin approves it. The browser
  then receives an `org_token` session valid for 48 hours. Several organisers can be approved at once.
- Scope: one tournament, read only.

## What an organiser can see

| View | Route |
|---|---|
| Live overview of all tatamis | `/organiser/event/[id]/dashboard` (the admin dashboard in `readOnly` mode) |
| Athlete roster | `/organiser/event/[id]/athletes` |
| Categories and brackets | `/organiser/event/[id]/categories` |
| Ring balance board | `/organiser/event/[id]/rings/balance` |
| Official record: audit log and results export (CSV, PDF) | `/organiser/event/[id]/record` |

In a Local tournament the categories and athletes pages show the Local categories (plans, starting
groups and their members, tatamis) and the roster with each athlete's category and events, read only.

## What an organiser cannot do

Anything that writes: settings, categories, athletes, draws, assignments, approvals, clocks, pauses
or scoring. They also cannot download draw-sheet PDFs. There are no organiser write paths in the
code, and adding one would be a design error.

The guards behind these views are `requireTournamentStaff(tournamentId, ["admin", "organiser"])` in
`src/actions/admin.ts`, `audit.ts` and `resultsExport.ts`.
