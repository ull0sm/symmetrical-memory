# RingFlow: Kata & Team Events Architectural Specification

## 1. Executive Summary & Vision

RingFlow was initially architected as a tournament floor management and Kumite bout scoring platform for martial arts championships (such as WKF Karate and CISCE national tournaments). 

This document defines the comprehensive architecture and operational blueprint to expand RingFlow into:
1. **Individual Kata Scoring** (Flag/Majority Vote System & Numeric Point System).
2. **Team Kata** (3-person synchronized kata with Bunkai in medal rounds and 5:00 minute strict timer).
3. **Team Kumite** (Multi-bout squad matches with order-of-fight rosters, Hikiwake draws, points differential, and sudden-death tiebreakers).
4. **The Hybrid Split-Plane Network Topology**: Solving the venue network crisis by separating secure Venue LAN operations (Admin, Moderator, Arena TV) from an ephemeral, zero-friction Public Judge Tunnel (Cloudflare Tunnel style) for random, rotating volunteer referees.

---

## 2. Karate Rules Research & Analysis: WKF & CISCE

### 2.1 Individual Kata

#### A. The 2026 WKF Revolution: Return to Majority Vote
Effective **January 1, 2026**, the World Karate Federation introduced the most significant shift in Kata judging in decades:
* **Elimination of Point Summation**: Total scores (e.g. adding 7.6 + 8.2 + ...) are no longer summed or displayed to declare a bout winner in head-to-head competition.
* **Majority Vote (Flag System / Electronic Hantei)**: In head-to-head bouts (AKA vs AO), the winner is decided solely by majority vote from the referee panel (either 3 or 5 judges).
* **Internal Criteria**: Referees internally evaluate performances on two core pillars:
  1. **Technical Performance (70% weight conceptually)**: Stances, techniques, transitional movements, timing, correct breathing, focus (*kime*), and adherence to the style's kata syllabus.
  2. **Athletic Performance (30% weight conceptually)**: Strength, speed, balance, and rhythm.
* **Stricter Theatrics & Fouls**:
  * Striking the chest, thighs, or uniform to create artificial sound effects is strictly penalized.
  * Stumbling, momentary loss of balance, or slight hesitation incurs score deductions.
  * Disqualification occurs for performing the wrong kata, announcing one kata and performing another, unfastened belt, or stepping off the tatami boundary.

#### B. Classical Point System (WKF 2019–2025 & School/Festival Tournaments)
Many regional, state, and school championships (including CISCE, national federations, and open opens) continue to use the **Numeric Point System**:
* Panel of 5 or 7 judges.
* Score range: **5.0 to 10.0** in increments of 0.1 (or 0.2).
* **Trimmed Scoring**:
  * **5 Judges**: The highest 1 and lowest 1 score are discarded. The remaining 3 middle scores are summed.
  * **7 Judges**: The highest 2 and lowest 2 scores are discarded. The remaining 3 middle scores are summed.
* In case of a tie: The lowest discarded score is compared; if still tied, the highest discarded score is compared; if still tied, a tie-break kata is performed.

#### C. Kata Tournament Bracket & Progression Structures: Tree vs Groups

