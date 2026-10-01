# Roles & Permissions

The authoritative permission model. Each role has its own file:
[admin](admin.md) · [organiser](organiser.md) · [stager](stager.md) · [moderator](moderator.md) ·
[judge](judge.md) · [public & scoreboard](public.md)

This file and the role files describe the **target** rules. Where the code doesn't follow them yet,
each role file says so under **Known gaps**, with a link to [PLAN.md](../PLAN.md).

## Principles
- **Security lives in server actions.** Every exported action in `src/actions/` checks the caller's
  role and scope itself. Middleware, page guards and `readOnly` props only shape the UI.
- **Tenancy:** everything belongs to a tournament, and a tournament belongs to exactly one admin.
  Each request resolves the target row's tournament and checks the caller against it.
- **Least scope:** a moderator is bound to one tatami, a judge to one tatami seat, and an organiser
  or stager to one tournament.
- **No accounts for floor staff.** Organiser, stager, moderator and judge request access with a
  code. A human approves the request. They then get a temporary, scoped session that can be revoked.
- **Everything officials do is audited** (who, what, when, before/after).

## Permission matrix
`O` = own scope only. `R` = read. `—` = no access.

| Capability | Admin | Organiser | Stager | Moderator | Judge | Public |
|---|---|---|---|---|---|---|
| Create / edit / delete tournament | O | — | — | — | — | — |
| Event settings, public toggles | O | R | — | — | — | — |
| Rings: add/delete, access codes, judge PIN | O | R | — | rotate own tatami PIN | — | — |
| Categories & category definitions | O | R | R | R (own tatami queue) | — | R (names) |
| Athletes roster / import | O | R | R | R (current bout) | — | search only |
| Generate / lock / flush draws | O | — | — | — | — | — |
| View draws / brackets | O | R | R | R | — | if `showPublicDraws`, or own athlete |
| Draw sheet PDFs | O | R | R | R | — | — |
| Ring balancing (assign/reorder categories) | O | R | R | reorder own pending queue | — | — |
| Approve organiser / stager / moderator | O | — | — | — | — | — |
| Approve / kick judges | O | — | — | own tatami | — | — |
| Start / finish / pause category | O (override) | — | — | own tatami | — | — |
| Score bouts, confirm results, run clock | — | — | — | own tatami | — | — |
| Kata judge votes | — | — | — | override/void, audited | own seat, current bout | — |
| Mark category calling / ready | O | — | O | R | — | — |
| Athlete attendance (optional) | O | — | O | R | — | — |
| Live dashboard, all tatamis | O | R | R | own tatami | — | R (public view) |
| Audit log | O | R | — | — | — | — |
| Results export (CSV/PDF) | O | R | — | — | — | — |
| Scoreboard TV | O | R | — | own tatami | — | if `showPublicScoreboard` |

## Sessions (target)
| Role | Credential | Lifetime | Revocation |
|---|---|---|---|
| Admin | password → random session token (hashed in DB), httpOnly cookie | 7 days | logout / password change |
| Organiser | event code → admin approval → session token | 48 h | admin revokes |
| Stager | stager code → admin approval → session token (one per code) | 48 h | admin revokes, or the code is approved again |
| Moderator | tatami code → admin approval → session token (one per tatami) | 24 h | admin revokes, or a new moderator is approved |
| Judge | tatami QR/PIN + seat → moderator approval → session token | until the panel is closed, max 12 h | moderator kicks, or the PIN is rotated |

All session cookies are `httpOnly` and `SameSite=Lax`, and are `Secure` when served over HTTPS.
Tokens are stored hashed, and request IDs are never accepted as credentials.

## Where the auth code is
- Admin: `src/actions/auth.ts`, `ensureAdmin` / `ensureAdminOwnsTournament` in `src/actions/admin.ts`
- Organiser: `src/actions/organiser.ts`
- Stager: `src/actions/stager.ts`
- Moderator: `src/actions/moderator.ts` (`validateModeratorSession`)
- Judge: `src/actions/judgeAuth.ts`, `src/actions/kata.ts`
- Cross-role staff check: `src/lib/staffAccess.ts`
- Middleware (UX redirects + tunnel host block): `src/utils/supabase/middleware.ts`

PLAN Phase 2 replaces these with one module, `src/lib/auth/`. Update this list when that lands.
