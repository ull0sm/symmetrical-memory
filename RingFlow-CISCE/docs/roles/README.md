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
| Draw sheet PDFs | O | — | — | — | — | — |
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

## Sessions
| Role | Credential | Lifetime | Revocation |
|---|---|---|---|
| Admin | password → random session token (hashed in DB), httpOnly cookie | 7 days | logout / password change |
| Organiser | event code → admin approval → session token | 48 h | admin revokes |
| Stager | stager code → admin approval → session token (one per code) | 48 h | admin revokes, or the code is approved again |
| Moderator | tatami code → admin approval → session token (one per tatami) | 24 h | admin revokes, or a new moderator is approved |
| Judge | tatami QR/PIN + seat → moderator approval → session token | until the panel is closed, max 12 h | moderator removes the phone or ends the panel; a newly approved phone on the seat replaces it |

All session cookies are `httpOnly` and `SameSite=Lax`, and are `Secure` when served over HTTPS.
Tokens are stored hashed (sha256), and request IDs are never accepted as credentials. A staff
session is created only when the browser that made the request (it holds the claim cookie)
collects it after approval. Admin login, access-code requests and judge PINs are rate-limited.

## Where the auth code is
All in `src/lib/auth/` (plain modules, never callable from a browser):
- `principal.ts` — reads the session cookies and re-verifies each identity against the DB per request.
- `guards.ts` — `requireAdmin`, `requireTournamentAdmin`, `getTournamentStaff`/`requireTournamentStaff`,
  `getRingModerator`/`requireRingModerator`, `requireRingOperator`, `requireMatchModerator`, `requireJudge`.
- `scope.ts` — resolves ring/category/match/athlete → tournament (and tatami for matches).
- `claims.ts` — binds an access request to the browser that made it (claim cookie + hash).
- `cookies.ts` — cookie names and the one `setSessionCookie` (httpOnly, SameSite=Lax, Secure on HTTPS).

Admin login is in `src/actions/auth.ts`; each role's request/approve/revoke flow is in its
`src/actions/<role>.ts`. The request gate (`src/lib/http/requestGate.ts`) only does UX redirects.
