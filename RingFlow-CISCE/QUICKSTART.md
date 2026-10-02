# Quickstart Guide: Local Setup & Feature Testing

This guide walks you through running RingFlow on your local machine (`localhost`), seeding a complete realistic karate championship, and testing every major operational feature—from admin balancing and bracket generation to live WKF bout scoring and real-time arena scoreboards.

---

## Prerequisites

* **Node.js**: Version `22.0.0` or higher (`node -v`)
* **Docker Desktop** (or a local PostgreSQL 16 installation)

---

## 5-Minute Quick Setup

### 1. Install Dependencies

From the `RingFlow-CISCE` directory:

```bash
npm install
```

### 2. Configure Environment

Copy the environment template:

```bash
cp .env.example .env.local
```

The default values in `.env.example` point to `127.0.0.1:5432` with username/password `event_suite:event_suite` and database `ringflow`.

> [!NOTE]
> If you are running Docker inside **WSL2** and accessing it from Windows, ensure your `DATABASE_URL` uses the reachable container or WSL IP (e.g. `postgres://event_suite:event_suite@<IP>:5432/ringflow`).

### 3. Start PostgreSQL

Use the provided Docker Compose service to start a dedicated PostgreSQL container:

```bash
docker compose up -d db
```

Verify that the database is healthy:

```bash
npx tsx scripts/test-db.ts
```

### 4. Push Schema & Seed Realistic Demo Championship

Apply the Drizzle database schema and seed a full tournament:

```bash
npm run db:push
npm run db:migrate
npm run db:seed
```

The seed script creates:
* 👤 **Administrator**: `admin@ringflow.org` / `admin123`
* 🏆 **Tournament**: *CISCE National Karate Championship 2026* (Organiser code: `ORG001`)
* 🥋 **4 Rings (Tatami)**:
  * Tatami 1 (Code: `RING01`)
  * Tatami 2 (Code: `RING02`)
  * Tatami 3 (Code: `RING03`)
  * Tatami 4 (Code: `RING04`)
* 📋 **Official Categories & Roster**: Boys & Girls U14 divisions with Kata and Kumite entries
* 🌳 **Digital Brackets**: Pre-generated single-elimination tournament draws
* 🎛️ **Pre-Approved Ring 1 Session**: Instant testing of the live scoring pad without waiting for approval

> [!TIP]
> Need a completely fresh start at any time? Run:
> ```bash
> npm run db:reset
> ```
> This safely empties all test tables and re-seeds the clean demo championship.

### 5. Start the Application

Start the Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

*(Or to test in production mode: `npm run build && npm run start`)*

---

## Feature Testing & Guided Tour

Once the server is running, you can test every persona simultaneously by opening different browser windows or tabs.

