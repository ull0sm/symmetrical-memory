# Admin (tournament director)

The person who owns and runs an event. They set it up, assign the floor, approve staff and watch
every tatami live.

## Access

- Sign in at `/login/admin` with email and password. The page is not linked from public pages.
- Accounts are created from the command line: `npm run db:create-admin`. There is no self sign-up
  and no default password. Running the command again for an existing email resets its password.
- Scope: only tournaments where `tournaments.admin_id` is this admin. Admins never see or change
  another admin's events.

## What an admin can do

| Area | Route | Actions file |
|---|---|---|
| List and create tournaments | `/admin`, `/admin/create` | `tournament.ts` |
| Event settings: name, date, venue, status, public toggles, default bronze medals, tunnel URL, delete | `/admin/event/[id]/settings` | `settings.ts` |
| Organiser code and approvals | settings page | `organiser.ts` |
| Tatamis: add, delete, regenerate access code | `/admin/event/[id]/rings` | `rings.ts` |
| Stager codes and approvals | tatamis page | `stager.ts` |
| Moderator approvals and revocation | dashboard widget, tatamis page | `moderator.ts` |
| Categories, category definitions, presets, kata settings, category PDFs | `/admin/event/[id]/categories` | `categories.ts`, `categoryDefinitions.ts`, `categoryDocs.ts` |
| Athletes: add, bulk import, move, delete | `/admin/event/[id]/athletes` | `athletes.ts`, `officialImport.ts` |
| Draws: preflight, generate, lock, unlock, flush, draw-sheet PDFs | categories page and draw drawer | `draws.ts`, `drawPdfs.ts` |
| Ring balancing: assign categories to tatamis and order each queue | `/admin/event/[id]/rings/balance` | `balancing.ts` |
| Live dashboard: all tatamis, pause or resume one or all, activity feed, assistance requests | `/admin/event/[id]/dashboard` | `admin.ts`, `rings.ts`, `clock.ts` |
| Official record: audit log, results export (CSV, PDF) | `/admin/event/[id]/record` | `audit.ts`, `resultsExport.ts` |
| Judge panel override (approve, remove, rotate QR and PIN) | moderator's kata screen | `judgePanel.ts` |

## What an admin cannot do

- Score bouts or confirm results at the table. That is the tatami moderator's job.
- Reach tournaments owned by another admin.

## Correcting a result

Only the admin can correct a confirmed kumite bout after its category has left the mat. Open
Categories, open the bracket, and choose "Correct result" on the bout
(`ResultCorrectionDialog` calls `correctBoutResult`). A reason of at least five characters is
required and goes into the audit log and the official record.

If the bout's old winner already played later bouts, the correction is refused until the admin
confirms a rollback. Those later bouts are then refilled and reset, and the audit entry records
that a rollback happened.

## Typical flow

1. Create the tournament, then add tatamis and load category definitions (a preset or custom).
2. Import athletes. Categories fill automatically.
3. Run the draw preflight, generate draws, review them, then lock them.
4. Balance categories across tatamis.
5. Share the codes. Approve organisers, stagers and one moderator per tatami.
6. On the day, watch the dashboard, handle alerts, pause or resume tatamis.
7. Afterwards export the results and the official record, and set the tournament to `completed`.
