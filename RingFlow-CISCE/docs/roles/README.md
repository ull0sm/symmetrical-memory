# Roles and permissions

RingFlow has six kinds of user. Each has its own page in this folder:
[admin](admin.md) · [organiser](organiser.md) · [stager](stager.md) · [moderator](moderator.md) ·
[judge](judge.md) · [public and scoreboard](public.md)

## Principles

- **Security lives in server actions.** Every exported action in `src/actions/` checks the caller's
  role and scope itself. The request gate (`src/proxy.ts`), page layouts and `readOnly` props only
  shape the UI; anyone can POST to an action, so they protect nothing.
- **Tenancy.** Everything belongs to a tournament, and a tournament belongs to exactly one admin.
  Each guard resolves the target row's real tournament and checks the caller against it. A
  `tournamentId` sent by the client is never trusted on its own.
- **Least scope.** A moderator is bound to one tatami, a judge to one seat on one tatami, and an
  organiser or stager to one tournament.
- **No accounts for floor staff.** Organisers, stagers, moderators and judges ask for access with a
  code. A human approves the request, and the browser that asked then receives a temporary,
  revocable session.
- **Everything officials do is audited**: who, what, when, and the before and after values.

## Permission matrix

`O` = own scope only, `R` = read only, `-` = no access.

| Capability | Admin | Organiser | Stager | Moderator | Judge | Public |
|---|---|---|---|---|---|---|
| Create, edit, delete a tournament | O | - | - | - | - | - |
| Event settings and public toggles | O | - | - | - | - | - |
| Add or delete tatamis, regenerate access codes | O | - | - | - | - | - |
| Categories and category definitions | O | R | R | R (own queue) | - | names only |
| Athlete roster, import, moves | O | R | R | R (current bout) | - | search only |
| Local tournament setup: belt list and defaults, categories, plans, starting groups, a category's tatami | O | R | - | - | - | - |
| Choose the draw profile, set seeds, generate, lock, unlock, flush draws, swap athletes by hand (organiser's rules only) | O | - | - | - | - | - |
| Split a category's pools across tatamis, move or merge them | O | - | - | - | - | - |
| View draws and brackets | O | R | R | R | - | if "show draws publicly", or their own athlete |
| Draw-sheet PDFs | O | - | - | - | - | - |
| Ring balancing (assign and order categories) | O | R | R | reorder own pending queue | - | - |
| Approve organisers, stagers, moderators | O | - | - | - | - | - |
| Approve or remove judges, rotate the QR and PIN | O | - | - | own tatami | - | - |
| Start, finish, pause a category | O (pause and clock only) | - | - | own tatami | - | - |
| Score bouts, confirm results | - | - | - | own tatami | - | - |
| Correct a confirmed result | O (reason required) | - | - | own tatami, while on the mat (reason required) | - | - |
| Run the bout clock | O (override) | - | - | own tatami | - | - |
| Kata votes | - | - | - | open, close, void, override | own seat, current bout | - |
| Mark a category calling or ready | O | - | O | R | - | - |
| Athlete attendance | O | - | O | R | - | - |
| Live dashboard of all tatamis | O | R | - | own tatami | - | public floor view |
| Audit log | O | R | - | - | - | - |
| Results export (CSV, PDF) | O | R | - | - | - | - |
| Scoreboard TV | O | R | - | own tatami | - | if "show scoreboard publicly" |

## Sessions

| Role | Credential | Lifetime | Ends when |
|---|---|---|---|
| Admin | email and password; random token in an httpOnly cookie, SHA-256 hash in `admin_sessions` | 7 days | logout |
| Organiser | tournament organiser code, then admin approval | 48 hours | admin revokes it |
| Stager | one of the tournament's stager codes, then admin approval | 48 hours | admin revokes it, or the code is approved for someone else |
| Moderator | tatami access code, then admin approval | 24 hours | admin revokes it, or a new moderator is approved for the tatami |
| Judge | tatami QR link or PIN plus a seat, then moderator approval | 12 hours | moderator removes the phone or ends the panel, or a new phone takes the seat |

Lifetimes are defined in `src/lib/constants/index.ts`. All session cookies are `httpOnly` and
`SameSite=Lax`, and are `Secure` when the request came over HTTPS. Tokens are stored as SHA-256
hashes. A request ID is never accepted as a credential: an approved staff session is only handed to
the browser that made the request, which proves it with a claim cookie (`src/lib/auth/claims.ts`).

Wrong passwords, access codes and judge PINs are rate limited (`src/lib/rateLimit.ts`). Only failed
attempts count, so a busy desk that logs in correctly is never throttled.

A browser can hold several identities at once, for example an admin testing the moderator pad. Each
guard looks for the identity it needs.

## Where the auth code is

All in `src/lib/auth/`. These are plain modules, not `"use server"`, so a browser cannot call them.

| File | Purpose |
|---|---|
| `principal.ts` | Reads the session cookies and re-verifies each identity against the database on every request |
| `guards.ts` | `requireAdmin`, `requireTournamentAdmin`, `requireTournamentStaff`, `requireRingModerator`, `requireRingOperator`, `requireMatchModerator`, `requireJudge` and their non-throwing `get...` versions |
| `scope.ts` | Resolves a ring, category, athlete or match to its tournament (and tatami) |
| `claims.ts` | Binds an access request to the browser that made it |
| `cookies.ts` | Cookie names and the single `setSessionCookie` helper |
| `password.ts`, `tokens.ts` | Password hashing, token generation and hashing |

Admin login is `src/actions/auth.ts`. Each role's request, approve and revoke flow lives in
`src/actions/<role>.ts`.
