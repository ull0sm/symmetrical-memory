# RingFlow: Kata Full Implementation Plan

This document details the step-by-step engineering roadmap to implement Individual Kata in RingFlow, with full support for both the **2026 WKF Majority Vote / Flag System** and the **Classical Numeric Point System**, integrated with the **Hybrid Split-Plane Tunnel Architecture**.

---

## Architecture Overview

```
                      [ Volunteer Judge's Phone ]
                        (Over 4G/5G / Guest WiFi)
                                    │
                                    ▼
                     https://judge.ringflow.live/judge/ring/[ringId]
                                    │
                       (Cloudflare Tunnel / ngrok)
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │                Next.js Middleware Guard                 │
       │     (Enforces tunnel only reaches /judge & /api/judge)  │
       └────────────────────────────┬────────────────────────────┘
                                    │
                                    ▼
      ┌───────────────────────────────────────────────────────────┐
      │                    RingFlow Server                        │
      │   - Server Actions: submitJudgeScore(), voidJudgeScore()  │
      │   - SSE Bus: /api/live (instant push to moderator & TV)   │
      │   - DB: matches, kata_scores, rings (judge_pin)           │
      └──────────────┬────────────────────────────┬───────────────┘
                     │                            │
        (Local LAN)  ▼               (Local LAN)  ▼
          [ Moderator Pad ]              [ Arena TV Scoreboard ]
        (Real-time 5-Judge HUD)        (Fullscreen Flags / Marks)
```

---

## Phase 1: Database Schema & Migration

### 1.1 Schema Extensions in `src/db/schema/index.ts`

1. **Add `judge_pin` to `rings`**:
   ```ts
   // In rings table:
   judgePin: text('judge_pin').notNull().default('1234'),
   ```

2. **Add Kata fields to `categories` / `draws`**:
   ```ts
   // In categories / draws:
   kataFormat: text('kata_format').notNull().default('BRACKET'), // 'BRACKET' | 'GROUP_POOLS'
   poolSize: integer('pool_size').default(8), // e.g. 8 competitors per group
   advancePerPool: integer('advance_per_pool').default(2), // top 1 or 2 advance to final flight
   ```

3. **Add Kata fields to `matches`**:
   ```ts
   // In matches table:
   kataScoringMode: text('kata_scoring_mode').default('FLAG'), // 'FLAG' | 'POINTS'
   poolGroup: text('pool_group'), // e.g. 'Pool A', 'Pool B', 'Final Flight'
   akaKataName: text('aka_kata_name'),
   aoKataName: text('ao_kata_name'),
   akaFlags: integer('aka_flags').notNull().default(0),
   aoFlags: integer('ao_flags').notNull().default(0),
   akaScoreTotal: numeric('aka_score_total', { precision: 5, scale: 2 }),
   aoScoreTotal: numeric('ao_score_total', { precision: 5, scale: 2 }),
   ```

3. **Create `kata_scores` Table**:
   Stores each individual judge's submitted marks or flag votes.
   ```ts
   export const kataScores = pgTable(
     'kata_scores',
     {
       id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
       matchId: text('match_id')
         .notNull()
         .references(() => matches.id, { onDelete: 'cascade' }),
       athleteId: uuid('athlete_id').references(() => athletes.id, { onDelete: 'cascade' }),
       targetSide: text('target_side').notNull(), // 'AKA' | 'AO' | 'BOTH'
       judgeSeat: integer('judge_seat').notNull(), // 1 through 7
       judgeDeviceToken: text('judge_device_token'),
       scoreType: text('score_type').notNull(), // 'FLAG' | 'POINT'
       flagVote: text('flag_vote'), // 'AKA' | 'AO'
       numericScore: numeric('numeric_score', { precision: 4, scale: 2 }), // e.g. 8.40
       isDropped: boolean('is_dropped').notNull().default(false), // true if trimmed high/low
       isOverridden: boolean('is_overridden').notNull().default(false), // true if moderator overrode
       createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
         .notNull()
         .defaultNow(),
     },
     (table) => [unique().on(table.matchId, table.judgeSeat, table.targetSide)]
   );
   ```

---

## Phase 2: Network Gateway & Tunnel Security Layer

