# RingFlow Offline Venue & Homelab Deployment Guide

This guide details how to run RingFlow in a **100% offline, air-gapped tournament environment** on a local homelab server (Proxmox / Ubuntu VM) connected directly to a TP-Link wireless router, with zero reliance on public internet.

---

## 1. Network Topology (Venue LAN)

```
                       ┌────────────────────────┐
                       │  TP-Link Wi-Fi Router  │
                       │  (No WAN/Internet Req) │
                       │  DHCP: 192.168.0.1/24  │
                       └───────────┬────────────┘
                                   │
      ┌────────────────────────────┼───────────────────────────┐
      │ (Ethernet / Static IP)     │ (Wi-Fi)                   │ (Wi-Fi)
      ▼                            ▼                           ▼
┌─────────────────────────┐  ┌──────────────────┐  ┌───────────────────────┐
│ Proxmox Homelab Desktop │  │ Moderator Desk   │  │ Arena TV Scoreboards  │
│ Ubuntu 22.04/24.04 VM   │  │ (iPad / Laptops) │  │ (Smart TVs / Laptops) │
│ IP: 192.168.0.100       │  │ Browser: :3000   │  │ Browser: :3000        │
│ Node.js 22 + PostgreSQL │  └──────────────────┘  └───────────────────────┘
│ `npm run start`         │                │
└─────────────────────────┘                ▼
                               ┌───────────────────────┐
                               │ Staging & Spectators  │
                               │ (Phones / Tablets)    │
                               │ Browser: :3000        │
                               └───────────────────────┘
```

* **Server PC**: Proxmox VE desktop hosting an Ubuntu VM running PostgreSQL 16 and Node.js 22.
* **TP-Link Router**: Assigns a static IP or DHCP reservation to the Ubuntu VM (e.g. `192.168.0.100`).
* **Clients**: Table officials (moderators), staging marshalls, arena TV scoreboards, and spectators connect to the TP-Link Wi-Fi and open `http://192.168.0.100:3000`.

---

## 2. Server Configuration (Ubuntu VM)

### Step 1: Clone & Configure Environment

In your project directory on the Ubuntu VM:

```bash
cd RingFlow-CISCE
cp .env.example .env.local
```

Edit `.env.local` to enable offline air-gapped mode:

```ini
# PostgreSQL connection (local to VM)
DATABASE_URL="postgres://event_suite:event_suite@127.0.0.1:5432/ringflow"

# Offline mode: Bypasses Cloudflare Turnstile CAPTCHA checks on LAN
OFFLINE_MODE="true"
TURNSTILE_SECRET_KEY="disabled"
NEXT_PUBLIC_TURNSTILE_SITE_KEY=""

# Application Host URL (your server VM's LAN IP)
NEXT_PUBLIC_APP_URL="http://192.168.0.100:3000"
```

> [!TIP]
> Setting `OFFLINE_MODE="true"` and `TURNSTILE_SECRET_KEY="disabled"` ensures that login forms for table officials, stagers, and organisers work immediately on the LAN without attempting to load external Cloudflare scripts.

---

### Step 2: Database Initialization

Initialize the database schema and optionally seed demo data:

```bash
# Apply schema to local PostgreSQL
npm run db:push

# (Optional) Seed realistic championship structure
npm run db:seed
```

---

### Step 3: Create Administrator Account

Create your Tournament Director login credentials directly from the command line:

```bash
npm run db:create-admin -- --email=admin@ringflow.org --password=yourpassword --name="Tournament Director"
```

Or using positional arguments:

```bash
npm run db:create-admin admin@ringflow.org yourpassword "Tournament Director"
```

---

### Step 4: Build & Launch Production Server

To achieve sub-millisecond response times on the arena floor, build and start the optimized standalone server:

```bash
# 1. Build the optimized production bundle
npm run build

# 2. Start the production server (bound to 0.0.0.0 on port 3000)
npm run start
```

*(Optional: Use PM2 to keep the server running automatically on VM reboot)*

```bash
npm install -g pm2
pm2 start "npm run start" --name "ringflow"
pm2 save
pm2 startup
```

---

## 3. Client Connections on the Venue Floor

Once the server is running, all clients connected to the TP-Link Wi-Fi can navigate to:

| Floor Role | Device Type | URL to Open |
| :--- | :--- | :--- |
| **Tournament Director** | Laptop / Desktop | `http://192.168.0.100:3000/login/admin` |
| **Tatami Table Official (Moderator)** | Laptop / iPad | `http://192.168.0.100:3000/login/mod` |
| **Arena TV Displays** | TV Browser / Mini PC | `http://192.168.0.100:3000/scoreboard/<ringId>` |
| **Staging Marshall** | Tablet / Phone | `http://192.168.0.100:3000/login/stager` |
| **Tournament Organiser** | Laptop | `http://192.168.0.100:3000/login/organiser` |
| **Spectators & Athletes** | Public Phones | `http://192.168.0.100:3000/` |

---

## 4. Kata Scoring Flow & Point Isolation

RingFlow strictly isolates points earned in different bouts:

### 1. Preliminary Flight Pools (Pool A & Pool B)
* Competitors are divided into balanced pools (Pool A and Pool B).
* Each athlete performs their preliminary kata, and the mat-side table official records their scores directly on the Moderator scoring desk.
* Total scores from preliminary bouts (e.g. `16.20 pts`) determine **pool rank and qualification only**.

### 2. Championship & Medal Flight Bouts
* When preliminary bouts conclude, the top 2 from each pool advance to the Medal Flight:
  * **Bout #6**: Gold / Silver Championship Match (Pool A #1 vs Pool B #1)
  * **Bout #5**: Bronze Medal Match (Pool A #2 vs Pool B #2)
* **Point Reset**: Points are strictly unique to each bout. When competitors step onto the mat for Bout #5 or #6, their preliminary score (`16.20`) is preserved only as their **Qualification Seed Mark**.
* The medal bout is scored fresh from `0.00`.
* Final medals (🥇 Gold, 🥈 Silver, 🥉 Bronze) are awarded based solely on the outcome of the Championship matches.
