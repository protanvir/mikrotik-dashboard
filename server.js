require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ──────────────────────────────────────────────────────────────────
const ROUTER_IP   = process.env.ROUTER_IP   || '192.168.88.1';
const ROUTER_PORT = process.env.ROUTER_PORT  || '443';
const PORT        = process.env.PORT         || 3000;
const MONITOR_INTERFACES = process.env.MONITOR_INTERFACES || 'ether1';

const CONFIG_DIR  = path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'routers.json');
const httpsAgent  = new https.Agent({ rejectUnauthorized: false });

// ── Router config helpers ───────────────────────────────────────────────────
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadRouters() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    const envIp = process.env.ROUTER_IP;
    const envUser = process.env.ROUTER_USER;
    if (envIp && envIp !== '192.168.88.1' && envUser && envUser !== 'admin') {
      const firstRouter = {
        id: 'router-1',
        name: 'Default Router',
        location: '',
        ip: envIp,
        port: parseInt(process.env.ROUTER_PORT || '443', 10),
        username: envUser,
        password: process.env.ROUTER_PASS || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveRouters([firstRouter]);
      return [firstRouter];
    }
    saveRouters([]);
    return [];
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.routers) ? parsed.routers : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRouters(routers) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ routers }, null, 2), 'utf8');
}

function getRouter(id) {
  const routers = loadRouters();
  return routers.find(r => r.id === id) || null;
}

// ── MikroTik REST helper ─────────────────────────────────────────────────────
async function mt(apiPath, method = 'get', body = null, routerId = null) {
  const routers = loadRouters();
  let router;
  if (routerId) {
    router = routers.find(r => r.id === routerId);
  } else {
    router = routers[0];
  }
  if (!router) throw new Error('No router configured or invalid router ID');

  const protocol = String(router.port) === '80' ? 'http' : 'https';
  const url = `${protocol}://${router.ip}:${router.port}/rest${apiPath}`;
  const cfg = {
    method,
    url,
    auth: { username: router.username, password: router.password },
    timeout: 15000,
  };
  if (String(router.port) !== '80') cfg.httpsAgent = httpsAgent;
  if (body) cfg.data = body;
  const resp = await axios(cfg);
  return resp.data;
}

// ── Router CRUD API ─────────────────────────────────────────────────────────

// GET /api/routers — list all routers (without passwords)
app.get('/api/routers', (req, res) => {
  const routers = loadRouters().map(r => {
    const { password, ...safe } = r;
    return { ...safe, hasPassword: !!r.password };
  });
  res.json(routers);
});

// GET /api/routers/:id — single router (without password)
app.get('/api/routers/:id', (req, res) => {
  const router = getRouter(req.params.id);
  if (!router) return res.status(404).json({ error: 'Router not found' });
  const { password, ...safe } = router;
  res.json({ ...safe, hasPassword: !!router.password });
});

