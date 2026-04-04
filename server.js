const express = require('express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Configuration ──────────────────────────────────────────────
const CONFIG_DIR = process.env.CONFIG_DIR || '/etc/traefik/dynamic';
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(CONFIG_DIR, '.backups');
const PORT = process.env.PORT || 3000;

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Helpers ────────────────────────────────────────────────────

function getYamlFiles() {
  return fs.readdirSync(CONFIG_DIR)
    .filter(f => /\.ya?ml$/i.test(f) && !f.startsWith('.'))
    .sort();
}

function readYamlFile(filename) {
  const filepath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  const raw = fs.readFileSync(filepath, 'utf8');
  return { raw, parsed: yaml.load(raw) || {} };
}

function writeYamlFile(filename, data) {
  const filepath = path.join(CONFIG_DIR, filename);
  // Create timestamped backup
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

// ── API: File listing & raw access ─────────────────────────────

app.get('/api/files', (req, res) => {
  try {
    const files = getYamlFiles().map(f => {
      const data = readYamlFile(f);
      const parsed = data?.parsed || {};
      const httpRouters = parsed.http?.routers ? Object.keys(parsed.http.routers).length : 0;
      const httpServices = parsed.http?.services ? Object.keys(parsed.http.services).length : 0;
      const httpMiddlewares = parsed.http?.middlewares ? Object.keys(parsed.http.middlewares).length : 0;
      const tcpRouters = parsed.tcp?.routers ? Object.keys(parsed.tcp.routers).length : 0;
      const tcpServices = parsed.tcp?.services ? Object.keys(parsed.tcp.services).length : 0;
      return {
        name: f,
        httpRouters, httpServices, httpMiddlewares,
        tcpRouters, tcpServices,
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

// ── API: Overview / Dashboard ──────────────────────────────────

app.get('/api/overview', (req, res) => {
  try {
    const files = getYamlFiles();
    let totalHttpRouters = 0, totalHttpServices = 0, totalHttpMiddlewares = 0;
    let totalTcpRouters = 0, totalTcpServices = 0;

    for (const f of files) {
      const data = readYamlFile(f);
      const p = data?.parsed || {};
      totalHttpRouters += p.http?.routers ? Object.keys(p.http.routers).length : 0;
      totalHttpServices += p.http?.services ? Object.keys(p.http.services).length : 0;
      totalHttpMiddlewares += p.http?.middlewares ? Object.keys(p.http.middlewares).length : 0;
      totalTcpRouters += p.tcp?.routers ? Object.keys(p.tcp.routers).length : 0;
      totalTcpServices += p.tcp?.services ? Object.keys(p.tcp.services).length : 0;
    }

    res.json({
      files: files.length,
      httpRouters: totalHttpRouters,
      httpServices: totalHttpServices,
      httpMiddlewares: totalHttpMiddlewares,
      tcpRouters: totalTcpRouters,
      tcpServices: totalTcpServices,
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

// ── API: Backups ───────────────────────────────────────────────

app.get('/api/backups', (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.bak'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, created: stat.mtime };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups/:backupName/restore', (req, res) => {
  try {
    const backupName = sanitizeFilename(req.params.backupName);
    const backupPath = path.join(BACKUP_DIR, backupName);
    if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup not found' });

    // Extract original filename: "routes.yml.2024-01-01T00-00-00-000Z.bak" → "routes.yml"
    const parts = backupName.split('.');
    // Find the first .yml or .yaml extension
    let origName = '';
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'yml' || parts[i] === 'yaml') {
        origName = parts.slice(0, i + 1).join('.');
        break;
      }
    }
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
    const filepath = path.join(CONFIG_DIR, safe);
    if (fs.existsSync(filepath)) return res.status(409).json({ error: 'File already exists' });

    const initial = { http: { routers: {}, services: {}, middlewares: {} } };
    writeYamlFile(safe, initial);
    res.json({ success: true, file: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SPA fallback ───────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🚀 Traefik Route Manager`);
  console.log(`  📂 Config directory: ${CONFIG_DIR}`);
  console.log(`  💾 Backup directory: ${BACKUP_DIR}`);
  console.log(`  🌐 http://localhost:${PORT}\n`);
});
