# RingFlow — Product Requirements

> What RingFlow does and for whom. Who may do what is in [docs/roles/](docs/roles/README.md);
> how it works inside is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 1. Vision
RingFlow runs a karate tournament floor end to end, in real time. It builds the draws, spreads
categories across tatamis, scores every bout at the table, drives the arena scoreboards, and tells
athletes and parents where and when they compete. At the end it produces an official record of
the event for the governing body.

It is built for WKF karate and for school and grassroots events (for example the CISCE presets),
at venues where the internet, power and budget are all unreliable.

## 2. Problems it solves
- Uneven tatami loads: some tatamis finish early while others overrun.
- Directors can't see where each tatami is up to.
- Athletes and parents don't know where or when they compete, so they keep asking officials.
- Paper brackets and score sheets are slow, error-prone, and hard to defend in a dispute.
- Governing bodies require an official, signed-off record of bouts, scores and winners.

## 3. Deployment model
- **Offline venue LAN:** one server (laptop or mini-PC) and a router. All devices
  use `http://<server-ip>:3000`. There are no internet dependencies.
- **Online / hosted:** the same build runs behind HTTPS on a cloud host when the
  venue has mobile data but no reliable local infrastructure.
- **Hybrid:** staff consoles on the LAN, with only judge phones reaching the server through a tunnel.
- The same codebase serves all three modes. Security never depends on the network: every action
  authorizes itself.

## 4. Roles (summary)
| Role | Purpose | Access |
|---|---|---|
| **Admin** | Owns and configures an event, approves staff, monitors everything | Email + password. Sees only their own tournaments |
| **Organiser** | Federation or desk observer | Code + admin approval. **Read-only**, one event |
| **Stager** | Call area / marshalling | Code + admin approval. Marks categories calling/ready, with optional attendance |
| **Moderator** | The one table official per tatami: runs the queue and scores bouts | Tatami code + admin approval. One tatami |
| **Judge** | Kata judge voting from their own phone | Tatami QR/PIN + moderator approval. One seat |
| **Public / Scoreboard** | Athletes, parents, spectators, TV screens | No login. Read-only, controlled by public toggles |

Full permission matrix: [docs/roles/README.md](docs/roles/README.md).

## 5. Disciplines
| Discipline | Status | Notes |
|---|---|---|
| Individual Kumite | Live | Yuko/Waza-ari/Ippon, senshu, C1/C2 penalties, decisions (points, hantei, kiken, hansoku, shikaku). Single elimination with repechage or 1–2 bronzes |
| Individual Kata | Live | Pool flights (preliminary scores rank only within the pool) followed by medal bouts that start from 0. Flag (majority) or points (5.0–10.0, drop high and low) modes. Bracket format optional |
| Team Kata / Team Kumite | Partial | Rulesets and registration flags exist. Floor operations are not built. See [docs/DISCIPLINES.md](docs/DISCIPLINES.md) |

## 6. Event lifecycle
**Setup (admin)**
1. Create the tournament: its type (Official or Local), name, date, venue, default bronze medals, public
   toggles. The type can be switched until the tournament has categories.
2. Add tatamis. Each one gets an access code (for the moderator) and a judge PIN.
3. Load category definitions (a preset such as CISCE Official, or custom age/weight/gender/event type).
4. Import athletes (Excel/CSV or manual). They're placed into categories automatically.
5. Choose the draw profile (Official WKF or organiser's rules), optionally seed athletes, then generate draws (preflight report → generate → review → **lock**). Pools of a large category can be split across tatamis. Draw-sheet PDFs are for staff only.
6. Balance the tatamis: drag categories onto tatamis and order each queue. Load is measured in bouts.
7. Issue codes, then approve organisers, stagers, and one moderator per tatami.

**Event day**
1. Stagers call each category's athletes and mark it **calling**, then **ready**.
2. The moderator starts the next category, picks a bout, runs the clock, scores, and confirms the
   result. The draw advances automatically, and kata pool finalists move into medal bouts.
3. Kata judges vote from their phones (or the moderator enters marks manually).
4. The scoreboard and the public page update live over SSE.
5. The moderator can pause or resume, send an emergency alert, or request assistance. The admin
   can pause or resume any tatami, or all of them.
6. The moderator finishes the category, and the next one in the queue follows.

**Close**
1. The admin exports results (CSV, PDF) and the official record, including the audit trail.
2. The admin sets the tournament status to `completed`.

## 7. Ring balancing & estimation
- A category's load is its expected bout count (kumite bracket size including repechage/bronze
  bouts; kata pool and medal bouts).
- The balancing board shows each tatami's categories, athletes and bouts so loads can be evened out
  by dragging categories between tatamis.
- The live dashboard shows an estimated finish time for each running tatami: remaining bouts times a
  fixed 109 seconds per bout. It is a rough guide, not a prediction learned from the event.

## 8. Live updates
- The server is authoritative. Clients subscribe to `/api/live` (SSE), scoped by tournament,
  tatami, category or request, and refetch through server actions when an event arrives.
- The match clock is computed on the server with millisecond precision. Screens compensate for drift.
- Polling exists only as a slow fallback when the stream is down.

## 9. Public experience
- No login and no install. The event link or QR code is the whole access path.
- Shows every tatami's current category and bout, the queue, ETA, and athlete search (name or
  chest number). Brackets are shown only when the admin enables them, except that an athlete's own
  bracket is always reachable through search.
- The TV scoreboard is public only when the admin enables it.
- Never exposed publicly: codes, PINs, tokens, staff data, logs, or draw-sheet PDFs.

## 10. Official record & audit
- Every official action (approvals, scores, results, overrides, draw changes, queue changes,
  settings) is recorded with who did it, from which session and device, what changed, and when.
- Confirmed results can only be corrected by the admin, with a mandatory reason, and the
  correction is audited.
- The official results PDF lists each bout's athletes, scores, decision, winner, and officiating
  moderator, plus any corrections.

## 11. Non-functional requirements
- **Security:** server-side authorization on every action, tenancy per admin, httpOnly scoped
  sessions, no secrets sent to clients, rate-limited code entry.
- **Offline-first:** no runtime calls to external services. Fonts and assets are self-hosted.
  Turnstile is optional.
- **Latency:** score change to scoreboard well under 1 s on a LAN.
- **Resilience:** a dropped SSE stream degrades to polling. A server restart doesn't lose clock
  state, because it's persisted in the DB.
- **Devices:** the moderator pad works on a tablet or laptop, judge and public screens on phones,
  and the scoreboard on a 1080p TV.
- **UI:** one consistent design language (`frontend-design/DESIGN.md`). Dense views must be
  scannable at a glance.

## 12. Out of scope (for now)
- Online registration and payments.
- Kumite judge devices (the moderator enters panel decisions).
- Syncing between an offline venue server and an online server.
- Multi-sport support beyond karate.

## 13. Success criteria
- A 6-tatami, 500-athlete event runs a full day with no paper brackets.
- Tatami finish times are within 30 minutes of each other after balancing.
- Every confirmed bout can be traced to an official in the audit trail.
- Zero unauthorized writes: every write action rejects unauthenticated or out-of-scope callers.
