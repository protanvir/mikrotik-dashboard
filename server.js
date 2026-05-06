require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ──────────────────────────────────────────────────────────────────
const ROUTER_IP   = process.env.ROUTER_IP   || '192.168.88.1';
const ROUTER_PORT = process.env.ROUTER_PORT  || '443';
const ROUTER_USER = process.env.ROUTER_USER  || 'admin';
const ROUTER_PASS = process.env.ROUTER_PASS  || '';
const PORT        = process.env.PORT         || 3000;
const MONITOR_INTERFACES = process.env.MONITOR_INTERFACES || 'ether1';

// Accept self-signed certs from the router
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ── MikroTik REST helper ─────────────────────────────────────────────────────
async function mt(apiPath, method = 'get', body = null) {
  const protocol = ROUTER_PORT === '80' ? 'http' : 'https';
  const url = `${protocol}://${ROUTER_IP}:${ROUTER_PORT}/rest${apiPath}`;
  const cfg = {
    method,
    url,
    auth: { username: ROUTER_USER, password: ROUTER_PASS },
    timeout: 15000,
  };
  if (ROUTER_PORT !== '80') cfg.httpsAgent = httpsAgent;
  if (body) cfg.data = body;
  const resp = await axios(cfg);
  return resp.data;
}

// ── API Routes ───────────────────────────────────────────────────────────────

// System resource: CPU, RAM, uptime, RouterOS version
app.get('/api/resource', async (req, res) => {
  try {
    res.json(await mt('/system/resource'));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// System health — structured for CCR2116-12G-4S+ sensor layout:
//   Temps : cpu-temperature, sfp-temperature, switch-temperature, board-temperature1
//   Fans  : fan1-speed … fan4-speed  (RPM)
//   PSU   : psu1-state, psu2-state   (ok / fault)
app.get('/api/health', async (req, res) => {
  try {
    const raw = await mt('/system/health');
    const items = Array.isArray(raw) ? raw : [raw];
    const get = (name) => {
      const found = items.find(i => i.name === name);
      return found ? found.value : null;
    };

    res.json({
      temps: {
        cpu:    { value: get('cpu-temperature'),    label: 'CPU' },
        sfp:    { value: get('sfp-temperature'),    label: 'SFP' },
        switch: { value: get('switch-temperature'), label: 'Switch' },
        board:  { value: get('board-temperature1'), label: 'Board' },
      },
      fans: {
        fan1: { value: get('fan1-speed'), state: get('fan-state') },
        fan2: { value: get('fan2-speed'), state: get('fan-state') },
        fan3: { value: get('fan3-speed'), state: get('fan-state') },
        fan4: { value: get('fan4-speed'), state: get('fan-state') },
      },
      psu: {
        psu1: get('psu1-state'),
        psu2: get('psu2-state'),
      },
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// All interfaces with status and basic counters
app.get('/api/interfaces', async (req, res) => {
  try {
    res.json(await mt('/interface'));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Dynamic interface discovery ───────────────────────────────────────────────
let discoveredInterfaces = null;
let discoveredAt = 0;
const DISCOVERY_TTL = 30000;

async function discoverInterfaces() {
  if (Date.now() - discoveredAt < DISCOVERY_TTL && discoveredInterfaces) {
    return discoveredInterfaces;
  }
  const raw = await mt('/interface');
  const items = Array.isArray(raw) ? raw : [raw];
  discoveredInterfaces = items
    .filter(i => {
      const running = i.running === 'true' || i.running === true;
      const isLoopback = i.type === 'loopback';
      const isDynamic = i.dynamic === 'true' || i.dynamic === true;
      return running && !isLoopback && !isDynamic;
    })
    .map(i => i.name)
    .filter(name => /^[\w.\-]+$/.test(name));
  discoveredAt = Date.now();
  return discoveredInterfaces;
}

// Live traffic snapshot (POST to MikroTik monitor-traffic)
app.get('/api/traffic', async (req, res) => {
  try {
    const ifaces = req.query.interfaces || (await discoverInterfaces()).join(',');
    const data = await mt('/interface/monitor-traffic', 'post', {
      interface: ifaces,
      once: 'true',
    });
    res.json(Array.isArray(data) ? data : [data]);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Active firewall connections (limited to 100 newest)
app.get('/api/connections', async (req, res) => {
  try {
    // Use .proplist to limit fields and .limit for performance
    const data = await mt(
      '/ip/firewall/connection?.proplist=src-address,dst-address,protocol,state,reply-src-address,reply-dst-address&.limit=100'
    );
    res.json({ connections: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Active PPTP/PPP sessions
app.get('/api/pptp', async (req, res) => {
  try {
    const data = await mt('/ppp/active?.proplist=.id,name,service,caller-id,address,uptime,bytes-in,bytes-out');
    const sessions = (Array.isArray(data) ? data : []).filter(s => s.service === 'pptp');
    res.json(sessions);
  } catch (e) {
    if (e.response && e.response.status === 404) return res.json([]);
    res.status(502).json({ error: e.message });
  }
});

// BGP sessions (RouterOS 7)
app.get('/api/bgp', async (req, res) => {
  try {
    const sessions = await mt('/routing/bgp/session');
    res.json(Array.isArray(sessions) ? sessions : []);
  } catch (e) {
    // BGP might not be configured — return empty gracefully
    if (e.response && e.response.status === 404) {
      return res.json([]);
    }
    res.status(502).json({ error: e.message });
  }
});

// Config endpoint for the frontend
app.get('/api/config', async (req, res) => {
  try {
    const ifaces = await discoverInterfaces();
    res.json({ routerIp: ROUTER_IP, monitorInterfaces: ifaces });
  } catch (e) {
    res.json({ routerIp: ROUTER_IP, monitorInterfaces: MONITOR_INTERFACES.split(',') });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   MikroTik Dashboard                     ║`);
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log(`  ║   Router: ${ROUTER_IP}:${ROUTER_PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
