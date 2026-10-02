# RingFlow Offline Venue & Homelab Deployment Guide

This guide details how to run RingFlow in a **100% offline, air-gapped tournament environment** on a local homelab server (Proxmox / Ubuntu VM) connected directly to a TP-Link wireless router, with zero reliance on public internet.

> Hosted and hybrid (LAN plus judge tunnel) setups, and every environment variable: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

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

# Offline mode: no external calls (Turnstile, CDN PDF viewer)
OFFLINE_MODE="true"
TURNSTILE_SECRET_KEY="disabled"
NEXT_PUBLIC_TURNSTILE_SITE_KEY="disabled"

# Optional: the address judge phones use (only if it differs from the desk's)
APP_URL="http://192.168.0.100:3000"
```

> [!TIP]
> Setting `OFFLINE_MODE="true"` and `TURNSTILE_SECRET_KEY="disabled"` ensures that login forms for table officials, stagers, and organisers work immediately on the LAN without attempting to load external Cloudflare scripts.

---

### Step 2: Database Initialization

Create the database schema:

```bash
# Apply schema to local PostgreSQL, then the SQL migrations (triggers, audit log, judge sessions)
npm run db:push
npm run db:migrate
```

Do not run `npm run db:seed` on a real event server. It creates a demo tournament with a known admin password and fixed access codes (see [QUICKSTART.md](QUICKSTART.md)); it is for local development only.

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

Build and start the production server:

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

---

## 4. Day-of checklist

* Server and router powered, server IP reserved (DHCP reservation or static).
* Admin can sign in at `/login/admin`, and the tournament has tatamis, categories, athletes and locked draws.
* Each tatami's moderator has signed in with the tatami code and been approved. Open `/scoreboard/<ringId>` on each TV (the tatami's moderator can open it, or enable "show scoreboard publicly" in settings).
* Click once on each scoreboard and moderator page so the browser allows the bell sound.
* Kata judges scan the QR code in the moderator's Judge phones panel. On a LAN-only install the QR uses the address the moderator's browser is on, so open the moderator pad through `http://<server-ip>:3000`, not `localhost`.
* Share `http://<server-ip>:3000/` (or a QR code of it) with spectators and athletes.

How kata pools and medal bouts are scored: [docs/DISCIPLINES.md](docs/DISCIPLINES.md).
