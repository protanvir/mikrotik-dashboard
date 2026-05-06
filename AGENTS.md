# AGENTS.md — MikroTik CCR2116 Dashboard

## Quick start
```bash
cp .env.example .env      # edit ROUTER_IP, ROUTER_USER, ROUTER_PASS
npm install
npm run dev                # nodemon, auto-restarts on change
npm start                  # production: node server.js
```

Open http://localhost:3000

## Architecture — single-page vanilla dashboard
- **Backend**: `server.js` (Express + axios) proxies RouterOS REST API (port 443, self-signed cert accepted via `rejectUnauthorized: false`)
- **Frontend**: `public/index.html` — vanilla JS + Chart.js (CDN). Auto-polls `/api/*` every 5s. No build step, no bundler, no framework.
- **Config**: `.env` only — loaded by `dotenv`, no other config mechanism.
- **No database, no WebSocket**, no tests, no linter, no typecheck, no CI.
- **No git repo** — this is a standalone deployment, not a shared project.

## Key endpoints (server.js proxies to router)
| Dashboard route | RouterOS REST API path |
|---|---|
| `/api/resource` | `/system/resource` |
| `/api/health` | `/system/health` |
| `/api/interfaces` | `/interface` |
| `/api/traffic` | `POST /interface/monitor-traffic` |
| `/api/connections` | `/ip/firewall/connection` |
| `/api/bgp` | `/routing/bgp/session` |
| `/api/config` | (synthetic — returns router IP + monitored interfaces) |

## Router prerequisite
Must run RouterOS 7.x with www-ssl enabled. The dashboard accepts self-signed certs silently.

## Interface names
Set `MONITOR_INTERFACES` in `.env` as comma-separated exact names from `/interface print`. Spaces in names are valid in RouterOS — they will work in the env var value.

## Health sensor mapping (CCR2116-12G-4S+)
Auto-configured in `server.js:56-78` — expects these names from `/system/health`:
- Temps: `cpu-temperature`, `sfp-temperature`, `switch-temperature`, `board-temperature1`
- Fans: `fan1-speed` … `fan4-speed`
- PSUs: `psu1-state`, `psu2-state`

If sensor names differ on other models, edit the mapping in `server.js`.
