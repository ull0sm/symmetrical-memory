# Admin (Tournament Director)

**Who:** the person who owns and runs an event. They set up the event, assign the floor, approve
staff, and watch every tatami live.

## Access
- `/login/admin` uses email and password. The page isn't linked from public pages.
- Accounts are created with `npm run db:create-admin`. There's no self sign-up and no default password.
- Scope: **only tournaments where `tournaments.admin_id` = this admin.** Admins never see or change
  another admin's events.

## Can
| Area | Route | Actions file |
|---|---|---|
| List / create tournaments | `/admin`, `/admin/create` | `tournament.ts` |
| Event settings: name, date, venue, status, public toggles, bronze default, tunnel URL, delete | `/admin/event/[id]/settings` | `settings.ts` |
| Organiser approvals + organiser code | settings page | `organiser.ts` |
| Rings: add/delete, access code, judge PIN | `/admin/event/[id]/rings` | `rings.ts`, `kata.ts` |
| Stager codes + approvals | rings page | `stager.ts` |
| Moderator approvals / revoke | dashboard widget, rings page | `moderator.ts` |
| Categories, definitions, presets, kata settings, category PDFs | `/admin/event/[id]/categories` | `categories.ts`, `categoryDefinitions.ts`, `categoryDocs.ts` |
| Athletes: add, bulk import, move, delete | `/admin/event/[id]/athletes` | `athletes.ts`, `officialImport.ts` |
| Draws: preflight, generate, lock/unlock, flush, draw-sheet PDFs (admin only) | categories page / draw drawer | `draws.ts`, `drawPdfs.ts` |
| Ring balancing (assign + order categories per tatami) | `/admin/event/[id]/rings/balance` | `balancing.ts` |
| Live dashboard: all tatamis, pause/resume one or all, activity feed | `/admin/event/[id]/dashboard` | `admin.ts`, `rings.ts`, `clock.ts` |
| Results export (CSV, PDF) | dashboard / settings | `resultsExport.ts` |

## Cannot
- Score bouts or confirm results. That's the tatami moderator's job. Correcting a confirmed result
  after the category has left the mat is a separate audited "result correction" action (Phase 3).
- Access tournaments owned by another admin.

## Workflow
1. Create the tournament, then rings, then load category definitions (preset or custom).
2. Import athletes. Categories sync automatically.
3. Generate draws, check them, then lock them.
4. Balance categories across tatamis.
5. Share codes. Approve the organiser(s), stagers, and one moderator per tatami.
6. Event day: monitor the dashboard, handle emergencies and assistance requests, pause or resume tatamis.
7. Afterwards: export results and the official record. Set the tournament status to `completed`.

## Known gaps (see [PLAN.md](../PLAN.md))
- Phase 3: no audit viewer and no admin "correct a confirmed result" flow yet.