### Tour 1: Admin Command Room
1. Go to [http://localhost:3000/login/admin](http://localhost:3000/login/admin).
2. Sign in with:
   * **Email**: `admin@ringflow.org`
   * **Password**: `admin123`
3. Click into the **CISCE National Karate Championship 2026**.
4. Explore:
   * **Live Ring Monitor**: View real-time status, active bouts, and progress across all 4 tatamis.
   * **Ring Balancing**: Open `/admin/event/[id]/rings/balance` to visually drag and balance categories across rings.
   * **Moderator Approvals**: Ring requests from table officials appear here for instant one-click approval.

---

### Tour 2: Tournament Organiser Desk
1. Go to [http://localhost:3000/login/organiser](http://localhost:3000/login/organiser).
2. Enter the access code: `ORG001` and your name.
3. Submit the request (if not pre-approved, approve it from the Admin tab).
4. In the Organiser portal:
   * **Category Definitions**: View official age, weight, and rules presets.
   * **Athletes Roster**: Review multi-event athletes participating in Kata and Kumite.
   * **Draws & Brackets**: Inspect generated brackets, seeds, and byes.
   * **PDF & Excel Export**: Download high-resolution draw sheets and tournament results.

---

### Tour 3: Real-Time Bout Scoring Pad & Arena Scoreboard (Side-by-Side Test)

This is the core experience. Open two side-by-side browser windows:

* **Window 1 (Table Official / Moderator)**:
  Open [http://localhost:3000/moderator/ring/f1bd9c67-1f67-4981-897f-ddf298a67533/current](http://localhost:3000/moderator/ring/f1bd9c67-1f67-4981-897f-ddf298a67533/current) (Tatami 1).
  *(Or log in at `/login/mod` using access code `RING01`)*.

* **Window 2 (Arena TV Scoreboard)**:
  Open [http://localhost:3000/scoreboard/f1bd9c67-1f67-4981-897f-ddf298a67533](http://localhost:3000/scoreboard/f1bd9c67-1f67-4981-897f-ddf298a67533).
  *(Press `F11` for broadcast fullscreen)*.

#### Interactive Actions to Test:
1. **Clock Control**: Click **Start** on the moderator pad. Watch the timer count down with millisecond precision in both windows simultaneously!
2. **Audio Buzzer**: Let the timer reach 0:00 or click reset/adjust to hear the ring bell buzzer sound.
3. **Point Scoring**:
   * Click **+1** (Yuko) for Aka (Red).
   * Click **+2** (Waza-ari) or **+3** (Ippon) for Ao (Blue).
   * Notice that the Scoreboard updates immediately without reloading.
4. **Senshu Advantage**: Toggle Senshu (first-uncontested point advantage) on either athlete.
5. **Penalties**: Click **C1** or **C2** penalty buttons and observe the visual penalty indicators on the arena board.
6. **Side Swapping**: Click **Swap Sides** to instantly mirror the red and blue positions on the TV scoreboard to match the referee's visual orientation on the mat.
7. **Bout Completion**: Declare a winner (Points, Hantei, Kiken, Hansoku). Confirm the result to automatically advance the bracket to the next round!

---

### Tour 4: Public Spectator & Athlete Portal
1. Open [http://localhost:3000](http://localhost:3000) or open `/public/event/<tournament-id>`.
2. No login is required.
3. Search for any competitor by chest number (e.g. `101`, `102`, `201`) or athlete name (e.g. `Mohammed`, `Ananya`).
4. View live mat assignment, estimated start time, and bracket progression.

---

## How Real-Time Synchronization Works

RingFlow uses a zero-delay **Server-Sent Events (SSE)** architecture:

* **Endpoints**: `/api/live` (public: scoreboards, spectators, judge phones) and `/api/live/staff` (needs a staff session) connect the browser to an in-memory event bus and PostgreSQL `LISTEN/NOTIFY`.
* **Zero Polling Overhead**: Changes made by table officials trigger immediate broadcast events to all active scoreboard, admin, and spectator clients.
* **Resilient Fallback**: If a connection drops temporarily, the client automatically falls back to periodic validation before silently reconnecting.

---

## Useful NPM Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Start Next.js development server on `http://localhost:3000` |
| `npm run build` | Compile Next.js production build with strict type-checking and standalone bundling |
| `npm run start` | Run the compiled production application |
| `npm run lint` | Run ESLint 9 validation |
| `npm run db:push` | Synchronize the Drizzle schema directly to PostgreSQL |
| `npm run db:migrate` | Apply the SQL migrations (triggers, audit log, judge sessions); safe to re-run |
| `npm run db:seed` | Seed realistic demo tournament, rings, categories, and draws |
| `npm run db:reset` | Cleanly wipe and re-seed the demo database |

---

## Troubleshooting FAQ

### 1. Database connection failed / Connection refused
* Verify Docker is running: `docker compose ps`
* Test database connectivity: `npx tsx scripts/test-db.ts`
* If using WSL2, check that `DATABASE_URL` uses the correct IP address or `127.0.0.1`.

### 2. Audio buzzer doesn't sound when timer expires
Modern browsers block autoplaying audio until the user interacts with the page. Click anywhere on the scoreboard or moderator page once to grant browser audio permissions.

### 3. Port 3000 or 5432 is already in use
* Change the database port in `docker-compose.yml` (e.g., `"5433:5432"`) and update `DATABASE_URL` in `.env.local`.
* To run Next.js on a different port: `npx next dev -p 3001`.

### 4. Preparing for Multi-Device / Network Testing (Next Phase)
When you are ready to test connecting other devices (tablets, TV screens, mobile phones) over your local WiFi network:
* Find your computer's local IP address (`ipconfig` on Windows or `ifconfig` / `hostname -I` on Linux/Mac).
* Verify that your local IP is included in `allowedDevOrigins` inside `next.config.ts`.
* Other devices on the same WiFi can access `http://<YOUR-IP>:3000`.
