# RingFlow

**High-Performance Real-Time Tournament Floor Management & Scoring Platform**

RingFlow is a modern, real-time tournament operations and scoring platform purpose-built for multi-ring martial arts championships (Karate WKF Kumite/Kata, Taekwondo, and combat sports). It unifies tournament directors, registration organisers, staging marshalls, mat-side table officials, arena TV scoreboards, and public spectators into a single coordinated, sub-millisecond digital ecosystem.

---

## Key Capabilities

* 🥊 **Official WKF Bout Scoring Pad**: Dedicated ring-side controller for table officials supporting 1-point (Yuko), 2-point (Waza-ari), and 3-point (Ippon) scores, Senshu (first-uncontested point advantage), Category 1 & Category 2 penalties, official decision methods (Points, Hantei, Kiken, Hansoku, Shikaku), and side-swapping for custom display orientations.
* ⏱️ **Synchronized Match Clock & Buzzer**: Authoritative millisecond-precision ring clock with sound buzzer notifications, pause/resume, run segment accumulation, and network drift compensation.
* 📺 **Broadcast-Grade Arena Scoreboards**: Fullscreen, responsive TV displays for each tatami/ring showing active scores, live timer, athlete names, schools/countries, penalties, and winner announcements with customizable scaling.
* 🌳 **Automated Draw & Bracket Engine**: Instant single-elimination, repechage, and round-robin bracket generation with intelligent bye distribution, seeding, and automatic winner progression to subsequent rounds.
* ⚖️ **Dynamic Ring Balancing**: Visual drag-and-drop category load balancer allowing tournament directors to distribute divisions across rings and predict estimated completion times.
* 📋 **Multi-Role Marshalling & Staging**: Dedicated stager interface for call-ups, on-deck athlete tracking, and category queue sequencing.
* 📱 **Zero-Install Public Portal**: Spectators and athletes scan a QR code to view live ring progression, bracket status, and search for competitors by chest number or name with zero login required.
* ⚡ **Real-Time Architecture**: Powered by Next.js Server-Sent Events (SSE) via `/api/live`, PostgreSQL `LISTEN/NOTIFY`, and an in-memory event bus—delivering instant screen updates with zero polling lag.
* 📄 **Professional Reporting & Exports**: High-resolution printable draw sheet PDFs and tournament results export to Excel (XLSX).

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RINGFLOW CLIENTS                               │
│  Admin Console  │  Organiser Desk  │  Stager View  │  Moderator Pad  │ Scoreboard  │ Spectator Web
└───────┬─────────┴────────┬─────────┴───────┬───────┴────────┬────────┴──────┬──────┴───────┬─────┘
        │                  │                 │                │               │              │
        ▼                  ▼                 ▼                ▼               ▼              ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NEXT.JS APPLICATION SERVER                                     │
│  - App Router & React 19 Server Components                                                       │
│  - Type-safe Server Actions (admin, organiser, stager, moderator, matches, clock, draws)         │
│  - Server-Sent Events (SSE) live endpoint (/api/live) with real-time scope filtering             │
│  - Standalone production output for minimal footprint                                            │
└─────────────────────────────────┬───────────────────────────────┬────────────────────────────────┘
                                  │                               │
                                  ▼                               ▼
                 ┌─────────────────────────────────┐   ┌────────────────────────────────┐
                 │     DRIZZLE ORM ENGINE          │   │  REALTIME BUS (LISTEN/NOTIFY)  │
                 │   Sub-millisecond queries,      │   │  Single-conn listener with     │
                 │   type-safe relational schema   │   │  instant in-memory fanout      │
                 └────────────────┬────────────────┘   └───────────────┬────────────────┘
                                  │                                    │
                                  └─────────────────┬──────────────────┘
                                                    │
                                                    ▼
                               ┌────────────────────────────────────────┐
                               │           POSTGRESQL DATABASE          │
                               │   Tables: tournaments, rings, matches, │
                               │   categories, draws, athletes, logs    │
                               └────────────────────────────────────────┘
