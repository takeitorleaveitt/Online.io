# Online.io

A real-time multiplayer `.io` arena game — grow, fight, and try to become the
strongest player on the server. Inspired by the accessibility of Agar.io, the
build/progression depth of Diep.io, and the constant motion of Slither.io,
but with its own identity: an authoritative Node.js server, six themed
zones, five weapons, four abilities, four evolution paths, neutral AI
enemies, a world boss, and rotating world events.

## Architecture

- **Server** (`server/`) — Node.js + Express + Socket.IO. Runs a fixed
  30Hz authoritative game loop per arena room: movement, collisions,
  combat, resource pickups, bot AI, neutral enemies, the world boss, and
  world events all live here. Clients only ever send *input intent*
  (`{dx, dy, aimAngle, firing}`); the server computes where everyone
  actually ends up, so a modified client can't teleport or god-mode.
  Snapshots are broadcast at 15Hz, filtered per-player to nearby entities
  only (not the whole world) to keep bandwidth sane.
- **Client** (`public/`) — plain HTML5 Canvas + vanilla JS, no build step.
  The local player uses client-side prediction (instant movement feedback)
  reconciled against the server's authoritative position; every remote
  entity (other players, bots, enemies, projectiles) is interpolated
  between the last two snapshots so motion stays smooth at 60fps despite
  the lower network tick rate.
- **Bots** — real `Player` objects driven by `server/game/BotAI.js`
  instead of a socket. They collect resources, chase weaker players,
  flee stronger ones, fight neutral enemies, use abilities, and spend
  upgrade points, with four personalities (aggressive/defensive/hunter/
  passive). Bot population is adjusted every second to target ~75% real
  players / 25% bots, with a floor so a near-empty server still feels
  alive.
- **Meta progression** (`public/js/meta.js`) — account-level currency,
  cosmetic unlocks, daily missions, achievements, and daily login
  rewards are stored in `localStorage` per browser (there's no login
  system in this build). Cosmetics never affect combat stats.

## Local development

```bash
npm install
npm start
```

Then open `http://localhost:3000`. `PORT` is read from the environment
(Render sets this automatically); it defaults to `3000` locally.

## Deploying to Render

This repo includes a `render.yaml` Blueprint, but if you're configuring
the Web Service by hand in the Render dashboard, use:

- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Health Check Path**: `/healthz`

Render sets `PORT` automatically — no extra environment variables are
required. Note: on Render's free plan the service spins down after
inactivity and cold-starts on the next visit (a few seconds), and long-
lived idle WebSocket connections can be recycled on some free-tier
configurations — fine for demos, worth upgrading the plan for a
persistent live arena.

## What's simplified vs. the full spec

This is a genuinely playable, fully networked multiplayer build covering
the core loop end-to-end (movement, combat, leveling, evolutions, bots,
bosses, world events, zones, missions, achievements, cosmetics). A few
things are intentionally scoped down for a single build:

- One live arena mode (FFA) per room; the room/matchmaking system
  (`server/index.js`) is built to support more modes later.
- No account/login system — progression is per-browser via
  `localStorage`, not a shared database.
- Party joining works via a shareable code; friends/recent-players are a
  local bookmark list rather than a social graph.