In real-world karate tournaments, Kata is organized in **three distinct tournament formats** depending on whether it is an international championship, a regional state meet, or a local school/festival event:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        KATA TOURNAMENT STRUCTURE COMPARISON                            │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│ Format 1: Head-to-Head   │ Format 2: WKF Group Pools   │ Format 3: Local Group Flight  │
│ Knockout Tree (Flags)    │ (Points & Multi-Phase)      │ (Score Table & Cut-Off)       │
├──────────────────────────┼─────────────────────────────┼───────────────────────────────┤
│ • 1v1 Bouts (AKA vs AO)  │ • 4 Pools of up to 8 athl.  │ • Athletes split into groups  │
│ • Both perform kata      │ • Each performs solo        │   (e.g., Groups of 8)         │
│ • 3 or 5 judges flag     │ • 5-7 judges give marks     │ • Each performs solo once     │
│ • Winner advances        │ • Top 4 from each pool      │ • Top 1 or 2 highest scores   │
│   through traditional      advance to Round 2;           advance to Final Group      │
│   elimination tree         top 2 advance to Medals     │ • Final group performs 2nd    │
│ • Fastest to understand, │ • Used in WKF Premier       │   kata; ranked 1st, 2nd, 3rd  │
│   but takes 2x the kata    League & World Cups         │ • Saves up to 60% of time!    │
│   performances             • Sportdata "Pool" mode       │ • Dominant in local/schools   │
└──────────────────────────┴─────────────────────────────┴───────────────────────────────┘
```

##### 1. Structure A: Head-to-Head Knockout Tree (The Bracket / Tree)
* **How it works**: Identical to Kumite single elimination.
  * Match 1: Athlete A (AKA) vs Athlete B (AO).
  * AKA performs kata, then AO performs kata (or simultaneously in youth).
  * Judges raise flags: 3-2 for AKA. Athlete A advances to Quarterfinals.
* **Pros**: Simple, visual bracket tree, exciting head-to-head drama.
* **Cons**: Extremely time-consuming for large divisions. (A 32-athlete division requires 31 matches = 62 individual kata performances on that ring).

##### 2. Structure B: WKF Multi-Phase Group Pools (Official WKF 2019-2023 / Sportdata SET)
* **How it works**:
  * **Round 1 (Pools of 8)**: If 32 athletes enter, they are divided into 4 Pools of 8 (Pool 1, 2, 3, 4).
  * In Pool 1, each of the 8 athletes performs individually. Judges score each athlete (e.g. 24.6, 23.8, 25.2...).
  * The athletes are ranked 1 through 8 by total points.
  * **The Cut**: Top 4 athletes from Pool 1 and Pool 2 merge into Round 2 (Group 1 of 8). Top 4 from Pool 3 and Pool 4 merge into Round 2 (Group 2 of 8).
  * **Round 2**: 8 athletes perform a 2nd kata. The Top 3 in each group advance to Medal Bouts.
  * **Medals**:
    * 1st in Group 1 vs 1st in Group 2 -> Gold/Silver Bout.
    * 2nd in Group 1 vs 3rd in Group 2 -> Bronze 1.
    * 3rd in Group 1 vs 2nd in Group 2 -> Bronze 2.

##### 3. Structure C: Local / School / Festival Group Flight (The Grassroots Reality)
* **Why local tournaments bend the rules**: Local tournaments (CISCE, district/state cups, club invitationals) have severe venue time limits (e.g., 400 kids across 4 rings in 8 hours). Running a 1v1 bracket or 3-phase WKF pool causes events to run past midnight.
* **The "Local Group Flight" Formula**:
  1. **Preliminary Flight (Groups of 6 to 10)**:
     - 24 athletes are placed into 3 Groups of 8 (Group A, Group B, Group C).
     - Each athlete performs their kata once.
     - Judges give marks (e.g. out of 10.0). Table records total score.
  2. **The Cut (Top 1 or Top 2 Advance)**:
     - The top 2 highest scorers from Group A, B, and C automatically qualify for the **Final Championship Flight (6 finalists)**.
  3. **Final Flight (Medal Placement)**:
     - The 6 finalists perform a second kata.
     - System ranks them:
       - 1st place -> Gold Medal 🥇
       - 2nd place -> Silver Medal 🥈
       - 3rd place -> Bronze Medal 🥉 (or two 3rd places)
* **RingFlow Flexibility**: RingFlow must empower organizers to choose between:
  * **Bracket Tree (Knockout Flags)**
  * **Group Flight / Pool Rankings (Points & Cut-Off)**


---

### 2.2 Team Kata & Bunkai

* **Team Composition**: Exactly 3 athletes per team (all Male or all Female).
* **Performance**: Synchronized kata execution without commands or external beat/cadence.
* **Medal Matches (Gold & Bronze) – Bunkai Requirement**:
  * In medal bouts, teams must demonstrate the practical martial application (**Bunkai**) of the chosen kata with simulated opponents.
  * **Strict Time Limit**: Maximum duration is **5 minutes (300 seconds)** total for Kata + Bunkai, measured from the bow at entry to the bow at exit.
  * **Buzzer Signaling**:
    * Acoustic warning tone at **4 minutes 30 seconds (270s)**.
    * Double buzzer at **5 minutes (300s)**.
    * **Disqualification (Hansoku)**: Exceeding 5 minutes 00 seconds results in immediate disqualification.
* **Scoring**: Evaluates synchronization, martial realism of the bunkai, control, and absence of theatrical props or acrobatics (e.g., somersaults or throat attacks causing real injury).

---

### 2.3 Team Kumite

* **Team Squad & Lineup**:
  * **Male Teams**: 5 bouts per match (Squad of 5 to 8 competitors, minimum 3 present to avoid forfeiture).
  * **Female Teams**: 3 bouts per match (Squad of 3 to 5 competitors, minimum 2 present).
* **Bout Roster Submission**: Prior to each team match, the coach/team manager submits an official bout order form designating which athlete fights in Bout 1, 2, 3, 4, 5. The fighting order cannot be altered once submitted.
* **Scoring & Ties**:
  * Individual bouts are fought under standard Kumite rules.
  * **Hikiwake (Draw) Allowed**: In team kumite, an individual bout can end in a draw (Hikiwake) if points and Senshu are level at time expiry.
  * **Match Outcome Calculation**:
    1. **Bout Wins**: The team with the most bout victories wins (e.g. 3-1-1 or 3-2).
    2. **Point Difference**: If bout wins are tied (e.g. 2 wins each and 1 draw in a 5-man team), the team with the higher sum of scored points wins. (Point difference capped at 8 per bout).
    3. **Deciding Extra Bout (Sudden Death)**: If bout wins and total points are exactly equal, each team selects any one fighter from their roster to fight an extra bout. If still tied, decision is made by Hantei (referee vote).

---

## 3. Competitive Benchmark: Sportdata (SET) vs RingFlow

**Sportdata SET (Sport Event Technology)** is the dominant legacy platform in international karate. Analyzing its strengths and fundamental weaknesses reveals RingFlow's distinct competitive advantage.

| Feature / Dimension | Sportdata SET Software | RingFlow Solution |
| :--- | :--- | :--- |
| **System Architecture** | Heavy legacy desktop software (Windows .exe) connecting to local server | Modern Web Stack (Next.js 19, TypeScript, PostgreSQL, Server-Sent Events) |
| **Judge Hardware** | Requires pre-configured Android tablets or proprietary SET clickers | Zero-install web interface running on any mobile smartphone browser |
| **Network Requirement** | **Hard LAN Requirement**: Main PC and all 5-7 tablets must be on the exact same local subnet (Port 8080, static IPs, OTG LAN adapters) | **Hybrid Split-Plane**: Core staff on Venue LAN; Rotating volunteer judges connect via ephemeral Cloudflare Public Tunnel or local Wi-Fi |
| **Judge Rotation** | Tedious: Reconfiguring tablet IP/seat settings when referees swap | Instant: Volunteer scans QR code on ring TV/moderator pad, taps "Seat 3", and begins |
| **Score Visibility & Override** | Moderator must toggle cumbersome menus if a clicker misfires | Real-time live HUD on Moderator Pad with instant 1-tap "Void & Resubmit" or manual score override |
| **Spectator / Parent Access** | Requires paid subscription or clunky external Sportdata web portal | Instant zero-install public view (`/public/event/[id]`) with live tatami tracking and athlete search |
| **Deployment Effort** | 1-2 hours per ring running cables and setting static IP leases | 60 seconds: Open laptop, run docker or pm2, connect screens |

---

## 4. The Network Dilemma & Split-Plane Tunnel Architecture

### 4.1 The Real-World Tournament Problem

At real martial arts championships (state, national, or CISCE level):
1. **The LAN Island**: Admin, Organisers, Marshalling Stagers, and Tatami Moderators sit at desks with venue equipment. They rely on the venue local network (LAN) for ultra-low-latency, zero-downtime operation.
2. **The "Volunteer Referee" Reality**: Judges are not fixed full-time operators. 
   - A black-belt referee might judge 4 bouts, then step away to coach their student, replaced by another referee from the crowd.
   - Referees bring their personal smartphones (iOS / Android).
   - **Why giving them Venue LAN is disastrous**:
     - Venue Wi-Fi router overload from 50+ personal phones auto-syncing Google Photos/iCloud.
     - Captive portal and IP collision headaches.
     - Security threat: Untrusted personal devices could probe internal `/admin` or `/moderator` routes.
     - Venues often lack guest Wi-Fi isolation.

### 4.2 The Solution: Scoped Public Tunnel (Split-Plane Ingress)

RingFlow implements a **Split-Plane Ingress Architecture**:

```
                              ┌───────────────────────────────────────────┐
                              │            INTERNET / WAN                 │
                              └─────────────────────┬─────────────────────┘
                                                    │
                                                    ▼
                                  ┌───────────────────────────────────┐
                                  │      Cloudflare Zero-Trust        │
                                  │        Tunnel / ngrok             │
                                  │   (e.g. judge.ringflow.live)      │
                                  └─────────────────┬─────────────────┘
                                                    │
                                                    ▼ (Strict Ingress Rules)
                                      ONLY ALLOWS:
                                      - /judge/*
                                      - /api/judge/*
                                      - /_next/* (static assets)
                                      BLOCKS ALL ELSE (403):
                                      - /admin/*, /moderator/*, /stager/*
                                                    │
  ┌─────────────────────────────────────────────────┴─────────────────────────────────────────────────┐
  │                                           VENUE LOCAL LAN                                         │
  │                                                                                                   │
  │   ┌──────────────────────────┐     ┌──────────────────────────┐     ┌─────────────────────────┐   │
  │   │      Admin Console       │     │     Moderator Desk       │     │   Arena Scoreboard TV   │   │
  │   │    192.168.1.10/admin    │     │  192.168.1.25/moderator  │     │ 192.168.1.50/scoreboard │   │
  │   └────────────┬─────────────┘     └────────────┬─────────────┘     └────────────┬────────────┘   │
  │                │                                │                                │                │
  │                ▼                                ▼                                ▼                │
  │   ┌───────────────────────────────────────────────────────────────────────────────────────────┐   │
  │   │                           RINGFLOW HOST SERVER (e.g. 192.168.1.100)                       │   │
  │   │  - Next.js Application Core & Server Actions                                              │   │
  │   │  - Security Gateway Middleware (LAN-only enforcement for privileged routes)                │   │
  │   │  - PostgreSQL + Event Bus (LISTEN/NOTIFY)                                                 │   │
  │   └─────────────────────────────────────────────┬─────────────────────────────────────────────┘   │
  │                                                 │                                                 │
  └─────────────────────────────────────────────────┼─────────────────────────────────────────────────┘
                                                    │
                 ┌──────────────────────────────────┴──────────────────────────────────┐
                 │                                                                     │
                 ▼ (Cellular 4G/5G / Guest WAN)                                        ▼ (Cellular 4G/5G)
      ┌─────────────────────────────┐                                       ┌─────────────────────────────┐
      │   Judge 1 (Personal iPhone)  │                                       │   Judge 2 (Personal Android)│
      │  judge.ringflow.live/judge/1│                                       │  judge.ringflow.live/judge/2│
      └─────────────────────────────┘                                       └─────────────────────────────┘
```

### 4.3 Key Security & Isolation Rules

1. **Path-Based Route Guard in Next.js Middleware**:
   ```ts
   // In middleware.ts
   const host = req.headers.get("host") || "";
   const isTunnelDomain = host.includes("judge.") || host.includes("trycloudflare.com");
   const pathname = req.nextUrl.pathname;

   // If traffic arrives via public tunnel, strictly forbid non-judge routes
   if (isTunnelDomain) {
     const isAllowed = 
       pathname.startsWith("/judge") || 
       pathname.startsWith("/api/judge") || 
       pathname.startsWith("/_next") ||
       pathname.startsWith("/favicon.ico");

     if (!isAllowed) {
       return new Response("Unauthorized Gateway: Route restricted to venue LAN.", { status: 403 });
     }
   }
   ```
2. **Short-Lived, Tatami-Scoped Rotating PINs**:
   - Each tatami maintains a 4-digit numeric/alphanumeric PIN that can be rotated at will (e.g., `PIN: 8492`).
   - The Moderator screen displays a QR code embedding the URL:
     `https://judge.ringflow.live/judge/ring/[ringId]?pin=8492`
   - Even if a competitor or spectator photographs the QR code, the worst they could attempt is sending a vote for an active bout—which the Moderator immediately sees on screen with device telemetry and can void with a single click.

---

## 5. Judge & Moderator Operational Flow

### 5.1 Volunteer Judge Pairing (Zero-Friction 3-Tap Flow)
1. **Referee Sits Down at Tatami 1, Chair 3**:
   - Opens smartphone camera.
   - Scans QR code displayed on the side of the Moderator laptop or tatami pillar.
2. **Instant Seat Assignment**:
   - The mobile page opens instantly: `Tatami 1 - Tatami Officials`.
   - Prompts: *"Select your seat: [Judge 1] [Judge 2] [Judge 3] [Judge 4] [Judge 5]"*.
   - Tap **Judge 3**.
   - Moderator Pad immediately lights up green: `Judge 3: Online (iPhone 15 - Cellular)`.
3. **Standby Mode**:
   - Judge screen shows: *"Waiting for Bout: Kata M Under-17 Round 1"*.
   - Screen remains awake (`navigator.wakeLock` enabled so the phone doesn't sleep).

### 5.2 Scoring a Bout: Flag Mode (Majority Vote)
1. **Athletes Perform**:
   - AKA performs kata.
   - AO performs kata.
2. **Moderator Prompts "Call for Decision"**:
   - Moderator clicks `Hantei / Call Vote` on the Moderator Pad.
   - All 5 judges' phones vibrate via Haptic Feedback API (`navigator.vibrate([100, 50, 100])`) and switch to the voting screen.
3. **Judge Voting Screen**:
   - Two massive, ergonomic buttons occupying 90% of the screen:
     - **[ RED / AKA ]** (Left half, vibrant crimson)
     - **[ BLUE / AO ]** (Right half, vibrant royal blue)
   - Judge taps their choice. A confirmation bar illuminates: *"Vote Cast: AKA. Tap to Change before Moderator locks."*
4. **Moderator Console Real-Time Feed**:
   - Moderator sees a live 5-judge matrix:
     - `J1: [AKA]` | `J2: [AKA]` | `J3: [AO]` | `J4: [AKA]` | `J5: [AO]`
   - Moderator can toggle "Blind Review" mode (judges' choices masked until locked) or "Live Matrix" mode.
5. **Moderator Finalizes**:
   - Moderator clicks `Lock & Submit Decision`.
   - Result: `AKA Wins by Hantei (3 - 2)`.
   - Match is finalized in database, winner automatically advances to next round in the bracket, and Arena TV Scoreboard displays the victory animation.

### 5.3 Scoring a Bout: Point Mode (Numeric 5.0 – 10.0)
1. Athlete performs.
2. Judge screen displays an intuitive decimal keypad or large slider:
   - Base score preset to `7.5`.
   - `[ -0.1 ]` and `[ +0.1 ]` quick-tap buttons.
   - Direct numeric keypad for fast entry.
3. Judge taps `Submit Mark (8.4)`.
4. Moderator Pad displays all received marks:
   - e.g., `J1: 8.2` | `J2: 8.6 (High - Dropped)` | `J3: 7.8 (Low - Dropped)` | `J4: 8.4` | `J5: 8.2`
   - Effective Sum: `8.2 + 8.4 + 8.2 = 24.80`.
5. Moderator reviews, approves, and score is broadcast to TV scoreboard.

### 5.4 Fallback & Air-Gap Redundancy
* **Offline/Dead Battery Fallback**: If Judge 4's phone dies mid-match, Judge 4 raises a physical red/blue flag. The Moderator simply taps "Override J4" on the moderator pad and inputs the flag manually.
* **Misclick Voiding**: If Judge 2 accidentally taps AO instead of AKA, the judge can tap "Change Vote" before lock, or tell the moderator, who clicks `Void J2 Vote`, instantly resetting Judge 2's device.