```

---

## User Roles & Operational Workflows

> Authoritative role rules: [docs/roles/](docs/roles/README.md). Known gaps: [docs/PLAN.md](docs/PLAN.md).

| Persona | Access Route | Authentication / Access Model | Primary Capabilities |
| :--- | :--- | :--- | :--- |
| **Tournament Director (Admin)** | `/admin` | Email + Password (`admin@ringflow.org`) | Full tournament oversight, create/edit rings and categories, monitor live tatami statuses, approve moderator/stager access requests, balance categories across rings, configure audit settings. |
| **Tournament Organiser** | `/organiser` | Event organiser code + admin approval | **Read-only** observer of one event: live overview, roster, categories, ring balance, brackets, and results. |
| **Staging Marshall** | `/stager` | Code-based request (`STAGE01`) with Admin approval | Marshalling area view to call up competitors, inspect category bout sequences, verify athlete presence, and ready divisions for tatami assignment. |
| **Tatami Table Official (Moderator)** | `/moderator/ring/[ringId]/current` | Ring Access Code (`RING01`…) with Admin approval | Control active bout: Yuko/Waza-ari/Ippon points, Senshu advantage, C1/C2 penalties, start/stop match timer, swap display sides, record bout outcome, advance to next match. |
| **Arena TV Scoreboard** | `/scoreboard/[ringId]` | Direct URL / Mat-side display | Fullscreen spectator and athlete-facing display showing live scores, names, schools, match timer, penalty markers, and winner cards. |
| **Public Spectators & Athletes** | `/public/event/[id]` | Public URL / QR Code (No login required) | Real-time mat tracker, live bout status, category bracket viewer, athlete search by name or chest number. |

---

## Technology Stack

* **Core Framework**: [Next.js](https://nextjs.org/) (App Router, Server Actions, Standalone output)
* **Frontend Library**: [React](https://react.dev/) 19 & TypeScript
* **Styling**: [Tailwind CSS](https://tailwindcss.com/) v4
* **Database & ORM**: [PostgreSQL](https://www.postgresql.org/) (v16) with [Drizzle ORM](https://orm.drizzle.team/)
* **Realtime Sync**: Server-Sent Events (SSE) via `/api/live` backed by Postgres `LISTEN/NOTIFY` and an in-memory event bus
* **PDF & Document Engine**: `pdf-lib` for dynamic tournament bracket sheet generation and `xlsx` for official tournament result exports
* **Security & Bot Protection**: Cloudflare Turnstile (with automated local development bypass)

---

## Production Readiness

RingFlow is optimized for production deployment via Docker containerization or standalone Node.js execution.

### 1. Docker Production Build (Multi-Stage)

RingFlow includes a multi-stage [Dockerfile](Dockerfile) based on Node.js 22 Alpine leveraging Next.js standalone output:

```bash
# Build the production image
docker build -t ringflow:latest .

# Run the production container
docker run -d \
  --name ringflow-app \
  -p 3000:3000 \
  -e DATABASE_URL="postgres://event_suite:event_suite@<DB_HOST>:5432/ringflow" \
  -e NEXT_PUBLIC_SUPABASE_URL="http://<SERVER_HOST>:3000" \
  ringflow:latest
```

### 2. Standalone Bare-Metal / PM2 Deployment

```bash
# 1. Install production dependencies and build
npm ci
npm run build

# 2. Run with Node or PM2
NODE_ENV=production node .next/standalone/server.js
# Or with PM2:
pm2 start .next/standalone/server.js --name "ringflow"
```

### 3. Verification & Code Quality

The codebase enforces strict production build and linting standards:

```bash
npm run lint          # ESLint 9 validation (0 errors)
npm run build         # Next.js compilation, route validation & typecheck
```

---

## Administrator Management

Create or update tournament administrator accounts directly from the command line:

```bash
npm run db:create-admin -- --email=admin@ringflow.org --password=yourpassword --name="Tournament Director"
```

Or using positional arguments:

```bash
npm run db:create-admin admin@ringflow.org yourpassword "Tournament Director"
```

---

## Offline Venue & Homelab Deployment

RingFlow is engineered for **100% offline venue operations** without internet connectivity (e.g. Proxmox homelab desktop running Ubuntu VM connected directly to a TP-Link wireless router):

1. **Air-Gapped Setup**: Self-hosted fonts (`/fonts/material-symbols-outlined.woff2`), embedded browser PDF viewer, and in-memory SSE bus.
2. **Turnstile Bypass**: Set `OFFLINE_MODE="true"` and `TURNSTILE_SECRET_KEY="disabled"` in `.env.local` to allow instant LAN logins for table officials and marshalls without external Cloudflare requests.
3. **LAN Binding**: `npm run start` automatically binds to `0.0.0.0:3000`, allowing all devices connected to the TP-Link router to open `http://<SERVER_IP>:3000`.

👉 Read the complete step-by-step [OFFLINE_VENUE_GUIDE.md](OFFLINE_VENUE_GUIDE.md).

---

## Kata Pool Flight & Medal Round Architecture

RingFlow implements official WKF Kata rules with strict point isolation between preliminary pools and medal flights:

1. **Preliminary Flight Pools (Pool A & Pool B)**:
   * Competitors perform their preliminary kata and receive scores (5-judge Olympic drop or points deductions).
   * Preliminary points determine **rank in pool only** to decide qualifiers.
2. **Championship & Medal Flight Bouts**:
   * Top 2 from each pool advance to the Medal Flight (Gold Final and Bronze matches).
   * **Bout Scores are Strictly Independent**: Preliminary points (e.g. `16.20 pts`) do **not** carry over as the final bout score. They are displayed transparently as "Pool Qualification Scores" while the Championship matches start fresh from `0.00`.
   * Final medals (🥇 Gold, 🥈 Silver, 🥉 Bronze) are awarded solely based on the results of the completed Medal Bouts.

---

## Quick Navigation

* **Offline Venue Deployment**: Follow the [OFFLINE_VENUE_GUIDE.md](OFFLINE_VENUE_GUIDE.md) for homelab & TP-Link air-gapped setup.
* **Local Quickstart**: Follow the [QUICKSTART.md](QUICKSTART.md) guide to spin up PostgreSQL and seed demo data.
* **Contributing**: Review [CONTRIBUTING.md](CONTRIBUTING.md) for architecture guidelines and coding conventions.
