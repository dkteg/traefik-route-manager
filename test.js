/**
 * Traefik Route Manager — Integration Tests
 *
 * Runs against a live server instance using a temporary config directory.
 * Usage:  node test.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Config ─────────────────────────────────────────────────────
const PORT = 3099;
const TEST_DIR = '/tmp/trm-test-config';
const BACKUP_DIR = path.join(TEST_DIR, '.backups');

let server;
let passed = 0, failed = 0;

// ── HTTP helper ────────────────────────────────────────────────
function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: PORT, path: urlPath, method, headers: {} };
    if (body) {
      const payload = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        let parsed = data;
        if (ct.includes('json')) try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ── Test runner ────────────────────────────────────────────────
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── Setup ──────────────────────────────────────────────────────
function setup() {
  // Create test config directory with seed data
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Seed file: test-routes.yml
  const seed = {
    http: {
      routers: {
        'app-router': {
          rule: 'Host(`app.example.com`)',
          service: 'app-service',
          entryPoints: ['websecure'],
        },
        'api-router': {
          rule: 'Host(`api.example.com`)',
          service: 'api-service',
          entryPoints: ['websecure'],
          middlewares: ['auth'],
        },
      },
      services: {
        'app-service': {
          loadBalancer: { servers: [{ url: 'http://10.0.0.1:8080' }] },
        },
        'api-service': {
          loadBalancer: { servers: [{ url: 'http://10.0.0.2:3000' }] },
        },
      },
      middlewares: {
        auth: {
          forwardAuth: { address: 'http://10.0.0.5:9000/auth' },
        },
      },
    },
  };
  const yaml = require('js-yaml');
  fs.writeFileSync(path.join(TEST_DIR, 'test-routes.yml'), yaml.dump(seed));

  // Seed TCP file
  const tcpSeed = {
    tcp: {
      routers: {
        'db-router': {
          entryPoints: ['postgres'],
          rule: 'HostSNI(`db.example.com`)',
          service: 'db-service',
        },
      },
      services: {
        'db-service': {
          loadBalancer: { servers: [{ address: '10.0.0.3:5432' }] },
        },
      },
    },
  };
  fs.writeFileSync(path.join(TEST_DIR, 'tcp-routes.yml'), yaml.dump(tcpSeed));

  // Start server
  process.env.CONFIG_DIR = TEST_DIR;
  process.env.BACKUP_DIR = BACKUP_DIR;
  process.env.PORT = String(PORT);

  return new Promise(resolve => {
    // Clear require cache so env vars take effect
    delete require.cache[require.resolve('./server')];
    const app = require('./server');
    // The server.js calls app.listen, so we wait a moment
    setTimeout(resolve, 500);
  });
}

// ── Tests ──────────────────────────────────────────────────────
async function runTests() {
  console.log('\n🧪 Traefik Route Manager — Test Suite\n');

  // ── Overview ───────────────────────────────────
  console.log('📊 Overview');
  await test('GET /api/overview returns correct counts', async () => {
    const { status, body } = await req('GET', '/api/overview');
    assertEqual(status, 200);
    assertEqual(body.files, 2);
    assertEqual(body.httpRouters, 2);
    assertEqual(body.httpServices, 2);
    assertEqual(body.httpMiddlewares, 1);
    assertEqual(body.tcpRouters, 1);
    assertEqual(body.tcpServices, 1);
  });

  // ── Files ──────────────────────────────────────
  console.log('\n📁 Files');
  await test('GET /api/files lists all YAML files', async () => {
    const { status, body } = await req('GET', '/api/files');
    assertEqual(status, 200);
    assertEqual(body.length, 2);
    assert(body.some(f => f.name === 'test-routes.yml'), 'Missing test-routes.yml');
    assert(body.some(f => f.name === 'tcp-routes.yml'), 'Missing tcp-routes.yml');
  });

  await test('GET /api/files/:name returns parsed content', async () => {
    const { status, body } = await req('GET', '/api/files/test-routes.yml');
    assertEqual(status, 200);
    assert(body.http.routers['app-router'], 'Missing app-router');
    assertEqual(body.http.routers['app-router'].rule, 'Host(`app.example.com`)');
  });

  await test('GET /api/files/:name/raw returns YAML text', async () => {
    const { status, raw } = await req('GET', '/api/files/test-routes.yml/raw');
    assertEqual(status, 200);
    assert(raw.includes('app-router'), 'Raw YAML should contain app-router');
  });

  await test('GET /api/files/nonexistent.yml returns 404', async () => {
    const { status } = await req('GET', '/api/files/nonexistent.yml');
    assertEqual(status, 404);
  });

  await test('POST /api/files creates a new config file', async () => {
    const { status, body } = await req('POST', '/api/files', { filename: 'new-routes.yml' });
    assertEqual(status, 200);
    assert(body.success, 'Should succeed');
    assert(fs.existsSync(path.join(TEST_DIR, 'new-routes.yml')), 'File should exist on disk');
  });

  await test('POST /api/files rejects duplicate filename', async () => {
    const { status } = await req('POST', '/api/files', { filename: 'new-routes.yml' });
    assertEqual(status, 409);
  });

  await test('POST /api/files rejects non-YAML filename', async () => {
    const { status } = await req('POST', '/api/files', { filename: 'bad.txt' });
    assertEqual(status, 400);
  });

  // ── HTTP Routers CRUD ──────────────────────────
  console.log('\n🔀 HTTP Routers');
  await test('POST create a new router', async () => {
    const config = { rule: 'Host(`new.example.com`)', service: 'new-svc', entryPoints: ['websecure'] };
    const { status, body } = await req('POST', '/api/files/test-routes.yml/routers', { name: 'new-router', config });
    assertEqual(status, 200);
    assert(body.success);
    // Verify on disk
    const data = require('js-yaml').load(fs.readFileSync(path.join(TEST_DIR, 'test-routes.yml'), 'utf8'));
    assert(data.http.routers['new-router'], 'Router should exist in file');
    assertEqual(data.http.routers['new-router'].rule, 'Host(`new.example.com`)');
  });

  await test('POST create router rejects duplicate name', async () => {
    const config = { rule: 'Host(`dup.example.com`)', service: 'dup-svc' };
    const { status } = await req('POST', '/api/files/test-routes.yml/routers', { name: 'new-router', config });
    assertEqual(status, 409);
  });

  await test('PUT update an existing router', async () => {
    const config = { rule: 'Host(`updated.example.com`)', service: 'updated-svc', entryPoints: ['web'] };
    const { status, body } = await req('PUT', '/api/files/test-routes.yml/routers/new-router', { config });
    assertEqual(status, 200);
    assert(body.success);
    const data = require('js-yaml').load(fs.readFileSync(path.join(TEST_DIR, 'test-routes.yml'), 'utf8'));
    assertEqual(data.http.routers['new-router'].rule, 'Host(`updated.example.com`)');
  });

  await test('PUT update nonexistent router returns 404', async () => {
    const { status } = await req('PUT', '/api/files/test-routes.yml/routers/ghost', { config: { rule: 'x', service: 'y' } });
    assertEqual(status, 404);
  });

  await test('DELETE remove a router', async () => {
    const { status, body } = await req('DELETE', '/api/files/test-routes.yml/routers/new-router');
    assertEqual(status, 200);
    assert(body.success);
    const data = require('js-yaml').load(fs.readFileSync(path.join(TEST_DIR, 'test-routes.yml'), 'utf8'));
    assert(!data.http.routers['new-router'], 'Router should be removed from file');
  });

  await test('DELETE nonexistent router returns 404', async () => {
    const { status } = await req('DELETE', '/api/files/test-routes.yml/routers/ghost');
    assertEqual(status, 404);
  });

  // ── HTTP Services CRUD ─────────────────────────
  console.log('\n🖥️  HTTP Services');
  await test('POST create a new service', async () => {
    const config = { loadBalancer: { servers: [{ url: 'http://10.0.0.99:9090' }] } };
    const { status, body } = await req('POST', '/api/files/test-routes.yml/services', { name: 'new-svc', config });
    assertEqual(status, 200);
    assert(body.success);
  });

  await test('PUT update a service', async () => {
    const config = { loadBalancer: { servers: [{ url: 'http://10.0.0.100:9090' }] } };
    const { status } = await req('PUT', '/api/files/test-routes.yml/services/new-svc', { config });
    assertEqual(status, 200);
  });

  await test('DELETE remove a service', async () => {
    const { status } = await req('DELETE', '/api/files/test-routes.yml/services/new-svc');
    assertEqual(status, 200);
  });

  // ── HTTP Middlewares CRUD ──────────────────────
  console.log('\n🛡️  Middlewares');
  await test('POST create a middleware', async () => {
    const config = { redirectRegex: { regex: '(.*)', replacement: 'https://example.com' } };
    const { status } = await req('POST', '/api/files/test-routes.yml/middlewares', { name: 'test-redirect', config });
    assertEqual(status, 200);
  });

  await test('PUT update a middleware', async () => {
    const config = { redirectRegex: { regex: '(.*)', replacement: 'https://updated.com' } };
    const { status } = await req('PUT', '/api/files/test-routes.yml/middlewares/test-redirect', { config });
    assertEqual(status, 200);
  });

  await test('DELETE remove a middleware', async () => {
    const { status } = await req('DELETE', '/api/files/test-routes.yml/middlewares/test-redirect');
    assertEqual(status, 200);
  });

  // ── TCP Routers CRUD ──────────────────────────
  console.log('\n🔌 TCP Routers');
  await test('POST create a TCP router', async () => {
    const config = { entryPoints: ['redis'], rule: 'HostSNI(`redis.example.com`)', service: 'redis-svc' };
    const { status } = await req('POST', '/api/files/tcp-routes.yml/tcp/routers', { name: 'redis-router', config });
    assertEqual(status, 200);
  });

  await test('PUT update a TCP router', async () => {
    const config = { entryPoints: ['redis'], rule: 'HostSNI(`redis2.example.com`)', service: 'redis-svc' };
    const { status } = await req('PUT', '/api/files/tcp-routes.yml/tcp/routers/redis-router', { config });
    assertEqual(status, 200);
  });

  await test('DELETE remove a TCP router', async () => {
    const { status } = await req('DELETE', '/api/files/tcp-routes.yml/tcp/routers/redis-router');
    assertEqual(status, 200);
  });

  // ── TCP Services CRUD ─────────────────────────
  console.log('\n🔌 TCP Services');
  await test('POST create a TCP service', async () => {
    const config = { loadBalancer: { servers: [{ address: '10.0.0.50:6379' }] } };
    const { status } = await req('POST', '/api/files/tcp-routes.yml/tcp/services', { name: 'redis-svc', config });
    assertEqual(status, 200);
  });

  await test('DELETE remove a TCP service', async () => {
    const { status } = await req('DELETE', '/api/files/tcp-routes.yml/tcp/services/redis-svc');
    assertEqual(status, 200);
  });

  // ── Backups ────────────────────────────────────
  console.log('\n💾 Backups');
  await test('GET /api/backups returns backup list', async () => {
    const { status, body } = await req('GET', '/api/backups');
    assertEqual(status, 200);
    assert(Array.isArray(body));
    assert(body.length > 0, 'Should have backups from previous write operations');
  });

  await test('Backups contain correct filenames', async () => {
    const { body } = await req('GET', '/api/backups');
    const hasTestRoutes = body.some(b => b.name.startsWith('test-routes.yml'));
    const hasTcpRoutes = body.some(b => b.name.startsWith('tcp-routes.yml'));
    assert(hasTestRoutes, 'Should have test-routes.yml backup');
    assert(hasTcpRoutes, 'Should have tcp-routes.yml backup');
  });

  await test('POST restore a backup', async () => {
    const { body: backups } = await req('GET', '/api/backups');
    const backup = backups.find(b => b.name.startsWith('test-routes.yml'));
    const { status, body } = await req('POST', `/api/backups/${encodeURIComponent(backup.name)}/restore`);
    assertEqual(status, 200);
    assert(body.success);
  });

  await test('DELETE a backup', async () => {
    const { body: backups } = await req('GET', '/api/backups');
    const backup = backups[backups.length - 1]; // delete oldest
    const { status, body } = await req('DELETE', `/api/backups/${encodeURIComponent(backup.name)}`);
    assertEqual(status, 200);
    assert(body.success);
  });

  // ── Validation ─────────────────────────────────
  console.log('\n🔒 Validation');
  await test('POST router without name returns 400', async () => {
    const { status } = await req('POST', '/api/files/test-routes.yml/routers', { config: { rule: 'x', service: 'y' } });
    assertEqual(status, 400);
  });

  await test('POST router without config returns 400', async () => {
    const { status } = await req('POST', '/api/files/test-routes.yml/routers', { name: 'x' });
    assertEqual(status, 400);
  });

  await test('PUT router without config returns 400', async () => {
    const { status } = await req('PUT', '/api/files/test-routes.yml/routers/app-router', {});
    assertEqual(status, 400);
  });

  // ── Summary ────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'═'.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// ── Main ───────────────────────────────────────────────────────
(async () => {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
})();
