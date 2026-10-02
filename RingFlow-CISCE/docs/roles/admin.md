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
| Draws: preflight, generate, lock, unlock, seeds, draw profile (Official / Local-unofficial rules), hand swap (local only), flush, draw-sheet PDFs | categories page and draw drawer | `draws.ts`, `drawPdfs.ts` |
| Ring balancing: assign categories to tatamis and order each queue | `/admin/event/[id]/rings/balance` | `balancing.ts` |
| Where a category runs: one tatami, or pools on different tatamis (split, move, put back together) | split icon on a queued category card | `categoryRouting.ts` |
| Live dashboard: all tatamis, pause or resume one or all, activity feed, assistance requests | `/admin/event/[id]/dashboard` | `admin.ts`, `rings.ts`, `clock.ts` |
| Official record: audit log, results export (CSV, PDF) | `/admin/event/[id]/record` | `audit.ts`, `resultsExport.ts` |
| Judge panel override (approve, remove, rotate QR and PIN) | moderator's kata screen | `judgePanel.ts` |

## What an admin cannot do

- Score bouts or confirm results at the table. That is the tatami moderator's job.
- Reach tournaments owned by another admin.

## Running a category's pools on different tatamis

A bracket of 32 or more places prints as pools of 16 (a 64-place bracket is four pools), and a kata
flight has Pool A and Pool B. With two tatamis you can give pools 1-2 to one and pools 3-4 to the
other, so a pool winner does not wait for dozens of other bouts before meeting the other winners.

Assign the category to a tatami, then open **Where this category runs** (the split icon on its card). Choose
*One tatami*, or *Pools on different tatamis*: a tatami for each pool and one **finals tatami**. The
semi-finals, final, repechage, bronze bouts and the kata medal flight run there, and start only once every
pool has been finished by its tatami's moderator. Each part joins the end of its tatami's queue and shows as
"Category · Pool 3" on the moderator, dashboard and public screens; each pool page of the draw sheet prints its
tatami.

You can change this whenever you like with the same dialog: move a pool or the finals to another tatami, split
a category part-way through, or put it back together. Bouts already fought keep their results (they are stored
on the bouts, not on the tatami), and each pool keeps the progress it had. What cannot change: a pool with a
bout **live right now** (finish or reset that bout first; the dialog names it) and a pool that has already
finished. A pool that is on a mat between bouts can move and returns to the queue of its new tatami.

**Who is in which pool.** Once a category is drawn with pools, each pool's athletes are listed in the
draw drawer ("Pools"), in the split dialog ("Who is in each pool"), and on the athletes roster, where
every athlete carries a "Pool 3 · Tatami 2" badge and the roster can be filtered by pool. The bracket
view has tabs for the whole draw, each pool and the finals; the finals show "Pool 1 winner" in place of
bouts they are waiting for.

Other rules: the category must be drawn first; redrawing a split category (nothing fought) keeps its routing when
the new draw has the same number of pools, and puts it back on one card otherwise (flushing the draw does the
same); each tatami's moderator scores only its own pools. Every change is audited.

**On the balancing board** a split category is not one card with notes underneath: each pool and the finals is
its own card on the tatami that runs it ("Big Kumite · Pool 3", with that pool's athletes, bouts and progress), so a
tatami's totals (time, athletes, bouts) count exactly what runs there. A pool card says where its winner goes; the
finals card says "Waiting for pools 2, 3" until they finish. Drag a pool or the finals card within its tatami to
reorder it, or onto another tatami to move it (the server checks what is live first). The split dialog opens only from the **Pool 1** card (the other cards of that category don't show the split
button), and Pool 1 also carries a second bar for the whole category: all pools plus the finals. The board cannot drop a split
category off the tatamis; use the split dialog to put it back together. Other screens open on the same cards and
reload their layout by themselves when a category is split, merged or moved.

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
3. Choose the draw profile (Official WKF or Local / Unofficial rules) in settings, optionally seed athletes, run the draw preflight, generate draws, review them, then lock them. A draw is never regenerated over fought bouts; the only way past them is an audited flush with a reason.
4. Balance categories across tatamis.
5. Share the codes. Approve organisers, stagers and one moderator per tatami.
6. On the day, watch the dashboard, handle alerts, pause or resume tatamis.
7. Afterwards export the results and the official record, and set the tournament to `completed`.