### 2.1 Next.js Gateway Middleware (`src/middleware.ts`)
Ensures that anyone hitting the server via the public tunnel domain (e.g. `judge.ringflow.live` or `*.trycloudflare.com`) is **physically prohibited** from accessing `/admin`, `/moderator`, `/stager`, `/organiser`, or general APIs.

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const isTunnelDomain = 
    host.startsWith('judge.') || 
    host.includes('trycloudflare.com') || 
    host.includes('ngrok-free.app');

  const { pathname } = request.nextUrl;

  if (isTunnelDomain) {
    const isPublicAllowed = 
      pathname.startsWith('/judge') ||
      pathname.startsWith('/api/judge') ||
      pathname.startsWith('/api/live') ||
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon.ico');

    if (!isPublicAllowed) {
      return new NextResponse('Access Denied: Administrative routes restricted to Venue LAN.', {
        status: 403,
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 2.2 Cloudflare Tunnel Runner Script (`scripts/tunnel.bat` or `scripts/tunnel.sh`)
Provides organizers with a 1-click command to spin up the judge tunnel:
```bash
# Example quick tunnel without custom domain:
cloudflared tunnel --url http://localhost:3000
```
Or production Zero-Trust tunnel mapping `judge.ringflow.live` to the venue server IP.

---

## Phase 3: Judge Mobile Web Application

### 3.1 Route: `/judge/ring/[ringId]/page.tsx`
* **Zero Authentication / Instant PIN Join**:
  - URL accepts optional query parameter: `?pin=8492`.
  - If valid PIN, presents seat selection:
    `[ Seat 1 ] [ Seat 2 ] [ Seat 3 ] [ Seat 4 ] [ Seat 5 ]`
  - Saves assigned `ringId`, `judgeSeat`, and a generated `deviceToken` in `localStorage`.
* **Mobile-First UX**:
  - `Screen Wake Lock API` active to prevent screen dimming during bouts.
  - Large touch targets (minimum 80px height).
  - High-contrast colors designed for bright indoor arenas or outdoor mats.
* **Voting Modes**:
  1. **Flag Mode (Majority Vote)**:
     - Prominent Red `AKA` and Blue `AO` buttons.
     - Haptic feedback buzz on tap.
     - Shows current status: `Waiting for call...` -> `VOTE OPEN` -> `Vote Submitted: AKA (Tap to change)` -> `LOCKED`.
  2. **Numeric Point Mode**:
     - Decimal stepper with `-0.1` and `+0.1` nudges.
     - Direct numeric grid for instantaneous entry.

---

## Phase 4: Moderator Console Kata Experience

### 4.1 UI Component: `KataScoringPad.tsx`
When a moderator opens a Kata category match on `/moderator/ring/[ringId]/current`:
1. **Dynamic Header & Tatami PIN**:
   - Displays Tatami QR Code button. Clicking opens a modal showing a scannable QR code and 4-digit PIN for incoming referees.
2. **Judge Connection HUD**:
   - Displays 5 judge status pills:
     `[J1: Connected]` `[J2: Connected]` `[J3: Connected]` `[J4: Offline]` `[J5: Connected]`
3. **Live Matrix & Vote Controls**:
   - `Call for Decision / Open Voting` button: Signals judges' phones to unlock voting interface.
   - Incoming votes populate live:
     - J1: `AKA`
     - J2: `AKA`
     - J3: `AO`
     - J4: `[Manual Override Needed]` -> Moderator can tap to set AKA/AO.
     - J5: `AKA`
   - `Void & Recall Vote`: Allows moderator to reset a specific judge's vote if they report a misclick.
4. **Lock & Finalize Decision**:
   - Clicking `Lock & Submit`:
     - Tallies votes (e.g. AKA 4 - 1 AO).
     - Assigns winner (`winnerSide: 'AKA'`, `decisionMethod: 'FLAGS'`).
     - Emits SSE event to update Arena TV Scoreboard.
     - Advances winner in tournament bracket.

---

## Phase 5: Arena TV Scoreboard Kata Mode

### 5.1 Route: `/scoreboard/[ringId]`
* **Standby Mode**: Displays athlete names, club/school, and kata name being performed.
* **Decision Reveal Animation**:
  - Dramatic suspense card: "JUDGES DECISION...".
  - 5 flags flip simultaneously or sequentially (revealing Red/Blue flags).
  - Tally displayed: `AKA 4  -  1 AO`.
  - Winner banner displayed with school logo and celebration fanfare.
* **Point System Display**:
  - If in Point Mode, displays all 5 judge marks on screen.
  - Highest and lowest scores animated with a strikethrough (dropped).
  - Total calculated score prominently highlighted.

---

## Phase 6: Server Actions & API Implementation

1. `actions/kata.ts`:
   - `getRingKataState(ringId: string)`
   - `joinJudgeSession(ringId: string, seat: number, pin: string)`
   - `submitJudgeVote(matchId: string, seat: number, vote: 'AKA' | 'AO', score?: number)`
   - `voidJudgeVote(matchId: string, seat: number)`
   - `overrideJudgeVote(matchId: string, seat: number, vote: 'AKA' | 'AO', score?: number)`
   - `finalizeKataBout(matchId: string, winnerSide: 'AKA' | 'AO')`
2. `actions/matches.ts`:
   - Extend match completion hooks to support Kata bracket propagation.

---

## Phase 7: Verification & Testing Plan

1. **Multi-Device Simulation Test**:
   - Simulate 5 mobile judge clients submitting concurrent votes via `curl` / Playwright browser subagents.
   - Verify that all 5 votes update the Moderator HUD in real-time under 200ms.
2. **Tunnel Route Isolation Test**:
   - Verify that `https://judge.<domain>/admin` returns `403 Forbidden`.
   - Verify that `https://judge.<domain>/judge/ring/1` returns `200 OK`.
3. **Disconnection & Recovery Test**:
   - Disconnect Judge 3's browser during a bout.
   - Verify that Moderator Pad flags Judge 3 as offline.
   - Moderator applies manual override for Judge 3; verify final tally reflects override correctly.
4. **Bracket Progression Test**:
   - Confirm winner of Kata bout advances to next round in single elimination and repechage brackets.
