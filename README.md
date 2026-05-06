# MikroTik CCR2116 Dashboard

Live, single-page monitoring dashboard for MikroTik CCR2116-12G-4S+ (RouterOS 7.x). Vanilla JS, no build step, no database.

![Dashboard](https://img.shields.io/badge/RouterOS-7.x-00e5a0)
![Node](https://img.shields.io/badge/Node-18+-4a9eff)

## Features

- **CPU & RAM** — live sparkline charts with percentage bars + color thresholds
- **System Health** — 4 temperature sensors (CPU, SFP, Switch, Board), 4 fan RPMs, 2 PSU states
- **Interface Traffic** — per-interface RX/TX live bar graphs with speed, errors, and drops
- **Bandwidth Overview** — aggregate inbound/outbound/combined throughput with trend sparklines
- **Active Connections** — top 100 firewall connections with protocol badges and state coloring
- **BGP Sessions** — peer status, AS numbers, prefix counts, established/idle states
- **PPTP Active Sessions** — live monitoring of active PPTP VPN users, caller IPs, assigned IPs, uptime
- **Dynamic Interface Discovery** — automatically detects running interfaces from the router — no hardcoded lists
- **Auto-polling** — all panels refresh every 5 seconds with countdown indicator
- **Connection status** — live green/red dot showing router reachability
- **Responsive** — adapts from 6-column grid down to 1 column on mobile
- **Dark theme** — terminal-inspired dark UI with scanline overlay

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Browser     │────▶│  Express.js  │────▶│  MikroTik       │
│  index.html  │◀────│  server.js   │◀────│  RouterOS 7.x   │
│  Chart.js    │     │  (proxy)     │     │  REST API       │
└─────────────┘     └──────────────┘     └─────────────────┘
```

- **Backend**: Express + axios, proxies RouterOS REST API, accepts self-signed certs
- **Frontend**: Vanilla JS + Chart.js (CDN), auto-polls every 5s, no framework
- **Config**: `.env` only, no database

## Requirements

- Node.js 18+
- MikroTik running **RouterOS 7.x** with REST API enabled
- Admin user on the router (read-only access is sufficient)

## Quick Start

### 1. Enable REST API on MikroTik

```bash
# Via Winbox or SSH
/ip service enable www-ssl
/ip service set www-ssl port=443

# Or plain HTTP (less secure)
/ip service enable www
```

### 2. Install

```bash
git clone https://github.com/yourusername/mikrotik-dashboard.git
cd mikrotik-dashboard
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your router details
```

```env
ROUTER_IP=192.168.88.1
ROUTER_PORT=80           # 443 for HTTPS, 80 for HTTP
ROUTER_USER=admin
ROUTER_PASS=your_password
```

> `MONITOR_INTERFACES` is **optional** — the dashboard auto-discovers running interfaces.

### 4. Start

```bash
npm start
```

Open **http://localhost:3000**

For development with auto-restart:

```bash
npm run dev
```

## Dashboard Sections

| Section | Source | Refresh |
|---|---|---|
| CPU / RAM sparklines | `/system/resource` | 5s |
| Temperature / Fans / PSU | `/system/health` | 5s |
| Interface traffic bars | `/interface/monitor-traffic` | 5s |
| Bandwidth overview | Aggregated from traffic | 5s |
| Active connections | `/ip/firewall/connection` | 10s |
| BGP sessions | `/routing/bgp/session` | 15s |
| PPTP active users | `/ppp/active` | 10s |

## Dynamic Interface Discovery

The backend automatically discovers all **running**, **non-loopback**, **non-dynamic** interfaces from the router every 30 seconds. Interface names with spaces or special characters (`@`, etc.) are gracefully skipped for traffic monitoring but still shown in the interface list. No `.env` changes needed when interfaces are added, renamed, or removed.

## API Endpoints

| Dashboard Route | RouterOS REST API Path |
|---|---|
| `/api/resource` | `/system/resource` |
| `/api/health` | `/system/health` |
| `/api/interfaces` | `/interface` |
| `/api/traffic` | `POST /interface/monitor-traffic` |
| `/api/connections` | `/ip/firewall/connection` |
| `/api/bgp` | `/routing/bgp/session` |
| `/api/pptp` | `/ppp/active` |
| `/api/config` | Synthetic (router IP + monitored interfaces) |

## Health Sensor Mapping (CCR2116-12G-4S+)

Auto-configured in `server.js`:

**Temperatures**: `cpu-temperature`, `sfp-temperature`, `switch-temperature`, `board-temperature1`
**Fans**: `fan1-speed` … `fan4-speed`
**PSUs**: `psu1-state`, `psu2-state`

If sensor names differ on your model, edit the mapping in `server.js`.

## Run on Startup (Linux)

```bash
sudo tee /etc/systemd/system/mikrotik-dashboard.service <<EOF
[Unit]
Description=MikroTik Dashboard
After=network.target

[Service]
WorkingDirectory=/path/to/mikrotik-dashboard
ExecStart=/usr/bin/node server.js
Restart=always
User=your-user
EnvironmentFile=/path/to/mikrotik-dashboard/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable mikrotik-dashboard
sudo systemctl start mikrotik-dashboard
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "Cannot reach router" | Check `ROUTER_IP` and that `www-ssl` is enabled on the router |
| Temperature shows N/A | Run `/system health print` on router to verify sensor names |
| BGP shows empty | BGP may not be configured, or RouterOS path differs (`/routing/bgp/session`) |
| Interface shows no traffic | Interface may have spaces/special chars in name; still shown in list without traffic bars |
| PPTP shows empty | No active PPTP sessions, or PPP service not configured on router |
| 502 Bad Gateway | Router REST API unreachable or timeout; check credentials and network connectivity |

## License

MIT
