const express = require('express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/yaml', limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Configuration ──────────────────────────────────────────────
const CONFIG_DIR = process.env.CONFIG_DIR || '/etc/traefik/dynamic';
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(CONFIG_DIR, '.backups');
const PORT = process.env.PORT || 3000;

// Traefik host/static paths (auto-detected or configured)
const TRAEFIK_ROOT_DIR = process.env.TRAEFIK_ROOT_DIR || (fs.existsSync('/etc/traefik') ? '/etc/traefik' : null);
const STATIC_CONFIG_FILE = process.env.STATIC_CONFIG_FILE || 
  (TRAEFIK_ROOT_DIR && fs.existsSync(path.join(TRAEFIK_ROOT_DIR, 'traefik.yml')) ? path.join(TRAEFIK_ROOT_DIR, 'traefik.yml') : null);
const ACCESS_LOG_FILE = process.env.ACCESS_LOG_FILE || 
  (TRAEFIK_ROOT_DIR && fs.existsSync(path.join(TRAEFIK_ROOT_DIR, 'logs', 'access.log')) ? path.join(TRAEFIK_ROOT_DIR, 'logs', 'access.log') : null);
const ACME_JSON_FILE = process.env.ACME_JSON_FILE || 
  (TRAEFIK_ROOT_DIR && fs.existsSync(path.join(TRAEFIK_ROOT_DIR, 'certs', 'cloudflare-acme.json')) 
    ? path.join(TRAEFIK_ROOT_DIR, 'certs', 'cloudflare-acme.json') 
    : (TRAEFIK_ROOT_DIR && fs.existsSync(path.join(TRAEFIK_ROOT_DIR, 'acme.json')) ? path.join(TRAEFIK_ROOT_DIR, 'acme.json') : null));
const TRAEFIK_API_URL = process.env.TRAEFIK_API_URL || 'http://localhost:8080';

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Helpers ────────────────────────────────────────────────────

function getYamlFiles() {
  if (!fs.existsSync(CONFIG_DIR)) return [];
  return fs.readdirSync(CONFIG_DIR)
    .filter(f => /\.ya?ml$/i.test(f) && !f.startsWith('.'))
    .sort();
}

function readYamlFile(filename) {
  const filepath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  const raw = fs.readFileSync(filepath, 'utf8');
  let parsed = {};
  try {
    parsed = yaml.load(raw) || {};
  } catch (e) {
    parsed = {};
  }
  return { raw, parsed };
}

function writeYamlFile(filename, data) {
  const filepath = path.join(CONFIG_DIR, filename);
  createBackup(filename);
  const out = yaml.dump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  fs.writeFileSync(filepath, out, 'utf8');
}

function writeRawYamlFile(filename, rawText) {
  const filepath = path.join(CONFIG_DIR, filename);
  createBackup(filename);
  fs.writeFileSync(filepath, rawText, 'utf8');
}

function createBackup(filename) {
  const src = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(src)) return;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `${filename}.${ts}.bak`);
  fs.copyFileSync(src, dest);
}

function sanitizeFilename(name) {
  return path.basename(name);
}

function getOriginalFilenameFromBackup(backupName) {
  const safe = sanitizeFilename(backupName);
  const parts = safe.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'yml' || parts[i] === 'yaml') {
      const orig = sanitizeFilename(parts.slice(0, i + 1).join('.'));
      return orig.startsWith('.') ? null : orig;
    }
  }
  return null;
}

// Line-by-line unified diff calculation
function computeUnifiedDiff(oldStr, newStr) {
  const a = (oldStr || '').split(/\r?\n/);
  const b = (newStr || '').split(/\r?\n/);
  const n = a.length;
  const m = b.length;

  // Cap diff table size for safety
  if (n * m > 1000000) {
    return [{ type: 'info', text: 'File too large for inline visual diff preview.' }];
  }

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (a[i] === b[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = n, j = m;
  const diff = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      diff.unshift({ type: 'normal', text: a[i - 1], oldLine: i, newLine: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'add', text: b[j - 1], newLine: j });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.unshift({ type: 'del', text: a[i - 1], oldLine: i });
      i--;
    }
  }
  return diff;
}

// ── API: File listing & raw access ─────────────────────────────