// POST /api/routers — create a new router
app.post('/api/routers', (req, res) => {
  const { name, location, ip, port, username, password } = req.body;
  if (!name || !ip || !username || !password) {
    return res.status(400).json({ error: 'Name, IP, username, and password are required' });
  }
  const routers = loadRouters();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = slug + '-' + Date.now().toString(36);
  const newRouter = {
    id,
    name,
    location: location || '',
    ip,
    port: parseInt(port || '443', 10),
    username,
    password,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  routers.push(newRouter);
  saveRouters(routers);
  const { password: _, ...safe } = newRouter;
  res.status(201).json({ ...safe, hasPassword: true });
});

// PUT /api/routers/:id — update a router
app.put('/api/routers/:id', (req, res) => {
  const routers = loadRouters();
  const index = routers.findIndex(r => r.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Router not found' });

  const { name, location, ip, port, username, password } = req.body;
  if (name) routers[index].name = name;
  if (location !== undefined) routers[index].location = location;
  if (ip) routers[index].ip = ip;
  if (port) routers[index].port = parseInt(port, 10);
  if (username) routers[index].username = username;
  if (password) routers[index].password = password;
  routers[index].updatedAt = new Date().toISOString();

  saveRouters(routers);
  const { password: _, ...safe } = routers[index];
  res.json({ ...safe, hasPassword: !!routers[index].password });
});

// DELETE /api/routers/:id — delete a router
app.delete('/api/routers/:id', (req, res) => {
  const routers = loadRouters();
  const index = routers.findIndex(r => r.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Router not found' });
  routers.splice(index, 1);
  saveRouters(routers);
  res.json({ success: true });
});

// POST /api/routers/test — test connection to arbitrary credentials (no save)
app.post('/api/routers/test', async (req, res) => {
  try {
    const { ip, port, username, password } = req.body;
    if (!ip || !username || !password) {
      return res.status(400).json({ success: false, error: 'IP, username, and password required' });
    }
    const protocol = String(port || '443') === '80' ? 'http' : 'https';
    const url = `${protocol}://${ip}:${port || 443}/rest/system/resource`;
    const cfg = {
      method: 'get',
      url,
      auth: { username, password },
      timeout: 10000,
    };
    if (String(port || '443') !== '80') cfg.httpsAgent = httpsAgent;
    const resp = await axios(cfg);
    res.json({ success: true, version: resp.data.version || 'unknown', uptime: resp.data.uptime || 'unknown' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// GET /api/routers/:id/test — test connection to a saved router
app.get('/api/routers/:id/test', async (req, res) => {
  try {
    const router = getRouter(req.params.id);
    if (!router) return res.status(404).json({ error: 'Router not found' });
    const data = await mt('/system/resource', 'get', null, router.id);
    res.json({ success: true, version: data.version || 'unknown', uptime: data.uptime || 'unknown' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── API Routes (proxied to router) ──────────────────────────────────────────

// System resource: CPU, RAM, uptime, RouterOS version
app.get('/api/resource', async (req, res) => {
  try {
    res.json(await mt('/system/resource', 'get', null, req.query.routerId));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// System health — structured for CCR2116-12G-4S+ sensor layout
app.get('/api/health', async (req, res) => {
  try {
    const raw = await mt('/system/health', 'get', null, req.query.routerId);
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
    res.json(await mt('/interface', 'get', null, req.query.routerId));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Dynamic interface discovery (per-router cache) ────────────────────────────
const discoveryCache = {};
const DISCOVERY_TTL = 30000;

async function discoverInterfaces(routerId) {
  const cacheKey = routerId || '__default__';
  const cached = discoveryCache[cacheKey];
  if (cached && Date.now() - cached.at < DISCOVERY_TTL) {
    return cached.data;
  }
  const raw = await mt('/interface', 'get', null, routerId);
  const items = Array.isArray(raw) ? raw : [raw];
  const result = items
    .filter(i => {
      const running = i.running === 'true' || i.running === true;
      const isLoopback = i.type === 'loopback';
      const isDynamic = i.dynamic === 'true' || i.dynamic === true;
      return running && !isLoopback && !isDynamic;
    })
    .map(i => i.name)
    .filter(name => /^[\w.\-]+$/.test(name));
  discoveryCache[cacheKey] = { data: result, at: Date.now() };
  return result;
}

// Live traffic snapshot (POST to MikroTik monitor-traffic)
app.get('/api/traffic', async (req, res) => {
  try {
    const routerId = req.query.routerId;
    const ifaces = req.query.interfaces || (await discoverInterfaces(routerId)).join(',');
    const data = await mt('/interface/monitor-traffic', 'post', {
      interface: ifaces,
      once: 'true',
    }, routerId);
    res.json(Array.isArray(data) ? data : [data]);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Active firewall connections (limited to 100 newest)
app.get('/api/connections', async (req, res) => {
  try {
    const data = await mt(
      '/ip/firewall/connection?.proplist=src-address,dst-address,protocol,state,reply-src-address,reply-dst-address&.limit=100',
      'get', null, req.query.routerId
    );
    res.json({ connections: Array.isArray(data) ? data : [], total: Array.isArray(data) ? data.length : 0 });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Active PPTP/PPP sessions
app.get('/api/pptp', async (req, res) => {
  try {
    const data = await mt('/ppp/active?.proplist=.id,name,service,caller-id,address,uptime,bytes-in,bytes-out',
      'get', null, req.query.routerId);
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
    const sessions = await mt('/routing/bgp/session', 'get', null, req.query.routerId);
    res.json(Array.isArray(sessions) ? sessions : []);
  } catch (e) {
    if (e.response && e.response.status === 404) {
      return res.json([]);
    }
    res.status(502).json({ error: e.message });
  }
});

// Config endpoint for the frontend
app.get('/api/config', async (req, res) => {
  try {
    const routerId = req.query.routerId;
    const router = getRouter(routerId);
    if (!router) {
      return res.json({
        routerIp: ROUTER_IP,
        routerName: 'Default',
        routerId: null,
        monitorInterfaces: MONITOR_INTERFACES.split(','),
      });
    }
    const ifaces = await discoverInterfaces(routerId);
    res.json({
      routerIp: router.ip,
      routerName: router.name,
      routerId: router.id,
      monitorInterfaces: ifaces,
    });
  } catch (e) {
    const router = getRouter(req.query.routerId);
    if (router) {
      res.json({ routerIp: router.ip, routerName: router.name, routerId: router.id, monitorInterfaces: MONITOR_INTERFACES.split(',') });
    } else {
      res.json({ routerIp: ROUTER_IP, routerName: 'Default', routerId: null, monitorInterfaces: MONITOR_INTERFACES.split(',') });
    }
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const count = loadRouters().length;
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   MikroTik Dashboard                     ║`);
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log(`  ║   Routers configured: ${count}                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