app.get('/api/files', (req, res) => {
  try {
    const files = getYamlFiles().map(f => {
      const data = readYamlFile(f);
      const parsed = data?.parsed || {};
      const httpRouters = parsed.http?.routers ? Object.keys(parsed.http.routers).length : 0;
      const httpServices = parsed.http?.services ? Object.keys(parsed.http.services).length : 0;
      const httpMiddlewares = parsed.http?.middlewares ? Object.keys(parsed.http.middlewares).length : 0;
      const httpServersTransports = parsed.http?.serversTransports ? Object.keys(parsed.http.serversTransports).length : 0;
      const tcpRouters = parsed.tcp?.routers ? Object.keys(parsed.tcp.routers).length : 0;
      const tcpServices = parsed.tcp?.services ? Object.keys(parsed.tcp.services).length : 0;
      const tcpMiddlewares = parsed.tcp?.middlewares ? Object.keys(parsed.tcp.middlewares).length : 0;
      const tcpServersTransports = parsed.tcp?.serversTransports ? Object.keys(parsed.tcp.serversTransports).length : 0;
      const tlsConfig = !!parsed.tls;

      return {
        name: f,
        httpRouters, httpServices, httpMiddlewares, httpServersTransports,
        tcpRouters, tcpServices, tcpMiddlewares, tcpServersTransports,
        tlsConfig,
      };
    });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/:filename', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });
    res.json(data.parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/:filename/raw', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });
    res.type('text/yaml').send(data.raw);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update raw YAML directly with validation
app.put('/api/files/:filename/raw', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const filepath = path.join(CONFIG_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });

    let rawText = '';
    if (typeof req.body === 'string') {
      rawText = req.body;
    } else if (req.body && typeof req.body.raw === 'string') {
      rawText = req.body.raw;
    } else {
      return res.status(400).json({ error: 'YAML text body is required' });
    }

    // Validate YAML
    try {
      yaml.load(rawText);
    } catch (parseErr) {
      return res.status(400).json({
        error: `Invalid YAML syntax: ${parseErr.message}`,
        line: parseErr.mark ? parseErr.mark.line + 1 : undefined,
        column: parseErr.mark ? parseErr.mark.column + 1 : undefined
      });
    }

    writeRawYamlFile(filename, rawText);
    res.json({ success: true, file: filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Overview / Dashboard ──────────────────────────────────

app.get('/api/overview', (req, res) => {
  try {
    const files = getYamlFiles();
    let totalHttpRouters = 0, totalHttpServices = 0, totalHttpMiddlewares = 0, totalHttpTransports = 0;
    let totalTcpRouters = 0, totalTcpServices = 0, totalTcpMiddlewares = 0, totalTcpTransports = 0;

    for (const f of files) {
      const data = readYamlFile(f);
      const p = data?.parsed || {};
      totalHttpRouters += p.http?.routers ? Object.keys(p.http.routers).length : 0;
      totalHttpServices += p.http?.services ? Object.keys(p.http.services).length : 0;
      totalHttpMiddlewares += p.http?.middlewares ? Object.keys(p.http.middlewares).length : 0;
      totalHttpTransports += p.http?.serversTransports ? Object.keys(p.http.serversTransports).length : 0;
      totalTcpRouters += p.tcp?.routers ? Object.keys(p.tcp.routers).length : 0;
      totalTcpServices += p.tcp?.services ? Object.keys(p.tcp.services).length : 0;
      totalTcpMiddlewares += p.tcp?.middlewares ? Object.keys(p.tcp.middlewares).length : 0;
      totalTcpTransports += p.tcp?.serversTransports ? Object.keys(p.tcp.serversTransports).length : 0;
    }

    res.json({
      files: files.length,
      httpRouters: totalHttpRouters,
      httpServices: totalHttpServices,
      httpMiddlewares: totalHttpMiddlewares,
      httpServersTransports: totalHttpTransports,
      tcpRouters: totalTcpRouters,
      tcpServices: totalTcpServices,
      tcpMiddlewares: totalTcpMiddlewares,
      tcpServersTransports: totalTcpTransports,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Atomic Unified Bundle Creation (Router + Service + Middleware) ───

app.post('/api/files/:filename/bundle', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { proto = 'http', router, service, middleware } = req.body;
    if (!router || !router.name || !router.config) {
      return res.status(400).json({ error: 'router name and config are required' });
    }

    const p = data.parsed;
    const protocol = proto === 'tcp' ? 'tcp' : 'http';
    if (!p[protocol]) p[protocol] = {};

    // 1. Service (if creating inline service)
    if (service && service.name && service.config) {
      if (!p[protocol].services) p[protocol].services = {};
      p[protocol].services[service.name] = service.config;
    }

    // 2. Middleware (if creating inline middleware)
    if (middleware && middleware.name && middleware.config) {
      if (!p[protocol].middlewares) p[protocol].middlewares = {};
      p[protocol].middlewares[middleware.name] = middleware.config;
    }

    // 3. Router
    if (!p[protocol].routers) p[protocol].routers = {};
    if (p[protocol].routers[router.name]) {
      return res.status(409).json({ error: `Router "${router.name}" already exists` });
    }
    p[protocol].routers[router.name] = router.config;

    writeYamlFile(filename, p);
    res.json({
      success: true,
      router: router.name,
      service: service?.name,
      middleware: middleware?.name
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: HTTP Routers CRUD ─────────────────────────────────────

app.post('/api/files/:filename/routers', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.http) parsed.http = {};
    if (!parsed.http.routers) parsed.http.routers = {};
    if (parsed.http.routers[name]) return res.status(409).json({ error: 'Router already exists' });

    parsed.http.routers[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, router: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/routers/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const routerName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.http?.routers?.[routerName]) {
      return res.status(404).json({ error: 'Router not found' });
    }

    parsed.http.routers[routerName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, router: routerName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/routers/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const routerName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.http?.routers?.[routerName]) {
      return res.status(404).json({ error: 'Router not found' });
    }

    delete parsed.http.routers[routerName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: routerName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: HTTP Services CRUD ────────────────────────────────────

app.post('/api/files/:filename/services', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.http) parsed.http = {};
    if (!parsed.http.services) parsed.http.services = {};
    if (parsed.http.services[name]) return res.status(409).json({ error: 'Service already exists' });

    parsed.http.services[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, service: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/services/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const serviceName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.http?.services?.[serviceName]) {
      return res.status(404).json({ error: 'Service not found' });
    }

    parsed.http.services[serviceName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, service: serviceName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/services/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const serviceName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.http?.services?.[serviceName]) {
      return res.status(404).json({ error: 'Service not found' });
    }

    delete parsed.http.services[serviceName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: serviceName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: HTTP Middlewares CRUD ──────────────────────────────────

app.post('/api/files/:filename/middlewares', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.http) parsed.http = {};
    if (!parsed.http.middlewares) parsed.http.middlewares = {};
    if (parsed.http.middlewares[name]) return res.status(409).json({ error: 'Middleware already exists' });

    parsed.http.middlewares[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, middleware: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/middlewares/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const mwName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.http?.middlewares?.[mwName]) {
      return res.status(404).json({ error: 'Middleware not found' });
    }

    parsed.http.middlewares[mwName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, middleware: mwName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/middlewares/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const mwName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.http?.middlewares?.[mwName]) {
      return res.status(404).json({ error: 'Middleware not found' });
    }

    delete parsed.http.middlewares[mwName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: mwName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: TCP Routers CRUD ──────────────────────────────────────

app.post('/api/files/:filename/tcp/routers', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.tcp) parsed.tcp = {};
    if (!parsed.tcp.routers) parsed.tcp.routers = {};
    if (parsed.tcp.routers[name]) return res.status(409).json({ error: 'TCP Router already exists' });

    parsed.tcp.routers[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, router: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/tcp/routers/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const routerName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.tcp?.routers?.[routerName]) {
      return res.status(404).json({ error: 'TCP Router not found' });
    }

    parsed.tcp.routers[routerName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, router: routerName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/tcp/routers/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const routerName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.tcp?.routers?.[routerName]) {
      return res.status(404).json({ error: 'TCP Router not found' });
    }

    delete parsed.tcp.routers[routerName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: routerName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: TCP Services CRUD ─────────────────────────────────────

app.post('/api/files/:filename/tcp/services', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.tcp) parsed.tcp = {};
    if (!parsed.tcp.services) parsed.tcp.services = {};
    if (parsed.tcp.services[name]) return res.status(409).json({ error: 'TCP Service already exists' });

    parsed.tcp.services[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, service: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/tcp/services/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const serviceName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.tcp?.services?.[serviceName]) {
      return res.status(404).json({ error: 'TCP Service not found' });
    }

    parsed.tcp.services[serviceName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, service: serviceName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/tcp/services/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const serviceName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.tcp?.services?.[serviceName]) {
      return res.status(404).json({ error: 'TCP Service not found' });
    }

    delete parsed.tcp.services[serviceName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: serviceName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: TCP Middlewares CRUD ──────────────────────────────────

app.post('/api/files/:filename/tcp/middlewares', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.tcp) parsed.tcp = {};
    if (!parsed.tcp.middlewares) parsed.tcp.middlewares = {};
    if (parsed.tcp.middlewares[name]) return res.status(409).json({ error: 'TCP Middleware already exists' });

    parsed.tcp.middlewares[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, middleware: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/tcp/middlewares/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const mwName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.tcp?.middlewares?.[mwName]) {
      return res.status(404).json({ error: 'TCP Middleware not found' });
    }

    parsed.tcp.middlewares[mwName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, middleware: mwName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/tcp/middlewares/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const mwName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.tcp?.middlewares?.[mwName]) {
      return res.status(404).json({ error: 'TCP Middleware not found' });
    }

    delete parsed.tcp.middlewares[mwName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: mwName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: serversTransports CRUD (HTTP & TCP) ───────────────────

app.post('/api/files/:filename/serversTransports', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.http) parsed.http = {};
    if (!parsed.http.serversTransports) parsed.http.serversTransports = {};
    if (parsed.http.serversTransports[name]) return res.status(409).json({ error: 'serversTransport already exists' });

    parsed.http.serversTransports[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, serversTransport: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/serversTransports/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const stName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.http?.serversTransports?.[stName]) {
      return res.status(404).json({ error: 'serversTransport not found' });
    }

    parsed.http.serversTransports[stName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, serversTransport: stName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/serversTransports/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const stName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.http?.serversTransports?.[stName]) {
      return res.status(404).json({ error: 'serversTransport not found' });
    }

    delete parsed.http.serversTransports[stName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: stName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TCP serversTransports
app.post('/api/files/:filename/tcp/serversTransports', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { name, config } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'name and config required' });

    const parsed = data.parsed;
    if (!parsed.tcp) parsed.tcp = {};
    if (!parsed.tcp.serversTransports) parsed.tcp.serversTransports = {};
    if (parsed.tcp.serversTransports[name]) return res.status(409).json({ error: 'TCP serversTransport already exists' });

    parsed.tcp.serversTransports[name] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, serversTransport: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/files/:filename/tcp/serversTransports/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const stName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config required' });

    const parsed = data.parsed;
    if (!parsed.tcp?.serversTransports?.[stName]) {
      return res.status(404).json({ error: 'TCP serversTransport not found' });
    }

    parsed.tcp.serversTransports[stName] = config;
    writeYamlFile(filename, parsed);
    res.json({ success: true, serversTransport: stName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:filename/tcp/serversTransports/:name', (req, res) => {
  try {
    const filename = sanitizeFilename(req.params.filename);
    const stName = req.params.name;
    const data = readYamlFile(filename);
    if (!data) return res.status(404).json({ error: 'File not found' });

    const parsed = data.parsed;
    if (!parsed.tcp?.serversTransports?.[stName]) {
      return res.status(404).json({ error: 'TCP serversTransport not found' });
    }

    delete parsed.tcp.serversTransports[stName];
    writeYamlFile(filename, parsed);
    res.json({ success: true, deleted: stName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Backups & Diff ────────────────────────────────────────

app.get('/api/backups', (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.bak'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          name: f,
          originalFile: getOriginalFilenameFromBackup(f),
          size: stat.size,
          created: stat.mtime
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diff backup against current active file
app.get('/api/backups/:backupName/diff', (req, res) => {
  try {
    const backupName = sanitizeFilename(req.params.backupName);
    const backupPath = path.join(BACKUP_DIR, backupName);
    if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup not found' });

    const origName = getOriginalFilenameFromBackup(backupName);
    if (!origName) return res.status(400).json({ error: 'Cannot determine original filename' });

    const backupRaw = fs.readFileSync(backupPath, 'utf8');
    const currentPath = path.join(CONFIG_DIR, origName);
    const currentRaw = fs.existsSync(currentPath) ? fs.readFileSync(currentPath, 'utf8') : '';

    const diff = computeUnifiedDiff(backupRaw, currentRaw);
    res.json({
      backupName,
      originalFile: origName,
      fileExists: fs.existsSync(currentPath),
      diff,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups/:backupName/restore', (req, res) => {
  try {
    const backupName = sanitizeFilename(req.params.backupName);
    const backupPath = path.join(BACKUP_DIR, backupName);
    if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup not found' });

    const origName = getOriginalFilenameFromBackup(backupName);
    if (!origName) return res.status(400).json({ error: 'Cannot determine original filename' });

    // Backup current before restore
    createBackup(origName);
    fs.copyFileSync(backupPath, path.join(CONFIG_DIR, origName));
    res.json({ success: true, restored: origName, from: backupName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/backups/:backupName', (req, res) => {
  try {
    const backupName = sanitizeFilename(req.params.backupName);
    const backupPath = path.join(BACKUP_DIR, backupName);
    if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup not found' });
    fs.unlinkSync(backupPath);
    res.json({ success: true, deleted: backupName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Create new config file ────────────────────────────────

app.post('/api/files', (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const safe = sanitizeFilename(filename);
    if (!/\.ya?ml$/i.test(safe)) return res.status(400).json({ error: 'Filename must end in .yml or .yaml' });
    if (safe.startsWith('.')) return res.status(400).json({ error: 'Filename cannot start with a dot' });
    const filepath = path.join(CONFIG_DIR, safe);
    if (fs.existsSync(filepath)) return res.status(409).json({ error: 'File already exists' });

    const initial = {
      http: {
        routers: {},
        services: {},
        middlewares: {},
        serversTransports: {}
      }
    };
    writeYamlFile(safe, initial);
    res.json({ success: true, file: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Traefik System & Observability ─────────────────────────

// Capabilities check
app.get('/api/traefik/capabilities', async (req, res) => {
  let apiConnected = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const r = await fetch(`${TRAEFIK_API_URL}/api/overview`, { signal: controller.signal });
    clearTimeout(timeout);
    apiConnected = r.ok;
  } catch (e) {
    apiConnected = false;
  }

  res.json({
    configDir: CONFIG_DIR,
    backupDir: BACKUP_DIR,
    staticConfigFile: STATIC_CONFIG_FILE,
    hasStaticConfig: !!(STATIC_CONFIG_FILE && fs.existsSync(STATIC_CONFIG_FILE)),
    accessLogFile: ACCESS_LOG_FILE,
    hasAccessLog: !!(ACCESS_LOG_FILE && fs.existsSync(ACCESS_LOG_FILE)),
    acmeJsonFile: ACME_JSON_FILE,
    hasAcme: !!(ACME_JSON_FILE && fs.existsSync(ACME_JSON_FILE)),
    apiUrl: TRAEFIK_API_URL,
    apiConnected,
  });
});

// Static Config
app.get('/api/traefik/static', (req, res) => {
  try {
    if (!STATIC_CONFIG_FILE || !fs.existsSync(STATIC_CONFIG_FILE)) {
      return res.json({ available: false, path: STATIC_CONFIG_FILE });
    }
    const raw = fs.readFileSync(STATIC_CONFIG_FILE, 'utf8');
    const parsed = yaml.load(raw) || {};
    res.json({ available: true, path: STATIC_CONFIG_FILE, parsed, raw });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-discovered EntryPoints (from live API, static config, or dynamic files)
app.get('/api/traefik/entrypoints', async (req, res) => {
  try {
    // 1. Try Traefik live API
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const r = await fetch(`${TRAEFIK_API_URL}/api/entrypoints`, { signal: controller.signal });
      clearTimeout(timeout);
      if (r.ok) {
        const liveEp = await r.json();
        return res.json({ source: 'traefik-api', entrypoints: liveEp });
      }
    } catch (e) {}

    // 2. Try static config
    if (STATIC_CONFIG_FILE && fs.existsSync(STATIC_CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(STATIC_CONFIG_FILE, 'utf8');
        const parsed = yaml.load(raw) || {};
        if (parsed.entryPoints) {
          const eps = Object.entries(parsed.entryPoints).map(([name, cfg]) => ({
            name,
            address: cfg.address || '',
            asDefault: cfg.asDefault,
            http: cfg.http
          }));
          return res.json({ source: 'static-config', entrypoints: eps });
        }
      } catch (e) {}
    }

    // 3. Fallback: discover used entrypoints across all dynamic files
    const discovered = new Set(['web', 'websecure']);
    for (const f of getYamlFiles()) {
      const data = readYamlFile(f);
      const p = data?.parsed || {};
      for (const r of Object.values(p.http?.routers || {})) {
        if (Array.isArray(r.entryPoints)) r.entryPoints.forEach(ep => discovered.add(ep));
      }
      for (const r of Object.values(p.tcp?.routers || {})) {
        if (Array.isArray(r.entryPoints)) r.entryPoints.forEach(ep => discovered.add(ep));
      }
    }

    res.json({
      source: 'discovered',
      entrypoints: [...discovered].map(name => ({ name, address: '' }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live Traefik status bridge
app.get('/api/traefik/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const [overviewRes, routersRes] = await Promise.allSettled([
      fetch(`${TRAEFIK_API_URL}/api/overview`, { signal: controller.signal }),
      fetch(`${TRAEFIK_API_URL}/api/http/routers`, { signal: controller.signal })
    ]);
    clearTimeout(timeout);

    let overview = null;
    let routers = null;

    if (overviewRes.status === 'fulfilled' && overviewRes.value.ok) {
      overview = await overviewRes.value.json();
    }
    if (routersRes.status === 'fulfilled' && routersRes.value.ok) {
      routers = await routersRes.value.json();
    }

    if (!overview && !routers) {
      return res.json({ connected: false, message: 'Could not connect to Traefik API' });
    }

    res.json({ connected: true, overview, routers });
  } catch (err) {
    res.json({ connected: false, message: err.message });
  }
});

// Access Log Viewer
app.get('/api/traefik/logs', (req, res) => {
  try {
    if (!ACCESS_LOG_FILE || !fs.existsSync(ACCESS_LOG_FILE)) {
      return res.json({ available: false, logs: [] });
    }

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const filterRouter = (req.query.router || '').toLowerCase();
    const filterStatus = req.query.status || '';
    const query = (req.query.q || '').toLowerCase();

    // Read last 512KB for speed
    const stat = fs.statSync(ACCESS_LOG_FILE);
    const bytesToRead = Math.min(stat.size, 512 * 1024);
    const fd = fs.openSync(ACCESS_LOG_FILE, 'r');
    const buf = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buf, 0, bytesToRead, stat.size - bytesToRead);
    fs.closeSync(fd);

    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const parsedLogs = [];

    // Parse each line (CLF / Traefik format)
    for (let idx = lines.length - 1; idx >= 0 && parsedLogs.length < limit; idx--) {
      const line = lines[idx];
      if (query && !line.toLowerCase().includes(query)) continue;

      const m = line.match(/^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"]+) (\S+)" (\d{3}) (\d+) "(?:[^"]*)" "(?:[^"]*)" \d+ "(?:([^"]*))" "(?:([^"]*))" (\S+)/);

      let item = null;
      if (m) {
        const [, ip, time, method, urlPath, proto, status, bytes, router, service, duration] = m;
        if (filterRouter && !router.toLowerCase().includes(filterRouter)) continue;
        if (filterStatus && !status.startsWith(filterStatus)) continue;

        item = { ip, time, method, path: urlPath, proto, status: parseInt(status), bytes: parseInt(bytes), router, service, duration, raw: line };
      } else {
        if (filterRouter || filterStatus) continue;
        item = { raw: line };
      }
      parsedLogs.push(item);
    }

    res.json({
      available: true,
      path: ACCESS_LOG_FILE,
      totalLines: lines.length,
      logs: parsedLogs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Certificates Inspector
app.get('/api/traefik/certificates', (req, res) => {
  try {
    if (!ACME_JSON_FILE || !fs.existsSync(ACME_JSON_FILE)) {
      return res.json({ available: false, certificates: [] });
    }

    const raw = fs.readFileSync(ACME_JSON_FILE, 'utf8');
    const data = JSON.parse(raw);
    const certList = [];

    for (const [resolverName, resolverData] of Object.entries(data)) {
      if (resolverData && Array.isArray(resolverData.Certificates)) {
        for (const cert of resolverData.Certificates) {
          certList.push({
            resolver: resolverName,
            main: cert.domain?.main,
            sans: cert.domain?.sans || [],
          });
        }
      }
    }

    res.json({ available: true, path: ACME_JSON_FILE, certificates: certList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SPA fallback ───────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n  🚀 Traefik Route Manager`);
  console.log(`  📂 Config directory: ${CONFIG_DIR}`);
  console.log(`  💾 Backup directory: ${BACKUP_DIR}`);
  if (STATIC_CONFIG_FILE && fs.existsSync(STATIC_CONFIG_FILE)) {
    console.log(`  ⚙️  Static config:   ${STATIC_CONFIG_FILE}`);
  }
  if (ACCESS_LOG_FILE && fs.existsSync(ACCESS_LOG_FILE)) {
    console.log(`  📄 Access logs:     ${ACCESS_LOG_FILE}`);
  }
  console.log(`  🌐 http://localhost:${PORT}\n`);
});

module.exports = app;
