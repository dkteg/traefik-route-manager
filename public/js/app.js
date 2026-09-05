/* ═══════════════════════════════════════════════════════════════
   Traefik Route Manager — Modern Client Application
   ═══════════════════════════════════════════════════════════════ */

const API = '';

// ── State ──────────────────────────────────────────────────────
let currentView = 'dashboard';
let filesCache = [];
let allRouters = [];
let allServices = [];
let allMiddlewares = [];
let allTransports = [];
let entrypointsCache = [];
let capabilitiesCache = {};
let liveStatusCache = null;

let filterSearch = '';
let filterProto = 'all';
let filterFile = 'all';

let drawerCurrentMode = null; // 'router', 'service', 'middleware', 'transport'
let drawerEditingItem = null;

// ── DOM Helpers ────────────────────────────────────────────────
const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

function esc(s) {
  if (s === undefined || s === null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

// ── API Fetcher ────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ── Toast Notifications ────────────────────────────────────────
function toast(message, type = 'success') {
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span><strong>${icons[type] || '•'}</strong></span><span>${esc(message)}</span>`;
  $('#toast-container').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.transition = 'all 0.25s';
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

// ── Modals & Drawers ───────────────────────────────────────────
function openModal(title, bodyHtml, footerHtml, xl = false) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-footer').innerHTML = footerHtml;
  const modal = $('#modal');
  if (xl) modal.classList.add('modal-xl');
  else modal.classList.remove('modal-xl');
  $('#modal-overlay').classList.add('active');
}

function closeModal() {
  $('#modal-overlay').classList.remove('active');
}

$('#modal-close').addEventListener('click', closeModal);
$('#modal-overlay').addEventListener('click', e => {
  if (e.target === $('#modal-overlay')) closeModal();
});

// Diff Modal
function openDiffModal(title, subtitle, diffHtml, footerHtml) {
  $('#diff-modal-title').textContent = title;
  $('#diff-modal-subtitle').textContent = subtitle;
  $('#diff-modal-body').innerHTML = diffHtml;
  $('#diff-modal-footer').innerHTML = footerHtml;
  $('#diff-modal-overlay').classList.add('active');
}

function closeDiffModal() {
  $('#diff-modal-overlay').classList.remove('active');
}

$('#diff-modal-close').addEventListener('click', closeDiffModal);
$('#diff-modal-overlay').addEventListener('click', e => {
  if (e.target === $('#diff-modal-overlay')) closeDiffModal();
});

// Slide-Over Drawer
function openDrawer(title, subtitle, formHtml, footerHtml) {
  $('#drawer-title').textContent = title;
  $('#drawer-subtitle').textContent = subtitle;
  $('#drawer-tab-form').innerHTML = formHtml;
  $('#drawer-footer').innerHTML = footerHtml;
  switchDrawerTab('form');
  $('#drawer-overlay').classList.add('active');
  updateDrawerYamlPreview();
}

function closeDrawer() {
  $('#drawer-overlay').classList.remove('active');
  drawerCurrentMode = null;
  drawerEditingItem = null;
}

$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-overlay').addEventListener('click', e => {
  if (e.target === $('#drawer-overlay')) closeDrawer();
});

function switchDrawerTab(tab) {
  $('#tab-form-btn').classList.toggle('active', tab === 'form');
  $('#tab-yaml-btn').classList.toggle('active', tab === 'yaml');
  $('#drawer-tab-form').classList.toggle('active', tab === 'form');
  $('#drawer-tab-yaml').classList.toggle('active', tab === 'yaml');
  if (tab === 'yaml') updateDrawerYamlPreview();
}

// ── Data Loading & State Management ────────────────────────────
async function loadAllData() {
  try {
    filesCache = await api('/api/files');
    allRouters = [];
    allServices = [];
    allMiddlewares = [];
    allTransports = [];

    for (const f of filesCache) {
      const data = await api(`/api/files/${encodeURIComponent(f.name)}`);
      // HTTP Routers
      if (data.http?.routers) {
        for (const [name, cfg] of Object.entries(data.http.routers)) {
          allRouters.push({ name, config: cfg, file: f.name, proto: 'http' });
        }
      }
      // TCP Routers
      if (data.tcp?.routers) {
        for (const [name, cfg] of Object.entries(data.tcp.routers)) {
          allRouters.push({ name, config: cfg, file: f.name, proto: 'tcp' });
        }
      }
      // HTTP Services
      if (data.http?.services) {
        for (const [name, cfg] of Object.entries(data.http.services)) {
          allServices.push({ name, config: cfg, file: f.name, proto: 'http' });
        }
      }
      // TCP Services
      if (data.tcp?.services) {
        for (const [name, cfg] of Object.entries(data.tcp.services)) {
          allServices.push({ name, config: cfg, file: f.name, proto: 'tcp' });
        }
      }
      // HTTP Middlewares
      if (data.http?.middlewares) {
        for (const [name, cfg] of Object.entries(data.http.middlewares)) {
          allMiddlewares.push({ name, config: cfg, file: f.name, proto: 'http' });
        }
      }
      // TCP Middlewares
      if (data.tcp?.middlewares) {
        for (const [name, cfg] of Object.entries(data.tcp.middlewares)) {
          allMiddlewares.push({ name, config: cfg, file: f.name, proto: 'tcp' });
        }
      }
      // HTTP serversTransports
      if (data.http?.serversTransports) {
        for (const [name, cfg] of Object.entries(data.http.serversTransports)) {
          allTransports.push({ name, config: cfg, file: f.name, proto: 'http' });
        }
      }
      // TCP serversTransports
      if (data.tcp?.serversTransports) {
        for (const [name, cfg] of Object.entries(data.tcp.serversTransports)) {
          allTransports.push({ name, config: cfg, file: f.name, proto: 'tcp' });
        }
      }
    }

    // Update nav counters
    $('#count-routers').textContent = allRouters.length;
    $('#count-services').textContent = allServices.length;
    $('#count-middlewares').textContent = allMiddlewares.length;
    $('#count-transports').textContent = allTransports.length;
    $('#count-files').textContent = filesCache.length;

    // Load EntryPoints and capabilities
    const epData = await api('/api/traefik/entrypoints').catch(() => ({ entrypoints: [] }));
    entrypointsCache = (epData.entrypoints || []).map(ep => ep.name || ep);

    capabilitiesCache = await api('/api/traefik/capabilities').catch(() => ({}));
    if (capabilitiesCache.configDir) {
      $('#config-dir-label').textContent = capabilitiesCache.configDir;
    }

    // Live status bridge check
    checkTraefikApiStatus();
  } catch (err) {
    console.error('Data load error:', err);
  }
}

async function checkTraefikApiStatus() {
  const dot = $('#traefik-api-dot');
  const label = $('#traefik-api-label');
  try {
    const st = await api('/api/traefik/status');
    if (st.connected) {
      liveStatusCache = st;
      dot.className = 'dot-indicator connected';
      label.textContent = 'Traefik Active';
      $('#traefik-status-badge').title = 'Connected to Traefik v3 API';
    } else {
      dot.className = 'dot-indicator disconnected';
      label.textContent = 'API Offline';
      $('#traefik-status-badge').title = 'Traefik API unreachable on host port 8080';
    }
  } catch (e) {
    dot.className = 'dot-indicator unknown';
    label.textContent = 'API Standby';
  }
}

// ── View Navigation ────────────────────────────────────────────
function setView(view) {
  currentView = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

  const titles = {
    dashboard: 'Dashboard',
    topology: 'Route Topology & Pipeline',
    routers: 'Routers',
    services: 'Services',
    middlewares: 'Middlewares',
    transports: 'Servers Transports',
    files: 'Config Files',
    backups: 'Backups & Diff',
    logs: 'Live Access Logs',
    certificates: 'TLS Certificates',
    static: 'Traefik Static Config'
  };
  $('#page-title').textContent = titles[view] || view;

  filterSearch = '';
  filterProto = 'all';
  filterFile = 'all';

  renderCurrentView();
}

async function renderCurrentView() {
  await loadAllData();

  if (currentView === 'dashboard') renderDashboard();
  else if (currentView === 'topology') renderTopology();
  else if (currentView === 'routers') renderRouters();
  else if (currentView === 'services') renderServices();
  else if (currentView === 'middlewares') renderMiddlewares();
  else if (currentView === 'transports') renderTransports();
  else if (currentView === 'files') renderFiles();
  else if (currentView === 'backups') renderBackups();
  else if (currentView === 'logs') renderLogs();
  else if (currentView === 'certificates') renderCertificates();
  else if (currentView === 'static') renderStatic();
}

// Attach sidebar clicks
$$('.nav-item').forEach(n => n.addEventListener('click', e => {
  e.preventDefault();
  setView(n.dataset.view);
  if (window.innerWidth <= 900) $('#sidebar').classList.remove('open');
}));

$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#btn-refresh').addEventListener('click', () => {
  toast('Refreshed data', 'info');
  renderCurrentView();
});

// ── Theme Management ──────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('trm-theme') || 'obsidian';
  document.documentElement.setAttribute('data-theme', saved);
}

function setAppTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('trm-theme', theme);
  $('#theme-menu')?.classList.remove('active');
  const names = {
    obsidian: 'Obsidian Dark (Linear)',
    traefik: 'Traefik Teal (Official)',
    carbon: 'Carbon OLED (Minimal)',
    nord: 'Nord Soft Pastel',
    light: 'Pure Light (Clean)'
  };
  toast(`Theme: ${names[theme] || theme}`);
}

initTheme();

// Theme dropdown toggle
$('#theme-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  $('#theme-menu')?.classList.toggle('active');
  $('#quick-add-menu')?.classList.remove('active');
});

// Quick Add dropdown toggle
$('#quick-add-btn').addEventListener('click', e => {
  e.stopPropagation();
  $('#quick-add-menu').classList.toggle('active');
  $('#theme-menu')?.classList.remove('active');
});

document.addEventListener('click', () => {
  $('#quick-add-menu')?.classList.remove('active');
  $('#theme-menu')?.classList.remove('active');
});

// ── 1. Dashboard View ──────────────────────────────────────────
function renderDashboard() {
  const httpRouters = allRouters.filter(r => r.proto === 'http').length;
  const tcpRouters = allRouters.filter(r => r.proto === 'tcp').length;
  const httpServices = allServices.filter(s => s.proto === 'http').length;
  const tcpServices = allServices.filter(s => s.proto === 'tcp').length;

  let liveCardHtml = '';
  if (liveStatusCache?.overview) {
    const ov = liveStatusCache.overview;
    liveCardHtml = `
      <div class="pipeline-card" style="margin-bottom: 20px; border-left: 3px solid var(--green);">
        <div class="pipeline-header">
          <div class="pipeline-title">
            <span class="badge badge-green">LIVE TRAEFIK INSTANCE</span>
            <span style="font-weight:600; font-size:14px;">Runtime Health & Diagnostics</span>
          </div>
          <span class="stat-subtext">Traefik API :8080 Active</span>
        </div>
        <div style="display:flex; gap:20px; flex-wrap:wrap; font-size:13px; color:var(--text-muted); margin-top:8px;">
          <div>HTTP Routers: <strong style="color:var(--text-main);">${ov.http?.routers?.total || 0}</strong></div>
          <div>Warnings: <strong style="color:${ov.http?.routers?.warnings ? 'var(--amber)' : 'var(--text-main)'};">${ov.http?.routers?.warnings || 0}</strong></div>
          <div>Errors: <strong style="color:${ov.http?.routers?.errors ? 'var(--red)' : 'var(--text-main)'};">${ov.http?.routers?.errors || 0}</strong></div>
          <div>Active Certificates: <strong style="color:var(--text-main);">${ov.certificates?.total || 0}</strong></div>
          <div>Providers: <strong style="color:var(--text-main);">${(ov.providers || []).join(', ')}</strong></div>
        </div>
      </div>`;
  }

  const el = $('#view-dashboard');
  el.innerHTML = `
    ${liveCardHtml}

    <div class="stat-grid">
      <div class="stat-card" onclick="setView('routers')" style="cursor:pointer">
        <div class="stat-card-top">
          <span class="stat-label">HTTP Routers</span>
          <span class="badge badge-cyan">HTTP</span>
        </div>
        <div class="stat-value">${httpRouters}</div>
        <div class="stat-subtext">${tcpRouters} TCP routers active</div>
      </div>

      <div class="stat-card" onclick="setView('services')" style="cursor:pointer">
        <div class="stat-card-top">
          <span class="stat-label">Services</span>
          <span class="badge badge-purple">SVC</span>
        </div>
        <div class="stat-value">${allServices.length}</div>
        <div class="stat-subtext">${httpServices} HTTP · ${tcpServices} TCP</div>
      </div>

      <div class="stat-card" onclick="setView('middlewares')" style="cursor:pointer">
        <div class="stat-card-top">
          <span class="stat-label">Middlewares</span>
          <span class="badge badge-green">MW</span>
        </div>
        <div class="stat-value">${allMiddlewares.length}</div>
        <div class="stat-subtext">Auth, redirects, headers</div>
      </div>

      <div class="stat-card" onclick="setView('transports')" style="cursor:pointer">
        <div class="stat-card-top">
          <span class="stat-label">Servers Transports</span>
          <span class="badge badge-blue">TLS/TCP</span>
        </div>
        <div class="stat-value">${allTransports.length}</div>
        <div class="stat-subtext">Skip verify & custom CAs</div>
      </div>

      <div class="stat-card" onclick="setView('files')" style="cursor:pointer">
        <div class="stat-card-top">
          <span class="stat-label">Config Files</span>
          <span class="badge badge-amber">YAML</span>
        </div>
        <div class="stat-value">${filesCache.length}</div>
        <div class="stat-subtext">Watched by Traefik</div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-toolbar">
        <div style="font-weight:600; font-size:14px;">Recent Routing Pipeline Overview</div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="setView('topology')">View Pipeline</button>
          <button class="btn btn-primary btn-sm" onclick="openRouterDrawer()">+ New Route</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Route Name</th>
            <th>Protocol</th>
            <th>Rule</th>
            <th>Service Target</th>
            <th>Middlewares</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          ${allRouters.slice(0, 8).map(r => {
            const mw = r.config.middlewares ? r.config.middlewares.map(m => `<span class="badge badge-green">${esc(m)}</span>`).join(' ') : '—';
            return `
              <tr>
                <td class="cell-name">${esc(r.name)}</td>
                <td><span class="badge ${r.proto === 'http' ? 'badge-cyan' : 'badge-blue'}">${r.proto.toUpperCase()}</span></td>
                <td class="cell-mono">${esc(r.config.rule || '—')}</td>
                <td><span class="badge badge-purple">${esc(r.config.service || '—')}</span></td>
                <td>${mw}</td>
                <td><span class="badge badge-gray">${esc(r.file)}</span></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── 2. Route Topology / Pipeline View ──────────────────────────
function renderTopology() {
  const filtered = allRouters.filter(r => {
    if (filterProto !== 'all' && r.proto !== filterProto) return false;
    if (filterFile !== 'all' && r.file !== filterFile) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      return r.name.toLowerCase().includes(q) ||
        (r.config.rule || '').toLowerCase().includes(q) ||
        (r.config.service || '').toLowerCase().includes(q);
    }
    return true;
  });

  const el = $('#view-topology');
  el.innerHTML = `
    <div class="table-wrap" style="margin-bottom:16px;">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <div class="filter-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="filter-input" placeholder="Filter pipeline routes..." value="${esc(filterSearch)}" oninput="filterSearch=this.value; renderTopology()">
          </div>
          <select class="filter-select" onchange="filterProto=this.value; renderTopology()">
            <option value="all" ${filterProto==='all'?'selected':''}>All Protocols</option>
            <option value="http" ${filterProto==='http'?'selected':''}>HTTP Only</option>
            <option value="tcp" ${filterProto==='tcp'?'selected':''}>TCP Only</option>
          </select>
          <select class="filter-select" onchange="filterFile=this.value; renderTopology()">
            <option value="all">All Config Files</option>
            ${filesCache.map(f => `<option value="${f.name}" ${f.name===filterFile?'selected':''}>${f.name}</option>`).join('')}
          </select>
        </div>
        <div style="font-size:12px; color:var(--text-muted);">${filtered.length} routes in pipeline</div>
      </div>
    </div>

    <div class="topology-list">
      ${filtered.length === 0 ? '<div class="stat-subtext" style="padding:20px; text-align:center;">No routes match filter</div>' : ''}
      ${filtered.map(r => {
        const epList = r.config.entryPoints || ['websecure'];
        const svc = allServices.find(s => s.name === r.config.service && s.file === r.file) ||
                    allServices.find(s => s.name === r.config.service);
        let targetUrls = [];
        if (svc?.config?.loadBalancer?.servers) {
          targetUrls = svc.config.loadBalancer.servers.map(s => s.url || s.address);
        }

        const tlsInfo = r.config.tls ? (r.config.tls.certResolver ? `TLS: ${r.config.tls.certResolver}` : 'TLS Enabled') : null;

        return `
          <div class="pipeline-card">
            <div class="pipeline-header">
              <div class="pipeline-title">
                <span class="badge ${r.proto==='http'?'badge-cyan':'badge-blue'}">${r.proto.toUpperCase()}</span>
                <span class="pipeline-name">${esc(r.name)}</span>
                <span class="badge badge-gray">${esc(r.file)}</span>
                ${tlsInfo ? `<span class="badge badge-green">${esc(tlsInfo)}</span>` : ''}
              </div>
              <div class="cell-actions">
                <button class="btn-icon" title="Edit Route" onclick="openRouterDrawer('${esc(r.file)}','${esc(r.name)}','${r.proto}')">✎</button>
              </div>
            </div>

            <div class="pipeline-flow">
              <!-- EntryPoints -->
              ${epList.map(ep => `<div class="flow-node entrypoint"><span>⚡ ${esc(ep)}</span></div>`).join('')}
              <span class="flow-arrow">➔</span>

              <!-- Rule -->
              <div class="flow-node rule" title="Match Rule"><span>🎯 ${esc(r.config.rule || '—')}</span></div>
              <span class="flow-arrow">➔</span>

              <!-- Middlewares -->
              ${(r.config.middlewares || []).length > 0
                ? r.config.middlewares.map(m => `<div class="flow-node middleware"><span>⤿ ${esc(m)}</span></div>`).join('<span class="flow-arrow">+</span>') + '<span class="flow-arrow">➔</span>'
                : ''}

              <!-- Service -->
              <div class="flow-node service"><span>⚙ ${esc(r.config.service || '—')}</span></div>
              <span class="flow-arrow">➔</span>

              <!-- Backend Servers -->
              ${targetUrls.length > 0
                ? targetUrls.map(u => `<div class="flow-node target"><span>🖥 ${esc(u)}</span></div>`).join(' ')
                : `<div class="flow-node target" style="color:var(--text-faint)"><span>(Dynamic Target)</span></div>`}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── 3. Routers View ────────────────────────────────────────────
function renderRouters() {
  const filtered = allRouters.filter(r => {
    if (filterProto !== 'all' && r.proto !== filterProto) return false;
    if (filterFile !== 'all' && r.file !== filterFile) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      return r.name.toLowerCase().includes(q) ||
        (r.config.rule || '').toLowerCase().includes(q) ||
        (r.config.service || '').toLowerCase().includes(q);
    }
    return true;
  });

  const el = $('#view-routers');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <div class="filter-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="filter-input" placeholder="Search routers..." value="${esc(filterSearch)}" oninput="filterSearch=this.value; renderRouters()">
          </div>
          <select class="filter-select" onchange="filterProto=this.value; renderRouters()">
            <option value="all" ${filterProto==='all'?'selected':''}>All Protocols</option>
            <option value="http" ${filterProto==='http'?'selected':''}>HTTP</option>
            <option value="tcp" ${filterProto==='tcp'?'selected':''}>TCP</option>
          </select>
          <select class="filter-select" onchange="filterFile=this.value; renderRouters()">
            <option value="all">All Files</option>
            ${filesCache.map(f => `<option value="${f.name}" ${f.name===filterFile?'selected':''}>${f.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:12px; color:var(--text-muted);">${filtered.length} router${filtered.length!==1?'s':''}</span>
          <button class="btn btn-primary btn-sm" onclick="openRouterDrawer()">+ New Router</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Proto</th>
            <th>Rule</th>
            <th>Service</th>
            <th>EntryPoints</th>
            <th>Middlewares</th>
            <th>TLS</th>
            <th>File</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => {
            const ep = (r.config.entryPoints || []).map(e => `<span class="badge badge-cyan">${esc(e)}</span>`).join(' ') || '—';
            const mw = (r.config.middlewares || []).map(m => `<span class="badge badge-green">${esc(m)}</span>`).join(' ') || '—';
            const tls = r.config.tls ? `<span class="badge badge-purple">${esc(r.config.tls.certResolver || 'TLS')}</span>` : '<span style="color:var(--text-faint)">—</span>';
            return `
              <tr>
                <td class="cell-name">${esc(r.name)}</td>
                <td><span class="badge ${r.proto==='http'?'badge-cyan':'badge-blue'}">${r.proto.toUpperCase()}</span></td>
                <td class="cell-mono">${esc(r.config.rule || '—')}</td>
                <td><span class="badge badge-purple">${esc(r.config.service || '—')}</span></td>
                <td>${ep}</td>
                <td>${mw}</td>
                <td>${tls}</td>
                <td><span class="badge badge-gray">${esc(r.file)}</span></td>
                <td class="cell-actions">
                  <button class="btn-icon" title="Edit Router" onclick="openRouterDrawer('${esc(r.file)}','${esc(r.name)}','${r.proto}')">✎</button>
                  <button class="btn-icon danger" title="Delete Router" onclick="confirmDelete('router','${esc(r.file)}','${esc(r.name)}','${r.proto}')">✕</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── 4. Services View ───────────────────────────────────────────
function renderServices() {
  const filtered = allServices.filter(s => {
    if (filterProto !== 'all' && s.proto !== filterProto) return false;
    if (filterFile !== 'all' && s.file !== filterFile) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      return s.name.toLowerCase().includes(q);
    }
    return true;
  });

  const el = $('#view-services');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <div class="filter-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="filter-input" placeholder="Search services..." value="${esc(filterSearch)}" oninput="filterSearch=this.value; renderServices()">
          </div>
          <select class="filter-select" onchange="filterProto=this.value; renderServices()">
            <option value="all" ${filterProto==='all'?'selected':''}>All Protocols</option>
            <option value="http" ${filterProto==='http'?'selected':''}>HTTP</option>
            <option value="tcp" ${filterProto==='tcp'?'selected':''}>TCP</option>
          </select>
          <select class="filter-select" onchange="filterFile=this.value; renderServices()">
            <option value="all">All Files</option>
            ${filesCache.map(f => `<option value="${f.name}" ${f.name===filterFile?'selected':''}>${f.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:12px; color:var(--text-muted);">${filtered.length} service${filtered.length!==1?'s':''}</span>
          <button class="btn btn-primary btn-sm" onclick="openServiceDrawer()">+ New Service</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Proto</th>
            <th>Server URLs / Targets</th>
            <th>Transport</th>
            <th>File</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(s => {
            const lb = s.config.loadBalancer || {};
            let urls = '—';
            if (lb.servers) {
              urls = lb.servers.map(sv => sv.url || sv.address || '?').join(', ');
            }
            const st = lb.serversTransport ? `<span class="badge badge-blue">${esc(lb.serversTransport)}</span>` : '<span style="color:var(--text-faint)">Default</span>';
            return `
              <tr>
                <td class="cell-name">${esc(s.name)}</td>
                <td><span class="badge ${s.proto==='http'?'badge-purple':'badge-blue'}">${s.proto.toUpperCase()}</span></td>
                <td class="cell-mono">${esc(urls)}</td>
                <td>${st}</td>
                <td><span class="badge badge-gray">${esc(s.file)}</span></td>
                <td class="cell-actions">
                  <button class="btn-icon" title="Edit Service" onclick="openServiceDrawer('${esc(s.file)}','${esc(s.name)}','${s.proto}')">✎</button>
                  <button class="btn-icon danger" title="Delete Service" onclick="confirmDelete('service','${esc(s.file)}','${esc(s.name)}','${s.proto}')">✕</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── 5. Middlewares View ────────────────────────────────────────
function renderMiddlewares() {
  const filtered = allMiddlewares.filter(m => {
    if (filterFile !== 'all' && m.file !== filterFile) return false;
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      return m.name.toLowerCase().includes(q);
    }
    return true;
  });

  const el = $('#view-middlewares');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <div class="filter-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="filter-input" placeholder="Search middlewares..." value="${esc(filterSearch)}" oninput="filterSearch=this.value; renderMiddlewares()">
          </div>
          <select class="filter-select" onchange="filterFile=this.value; renderMiddlewares()">
            <option value="all">All Files</option>
            ${filesCache.map(f => `<option value="${f.name}" ${f.name===filterFile?'selected':''}>${f.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:12px; color:var(--text-muted);">${filtered.length} middleware${filtered.length!==1?'s':''}</span>
          <button class="btn btn-primary btn-sm" onclick="openMiddlewareDrawer()">+ New Middleware</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Proto</th>
            <th>Type</th>
            <th>Summary / Details</th>
            <th>File</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(m => {
            const mwType = Object.keys(m.config)[0] || 'unknown';
            let summary = JSON.stringify(m.config[mwType] || {});
            if (summary.length > 50) summary = summary.substring(0, 50) + '...';
            return `
              <tr>
                <td class="cell-name">${esc(m.name)}</td>
                <td><span class="badge ${m.proto==='http'?'badge-green':'badge-blue'}">${m.proto.toUpperCase()}</span></td>
                <td><span class="badge badge-green">${esc(mwType)}</span></td>
                <td class="cell-mono" style="font-size:11px; color:var(--text-muted);">${esc(summary)}</td>
                <td><span class="badge badge-gray">${esc(m.file)}</span></td>
                <td class="cell-actions">
                  <button class="btn-icon" title="Edit Middleware" onclick="openMiddlewareDrawer('${esc(m.file)}','${esc(m.name)}','${m.proto}')">✎</button>
                  <button class="btn-icon danger" title="Delete Middleware" onclick="confirmDelete('middleware','${esc(m.file)}','${esc(m.name)}','${m.proto}')">✕</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── 6. ServersTransports View ──────────────────────────────────
function renderTransports() {
  const filtered = allTransports.filter(t => {
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      return t.name.toLowerCase().includes(q);
    }
    return true;
  });

  const el = $('#view-transports');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <div class="filter-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="filter-input" placeholder="Search transports..." value="${esc(filterSearch)}" oninput="filterSearch=this.value; renderTransports()">
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:12px; color:var(--text-muted);">${filtered.length} transport${filtered.length!==1?'s':''}</span>
          <button class="btn btn-primary btn-sm" onclick="openTransportDrawer()">+ New Transport</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Proto</th>
            <th>Insecure Skip Verify</th>
            <th>Server Name</th>
            <th>File</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(t => {
            const skip = t.config.insecureSkipVerify ? '<span class="badge badge-amber">insecureSkipVerify: true</span>' : '<span class="badge badge-gray">false</span>';
            const sn = t.config.serverName ? esc(t.config.serverName) : '—';
            return `
              <tr>
                <td class="cell-name">${esc(t.name)}</td>
                <td><span class="badge badge-blue">${t.proto.toUpperCase()}</span></td>
                <td>${skip}</td>
                <td class="cell-mono">${sn}</td>
                <td><span class="badge badge-gray">${esc(t.file)}</span></td>
                <td class="cell-actions">
                  <button class="btn-icon" title="Edit Transport" onclick="openTransportDrawer('${esc(t.file)}','${esc(t.name)}','${t.proto}')">✎</button>
                  <button class="btn-icon danger" title="Delete Transport" onclick="confirmDelete('serversTransport','${esc(t.file)}','${esc(t.name)}','${t.proto}')">✕</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── 7. Config Files View & In-Browser YAML Editor ──────────────
function renderFiles() {
  const el = $('#view-files');
  el.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <span style="font-size:13px; color:var(--text-muted);">Dynamic YAML files in <code style="color:var(--cyan)">${esc(capabilitiesCache.configDir||'/config')}</code></span>
      <button class="btn btn-primary btn-sm" onclick="openNewFileModal()">+ New File</button>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px;">
      ${filesCache.map(f => `
        <div class="stat-card" style="cursor:pointer;" onclick="openYamlEditor('${esc(f.name)}')">
          <div class="stat-card-top">
            <span style="font-weight:600; font-size:14px; color:var(--text-main); font-family:var(--font-mono);">▤ ${esc(f.name)}</span>
            <span class="badge badge-amber">EDIT YAML</span>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; font-size:11px;">
            <span class="badge badge-cyan">${f.httpRouters + f.tcpRouters} routers</span>
            <span class="badge badge-purple">${f.httpServices + f.tcpServices} services</span>
            <span class="badge badge-green">${f.httpMiddlewares} middlewares</span>
            ${f.httpServersTransports ? `<span class="badge badge-blue">${f.httpServersTransports} transports</span>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

async function openYamlEditor(filename) {
  try {
    const raw = await api(`/api/files/${encodeURIComponent(filename)}/raw`);
    const lineCount = (raw.match(/\n/g) || []).length + 1;
    const bodyHtml = `
      <div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:12px; color:var(--text-muted); font-family:var(--font-mono);">${filename} (${lineCount} lines)</span>
        <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText($('#yaml-editor-ta').value); toast('YAML copied');">Copy</button>
      </div>
      <div style="position:relative;">
        <textarea id="yaml-editor-ta" class="form-textarea" style="height:480px;">${esc(raw)}</textarea>
      </div>`;

    const footerHtml = `
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="saveRawYamlFile('${esc(filename)}')">Save Changes</button>`;

    openModal(`YAML Editor: ${filename}`, bodyHtml, footerHtml, true);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function saveRawYamlFile(filename) {
  const content = $('#yaml-editor-ta').value;
  try {
    await api(`/api/files/${encodeURIComponent(filename)}/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/yaml' },
      body: content,
    });
    closeModal();
    toast(`Saved ${filename}`);
    renderCurrentView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openNewFileModal() {
  const bodyHtml = `
    <div class="form-group">
      <label>Filename <span class="req">*</span></label>
      <input class="form-input" id="new-filename" placeholder="services.yml">
      <div class="form-hint">Must end in .yml or .yaml</div>
    </div>`;
  const footerHtml = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="createNewFile()">Create File</button>`;
  openModal('New Config File', bodyHtml, footerHtml);
}

async function createNewFile() {
  const name = $('#new-filename').value.trim();
  if (!name) return toast('Filename required', 'error');
  try {
    await api('/api/files', { method: 'POST', body: { filename: name } });
    closeModal();
    toast(`Created ${name}`);
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── 8. Backups View with Unified Diff ──────────────────────────
async function renderBackups() {
  const backups = await api('/api/backups').catch(() => []);
  const el = $('#view-backups');

  if (!backups.length) {
    el.innerHTML = '<div class="stat-subtext" style="padding:40px; text-align:center;">No backups created yet. Timestamped backups are created automatically before every modification.</div>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <span style="font-size:13px; font-weight:600;">Automatic Timestamped Backups (${backups.length})</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Backup File</th>
            <th>Original Target</th>
            <th>Size</th>
            <th>Created</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${backups.map(b => `
            <tr>
              <td class="cell-mono" style="font-size:12px; font-weight:600;">${esc(b.name)}</td>
              <td><span class="badge badge-amber">${esc(b.originalFile || '—')}</span></td>
              <td style="color:var(--text-muted); font-size:12px;">${(b.size/1024).toFixed(1)} KB</td>
              <td style="color:var(--text-muted); font-size:12px;">${new Date(b.created).toLocaleString()}</td>
              <td class="cell-actions">
                <button class="btn btn-secondary btn-sm" onclick="previewBackupDiff('${esc(b.name)}')">Compare Diff</button>
                <button class="btn btn-primary btn-sm" onclick="restoreBackup('${esc(b.name)}')">Restore</button>
                <button class="btn-icon danger" title="Delete Backup" onclick="deleteBackup('${esc(b.name)}')">✕</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function previewBackupDiff(backupName) {
  try {
    const diffData = await api(`/api/backups/${encodeURIComponent(backupName)}/diff`);
    const lines = diffData.diff || [];

    const rowsHtml = lines.map(line => {
      let cls = 'normal';
      let symbol = ' ';
      if (line.type === 'add') { cls = 'add'; symbol = '+'; }
      else if (line.type === 'del') { cls = 'del'; symbol = '-'; }
      return `
        <tr class="diff-row ${cls}">
          <td class="diff-line-num">${line.oldLine || ''}</td>
          <td class="diff-line-num">${line.newLine || ''}</td>
          <td class="diff-text">${symbol} ${esc(line.text)}</td>
        </tr>`;
    }).join('');

    const diffHtml = `
      <div style="font-size:12px; margin-bottom:12px; color:var(--text-muted);">
        Comparing <code style="color:var(--amber);">${esc(backupName)}</code> with active file <code style="color:var(--cyan);">${esc(diffData.originalFile)}</code>
      </div>
      <table class="diff-table">${rowsHtml}</table>`;

    const footerHtml = `
      <button class="btn btn-secondary" onclick="closeDiffModal()">Close</button>
      <button class="btn btn-primary" onclick="closeDiffModal(); restoreBackup('${esc(backupName)}')">Restore This Backup</button>`;

    openDiffModal('Backup Comparison (Unified Diff)', backupName, diffHtml, footerHtml);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function restoreBackup(name) {
  if (!confirm(`Restore backup "${name}"? A backup of the current file will be created first.`)) return;
  try {
    await api(`/api/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' });
    toast('Backup restored successfully');
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteBackup(name) {
  if (!confirm(`Delete backup "${name}"?`)) return;
  try {
    await api(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
    toast('Backup deleted');
    renderBackups();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── 9. Observability: Live Access Logs ──────────────────────────
async function renderLogs() {
  const el = $('#view-logs');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-filters">
          <div class="filter-input-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="filter-input" id="log-search-q" placeholder="Filter logs (IP, path, router)..." onkeyup="if(event.key==='Enter') loadLogEntries()">
          </div>
          <select class="filter-select" id="log-status-select" onchange="loadLogEntries()">
            <option value="">All Status Codes</option>
            <option value="2">2xx Success</option>
            <option value="3">3xx Redirect</option>
            <option value="4">4xx Client Error</option>
            <option value="5">5xx Server Error</option>
          </select>
          <button class="btn btn-secondary btn-sm" onclick="loadLogEntries()">Search</button>
        </div>
        <div style="font-size:12px; color:var(--text-muted);" id="log-stats-label">Loading logs...</div>
      </div>
      <div id="log-container" class="log-container">
      </div>
    </div>`;

  loadLogEntries();
}

async function loadLogEntries() {
  const q = $('#log-search-q')?.value || '';
  const st = $('#log-status-select')?.value || '';
  const container = $('#log-container');
  if (!container) return;

  try {
    const data = await api(`/api/traefik/logs?q=${encodeURIComponent(q)}&status=${encodeURIComponent(st)}&limit=150`);
    if (!data.available) {
      container.innerHTML = `<div style="color:var(--text-faint); padding:20px; text-align:center;">Access log file not detected at <code>${esc(data.path || '/etc/traefik/logs/access.log')}</code>. Mount <code>/etc/traefik</code> into Docker container to activate.</div>`;
      $('#log-stats-label').textContent = 'Not Mounted';
      return;
    }

    $('#log-stats-label').textContent = `${data.logs.length} entries shown`;

    container.innerHTML = data.logs.map(l => {
      if (!l.status) return `<div style="color:var(--text-faint);">${esc(l.raw)}</div>`;
      let statusClass = 'badge-green';
      if (l.status >= 500) statusClass = 'badge-red';
      else if (l.status >= 400) statusClass = 'badge-amber';
      else if (l.status >= 300) statusClass = 'badge-blue';

      return `
        <div class="log-entry">
          <span class="log-time">${esc(l.time?.split(' ')[0] || '')}</span>
          <span class="badge ${statusClass}">${l.status}</span>
          <span class="log-method">${esc(l.method)}</span>
          <span class="log-path">${esc(l.path)}</span>
          <span class="badge badge-purple">${esc(l.router || '—')}</span>
          <span class="log-dur">${esc(l.duration)}</span>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:var(--red);">Failed to read logs: ${esc(e.message)}</div>`;
  }
}

// ── 10. Observability: Certificates Inspector ─────────────────
async function renderCertificates() {
  const el = $('#view-certificates');
  try {
    const data = await api('/api/traefik/certificates');
    if (!data.available || !data.certificates.length) {
      el.innerHTML = `
        <div class="table-wrap" style="padding:30px; text-align:center;">
          <div style="font-weight:600; font-size:15px; margin-bottom:8px;">No ACME Certificate Store Loaded</div>
          <div class="stat-subtext">Certificate file not detected at <code>${esc(data.path || '/etc/traefik/certs/cloudflare-acme.json')}</code>. Mount <code>/etc/traefik</code> into Docker container to inspect ACME certificates.</div>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <div class="table-toolbar">
          <span style="font-weight:600; font-size:14px;">Active SSL / TLS Certificates (${data.certificates.length})</span>
          <span class="stat-subtext">ACME Cloudflare / Let's Encrypt</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Main Domain</th>
              <th>Resolver</th>
              <th>Subject Alternative Names (SANs)</th>
            </tr>
          </thead>
          <tbody>
            ${data.certificates.map(c => `
              <tr>
                <td class="cell-name" style="color:var(--cyan); font-family:var(--font-mono);">${esc(c.main)}</td>
                <td><span class="badge badge-green">${esc(c.resolver)}</span></td>
                <td>${(c.sans || []).map(s => `<span class="badge badge-purple">${esc(s)}</span>`).join(' ') || '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);">Error loading certificates: ${esc(e.message)}</div>`;
  }
}

// ── 11. Observability: Traefik Static Config ───────────────────
async function renderStatic() {
  const el = $('#view-static');
  try {
    const data = await api('/api/traefik/static');
    if (!data.available) {
      el.innerHTML = `
        <div class="table-wrap" style="padding:30px; text-align:center;">
          <div style="font-weight:600; font-size:15px; margin-bottom:8px;">Static Configuration Not Mounted</div>
          <div class="stat-subtext">Static <code>traefik.yml</code> not found at <code>${esc(data.path || '/etc/traefik/traefik.yml')}</code>.</div>
        </div>`;
      return;
    }

    const p = data.parsed || {};
    const eps = p.entryPoints ? Object.entries(p.entryPoints) : [];
    const certResolvers = p.certificatesResolvers ? Object.entries(p.certificatesResolvers) : [];

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <span class="stat-label">EntryPoints</span>
          <div class="stat-value">${eps.length}</div>
          <div class="stat-subtext">${eps.map(([k]) => k).join(', ')}</div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Cert Resolvers</span>
          <div class="stat-value">${certResolvers.length}</div>
          <div class="stat-subtext">${certResolvers.map(([k]) => k).join(', ')}</div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Access Log</span>
          <div class="stat-value" style="font-size:16px; color:var(--cyan);">${p.accessLog ? 'Enabled' : 'Disabled'}</div>
          <div class="stat-subtext">${esc(p.accessLog?.filePath || 'stdout')}</div>
        </div>
      </div>

      <div class="table-wrap" style="margin-top:16px;">
        <div class="table-toolbar">
          <span style="font-weight:600; font-size:14px;">Raw Static traefik.yml (Read-Only)</span>
          <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText($('#static-raw-code').textContent); toast('Copied');">Copy</button>
        </div>
        <div class="code-preview-wrap">
          <pre><code id="static-raw-code">${esc(data.raw)}</code></pre>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div style="color:var(--red);">Error loading static config: ${esc(e.message)}</div>`;
  }
}

// ── 12. Smart Forms in Slide-Over Drawer ───────────────────────

let drawerServiceMode = 'create';
let newServiceNameCustomized = false;
let newMwNameCustomized = false;

// ROUTER / UNIFIED ROUTE & SERVICE DRAWER
function openRouterDrawer(file, name, proto = 'http', unifiedMode = true) {
  drawerCurrentMode = 'router';
  const editing = !!name;
  const router = editing ? allRouters.find(r => r.name === name && r.file === file) : null;
  const cfg = router?.config || {};
  drawerEditingItem = { file, name, proto, config: cfg };

  newServiceNameCustomized = false;
  newMwNameCustomized = false;
  drawerServiceMode = (!editing && unifiedMode) ? 'create' : 'select';

  const activeEps = new Set(cfg.entryPoints || (editing ? [] : ['websecure']));
  const activeMws = new Set(cfg.middlewares || []);

  const formHtml = `
    <div class="form-row" style="margin-bottom:14px;">
      <div class="form-group">
        <label>Protocol</label>
        <select class="form-select" id="rf-proto" onchange="onDrawerProtoChange()" ${editing?'disabled':''}>
          <option value="http" ${proto==='http'?'selected':''}>HTTP</option>
          <option value="tcp" ${proto==='tcp'?'selected':''}>TCP</option>
        </select>
      </div>
      <div class="form-group">
        <label>Config File <span class="req">*</span></label>
        <select class="form-select" id="rf-file" onchange="updateDrawerYamlPreview()">
          ${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- Section 1: Route Definition -->
    <div class="card-section" style="margin-bottom:16px;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--cyan); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
        <span>1. Route Definition</span>
      </div>

      <div class="form-group">
        <label>Router Name <span class="req">*</span></label>
        <input class="form-input" id="rf-name" value="${esc(name||'')}" ${editing?'readonly':''} placeholder="e.g. my-app" oninput="onRouterNameInput()">
      </div>

      <div class="form-group">
        <label>Routing Rule <span class="req">*</span></label>
        <input class="form-input" id="rf-rule" value="${esc(cfg.rule||'')}" placeholder="${proto==='tcp'?'HostSNI(`app.example.com`)':'Host(`app.example.com`)'}" oninput="updateDrawerYamlPreview()">
        <div id="rf-rule-presets" style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
          ${proto === 'tcp' ? `
            <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('host')">+ HostSNI Preset</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('catchall')">+ Catch-All (*)</button>
          ` : `
            <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('host')">+ Host Preset</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('path')">+ PathPrefix</button>
          `}
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Priority</label>
          <input class="form-input" id="rf-priority" type="number" value="${cfg.priority||''}" placeholder="e.g. 100" oninput="updateDrawerYamlPreview()">
        </div>
        <div class="form-group">
          <label>TLS & Resolver</label>
          <select class="form-select" id="rf-tls-enable" onchange="onDrawerTlsChange()">
            <option value="none" ${!cfg.tls?'selected':''}>Disabled</option>
            <option value="enabled" ${cfg.tls?'selected':''}>Enabled (Standard)</option>
          </select>
        </div>
      </div>

      <div class="form-group" id="rf-tls-resolver-wrap" style="display:${cfg.tls?'block':'none'};">
        <label>Certificate Resolver</label>
        <input class="form-input" id="rf-tls-resolver" value="${esc(cfg.tls?.certResolver||'cloudflare')}" placeholder="e.g. cloudflare" oninput="updateDrawerYamlPreview()">
      </div>

      <!-- EntryPoints Multi-Select -->
      <div class="form-group" style="margin-bottom:0;">
        <label>EntryPoints</label>
        <div class="chips-container" id="rf-eps-chips">
          ${entrypointsCache.map(ep => `
            <div class="chip ${activeEps.has(ep)?'active':''}" onclick="toggleChip(this); updateDrawerYamlPreview()" data-val="${esc(ep)}">
              ${esc(ep)}
            </div>`).join('')}
        </div>
        <div class="form-hint">Click entrypoints to toggle</div>
      </div>
    </div>

    <!-- Section 2: Target Backend Service -->
    <div class="card-section" style="margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--purple);">
          2. Target Backend Service
        </div>
        ${!editing ? `
        <div class="toggle-group" id="rf-service-toggle-group">
          <button type="button" class="toggle-btn ${drawerServiceMode==='create'?'active':''}" id="rf-btn-svc-create" onclick="setDrawerServiceMode('create')">✨ Create New Service</button>
          <button type="button" class="toggle-btn ${drawerServiceMode==='select'?'active':''}" id="rf-btn-svc-select" onclick="setDrawerServiceMode('select')">🔗 Select Existing</button>
        </div>` : ''}
      </div>

      <!-- Mode A: Create New Service Inline -->
      <div id="rf-new-service-container" style="display:${drawerServiceMode==='create'?'block':'none'};">
        <div class="form-group">
          <label>Service Name <span class="req">*</span></label>
          <input class="form-input" id="rf-new-service-name" placeholder="e.g. my-app" oninput="onNewServiceNameInput()">
          <div class="form-hint">Auto-synchronized with router name</div>
        </div>

        <div class="form-group">
          <label>Backend Target URLs (One per line) <span class="req">*</span></label>
          <textarea class="form-textarea" id="rf-new-service-urls" rows="2" placeholder="${proto==='tcp'?'192.168.1.50:8080':'http://192.168.1.50:8080'}" oninput="updateDrawerYamlPreview()"></textarea>
          <div class="form-hint">HTTP: http://host:port · TCP: host:port</div>
        </div>

        <div class="form-row">
          <div class="form-group" id="rf-new-service-phh-wrap" style="display:${proto==='tcp'?'none':'block'};">
            <label>Pass Host Header</label>
            <select class="form-select" id="rf-new-service-phh" onchange="updateDrawerYamlPreview()">
              <option value="">Default (true)</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
          <div class="form-group">
            <label>Servers Transport</label>
            <select class="form-select" id="rf-new-service-st" onchange="onTransportSelectChange(this.value, 'rf-new-service-st-custom-wrap')">
              <option value="">None (Default Transport)</option>
              ${allTransports.map(t => `<option value="${esc(t.name)}">${esc(t.name)} (${esc(t.file)})</option>`).join('')}
              <option value="__custom__">+ Custom Transport Name...</option>
            </select>
            <div id="rf-new-service-st-custom-wrap" style="display:none; margin-top:6px;">
              <input class="form-input" id="rf-new-service-st-custom" placeholder="e.g. skip-certificate-check" oninput="updateDrawerYamlPreview()">
            </div>
          </div>
        </div>
      </div>

      <!-- Mode B: Select Existing Service -->
      <div id="rf-existing-service-container" style="display:${drawerServiceMode==='select'?'block':'none'};">
        <div class="form-group" style="margin-bottom:0;">
          <label>Existing Service <span class="req">*</span></label>
          <select class="form-select" id="rf-service" onchange="onExistingServiceChange(this.value)">
            <option value="">-- Choose an existing service --</option>
            ${allServices.map(s => `<option value="${esc(s.name)}" ${s.name===(cfg.service||'')?'selected':''}>${esc(s.name)} (${esc(s.file)})</option>`).join('')}
            <option value="__custom__" ${cfg.service && !allServices.some(s => s.name === cfg.service)?'selected':''}>+ Custom / External Service Name...</option>
          </select>
          <div id="rf-service-custom-wrap" style="display:${cfg.service && !allServices.some(s => s.name === cfg.service)?'block':'none'}; margin-top:8px;">
            <input class="form-input" id="rf-service-custom" value="${esc((cfg.service && !allServices.some(s => s.name === cfg.service))?cfg.service:'')}" placeholder="Enter service name..." oninput="updateDrawerYamlPreview()">
          </div>
        </div>
      </div>
    </div>

    <!-- Section 3: Middlewares Pipeline -->
    <div class="card-section" style="margin-bottom:16px;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--emerald); margin-bottom:12px;">
        3. Middlewares Pipeline
      </div>

      <div class="form-group">
        <label>Attach Existing Middlewares</label>
        <div class="chips-container" id="rf-mws-chips">
          ${allMiddlewares.map(m => `
            <div class="chip ${activeMws.has(m.name)?'active':''}" onclick="toggleChip(this); updateDrawerYamlPreview()" data-val="${esc(m.name)}">
              ${esc(m.name)}
            </div>`).join('')}
        </div>
        <div class="form-hint">Click existing middlewares to attach to this route</div>
      </div>

      ${!editing ? `
      <!-- Collapsible Inline Middleware Accordion -->
      <div style="margin-top:12px;">
        <div class="accordion-toggle" onclick="toggleDrawerAccordion('rf-mw-accordion-body', 'rf-mw-accordion-icon')">
          <span style="display:flex; align-items:center; gap:8px;">
            <span>⚡</span>
            <span>Create & Attach New Middleware (Optional)</span>
          </span>
          <span id="rf-mw-accordion-icon" style="transition:transform 0.2s;">▼</span>
        </div>
        <div id="rf-mw-accordion-body" style="display:none; padding:12px; background:rgba(128,128,128,0.05); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); margin-top:6px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:12px;">
            <input type="checkbox" id="rf-enable-inline-mw" onchange="onToggleInlineMw(this.checked)">
            <span style="font-size:12px; font-weight:600; color:var(--text-main);">Create and attach new middleware to this route</span>
          </label>
          <div id="rf-inline-mw-fields" style="opacity:0.4; pointer-events:none; transition:opacity 0.2s;">
            <div class="form-group">
              <label>Middleware Name <span class="req">*</span></label>
              <input class="form-input" id="rf-new-mw-name" placeholder="e.g. my-app-auth" oninput="onNewMwNameInput()">
            </div>
            <div class="form-group">
              <label>Preset</label>
              <select class="form-select" id="rf-new-mw-preset" onchange="applyInlineMwPreset(this.value)">
                <option value="authentik">Authentik / Authelia (ForwardAuth)</option>
                <option value="redirectRegex">Redirect Regex (URL Rewriting)</option>
                <option value="headers">Security Headers (HSTS, SSL)</option>
                <option value="stripPrefix">Strip Prefix</option>
                <option value="basicAuth">Basic Auth</option>
                <option value="ipAllowList">IP AllowList</option>
                <option value="custom">Custom JSON Config</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label>Configuration JSON <span class="req">*</span></label>
              <textarea class="form-textarea" id="rf-new-mw-config" rows="6" oninput="updateDrawerYamlPreview()"></textarea>
            </div>
          </div>
        </div>
      </div>` : ''}
    </div>`;

  const footerHtml = `
    <button class="btn btn-secondary" onclick="closeDrawer()">Cancel</button>
    <button class="btn btn-primary" id="rf-save-btn" onclick="saveRouterDrawer(${editing})">
      ${editing ? 'Update Route' : (drawerServiceMode === 'create' ? 'Create Route & Service' : 'Create Route')}
    </button>`;

  const title = editing ? `Edit Router: ${name}` : (drawerServiceMode === 'create' ? 'New Route & Service' : 'New Route');
  const subtitle = editing ? 'Modify Traefik router configuration' : (drawerServiceMode === 'create' ? 'Define Traefik Router & Backend Service Atomically' : 'Define Traefik Router Rule & Backend Target');

  openDrawer(title, subtitle, formHtml, footerHtml);
  if (!editing && drawerServiceMode === 'create') {
    onRouterNameInput();
  }
}

function setDrawerServiceMode(mode) {
  drawerServiceMode = mode;
  $('#rf-btn-svc-create')?.classList.toggle('active', mode === 'create');
  $('#rf-btn-svc-select')?.classList.toggle('active', mode === 'select');
  const newContainer = $('#rf-new-service-container');
  const existContainer = $('#rf-existing-service-container');
  if (newContainer) newContainer.style.display = mode === 'create' ? 'block' : 'none';
  if (existContainer) existContainer.style.display = mode === 'select' ? 'block' : 'none';

  const saveBtn = $('#rf-save-btn');
  if (saveBtn) saveBtn.textContent = mode === 'create' ? 'Create Route & Service' : 'Create Route';

  const subtitleEl = $('#drawer-subtitle');
  if (subtitleEl) subtitleEl.textContent = mode === 'create' ? 'Define Traefik Router & Backend Service Atomically' : 'Define Traefik Router Rule & Backend Target';

  const titleEl = $('#drawer-title');
  if (titleEl && !drawerEditingItem?.name) titleEl.textContent = mode === 'create' ? 'New Route & Service' : 'New Route';

  updateDrawerYamlPreview();
}

function onExistingServiceChange(val) {
  const wrap = $('#rf-service-custom-wrap');
  if (wrap) wrap.style.display = val === '__custom__' ? 'block' : 'none';
  updateDrawerYamlPreview();
}

function onTransportSelectChange(val, customWrapId) {
  const wrap = $(`#${customWrapId}`);
  if (wrap) wrap.style.display = val === '__custom__' ? 'block' : 'none';
  updateDrawerYamlPreview();
}

function onRouterNameInput() {
  const rName = $('#rf-name')?.value.trim() || '';
  if (!newServiceNameCustomized) {
    const svcInput = $('#rf-new-service-name');
    if (svcInput && rName) {
      svcInput.value = rName.replace(/-(router|route)$/i, '');
    }
  }
  if (!newMwNameCustomized) {
    const mwInput = $('#rf-new-mw-name');
    if (mwInput && rName) {
      const base = rName.replace(/-(router|route)$/i, '');
      mwInput.value = `${base}-auth`;
    }
  }
  updateDrawerYamlPreview();
}

function onNewServiceNameInput() {
  newServiceNameCustomized = true;
  updateDrawerYamlPreview();
}

function onNewMwNameInput() {
  newMwNameCustomized = true;
  updateDrawerYamlPreview();
}

function onDrawerProtoChange() {
  const proto = $('#rf-proto')?.value || 'http';
  const phhWrap = $('#rf-new-service-phh-wrap');
  if (phhWrap) phhWrap.style.display = proto === 'tcp' ? 'none' : 'block';

  const ruleInput = $('#rf-rule');
  if (ruleInput && !ruleInput.value) {
    ruleInput.placeholder = proto === 'tcp' ? 'HostSNI(`app.example.com`)' : 'Host(`app.example.com`)';
  }

  const urlsInput = $('#rf-new-service-urls');
  if (urlsInput) {
    urlsInput.placeholder = proto === 'tcp' ? '192.168.1.50:8080' : 'http://192.168.1.50:8080';
  }

  const presetsDiv = $('#rf-rule-presets');
  if (presetsDiv) {
    if (proto === 'tcp') {
      presetsDiv.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('host')">+ HostSNI Preset</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('catchall')">+ Catch-All (*)</button>
      `;
    } else {
      presetsDiv.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('host')">+ Host Preset</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="insertRulePreset('path')">+ PathPrefix</button>
      `;
    }
  }

  updateDrawerYamlPreview();
}

function onDrawerTlsChange() {
  const enabled = $('#rf-tls-enable')?.value === 'enabled';
  const wrap = $('#rf-tls-resolver-wrap');
  if (wrap) wrap.style.display = enabled ? 'block' : 'none';
  updateDrawerYamlPreview();
}

function toggleDrawerAccordion(bodyId, iconId) {
  const body = $(`#${bodyId}`);
  const icon = $(`#${iconId}`);
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

function onToggleInlineMw(enabled) {
  const fields = $('#rf-inline-mw-fields');
  if (!fields) return;
  fields.style.opacity = enabled ? '1' : '0.4';
  fields.style.pointerEvents = enabled ? 'auto' : 'none';

  if (enabled) {
    const ta = $('#rf-new-mw-config');
    if (ta && !ta.value.trim()) {
      applyInlineMwPreset($('#rf-new-mw-preset')?.value || 'authentik');
    }
    const mwName = $('#rf-new-mw-name');
    if (mwName && !mwName.value.trim()) {
      const rName = $('#rf-name')?.value.trim() || 'app';
      mwName.value = `${rName.replace(/-(router|route)$/i, '')}-auth`;
    }
  }
  updateDrawerYamlPreview();
}

function applyInlineMwPreset(preset) {
  const ta = $('#rf-new-mw-config');
  if (!ta) return;
  const presets = {
    authentik: {
      forwardAuth: {
        address: 'http://authentik.local:9000/outpost.goauthentik.io/auth/traefik',
        trustForwardHeader: true,
        authResponseHeaders: ['X-authentik-username', 'X-authentik-groups', 'X-authentik-email']
      }
    },
    redirectRegex: {
      redirectRegex: {
        regex: '^https?://([^/]+)/$',
        replacement: 'https://$1/dashboard',
        permanent: true
      }
    },
    headers: {
      headers: {
        SSLRedirect: true,
        STSSeconds: 315360000,
        browserXSSFilter: true,
        contentTypeNosniff: true
      }
    },
    stripPrefix: {
      stripPrefix: {
        prefixes: ['/api']
      }
    },
    basicAuth: {
      basicAuth: {
        users: ['user:hashedPasswordPlaceholder']
      }
    },
    ipAllowList: {
      ipAllowList: {
        sourceRange: ['127.0.0.1/32', '10.0.0.0/24']
      }
    },
    custom: {}
  };
  ta.value = JSON.stringify(presets[preset] || {}, null, 2);
  updateDrawerYamlPreview();
}

function insertRulePreset(type) {
  const proto = $('#rf-proto')?.value || 'http';
  const ruleInput = $('#rf-rule');
  if (!ruleInput) return;
  if (proto === 'tcp') {
    if (type === 'host') ruleInput.value = 'HostSNI(`example.com`)';
    else if (type === 'catchall') ruleInput.value = 'HostSNI(`*`)';
  } else {
    if (type === 'host') ruleInput.value = 'Host(`example.com`)';
    else if (type === 'path') ruleInput.value = 'PathPrefix(`/api`)';
  }
  updateDrawerYamlPreview();
}

function toggleChip(el) {
  el.classList.toggle('active');
}

async function saveRouterDrawer(editing) {
  const proto = $('#rf-proto')?.value || 'http';
  const file = $('#rf-file').value;
  const name = $('#rf-name').value.trim();
  const rule = $('#rf-rule').value.trim();
  const prio = $('#rf-priority')?.value;

  if (!name || !rule) {
    return toast('Router name and rule are required', 'error');
  }

  const eps = $$('#rf-eps-chips .chip.active').map(c => c.dataset.val);
  let mws = $$('#rf-mws-chips .chip.active').map(c => c.dataset.val);

  const routerConfig = { rule };
  if (prio) routerConfig.priority = parseInt(prio);
  if (eps.length) routerConfig.entryPoints = eps;

  // TLS
  if ($('#rf-tls-enable').value === 'enabled') {
    routerConfig.tls = {};
    const res = $('#rf-tls-resolver').value.trim();
    if (res) routerConfig.tls.certResolver = res;
  }

  // Check inline middleware
  const inlineMwEnabled = !editing && $('#rf-enable-inline-mw')?.checked;
  let middlewarePayload = null;
  if (inlineMwEnabled) {
    const mwName = $('#rf-new-mw-name').value.trim();
    const mwRaw = $('#rf-new-mw-config').value.trim();
    if (!mwName) return toast('Inline middleware name is required', 'error');
    if (!mwRaw) return toast('Inline middleware config JSON is required', 'error');
    try {
      const mwParsed = JSON.parse(mwRaw);
      middlewarePayload = { name: mwName, config: mwParsed };
      if (!mws.includes(mwName)) mws.push(mwName);
    } catch (e) {
      return toast('Invalid JSON in inline middleware configuration', 'error');
    }
  }
  if (mws.length) routerConfig.middlewares = mws;

  // Service configuration
  let servicePayload = null;
  if (!editing && drawerServiceMode === 'create') {
    const svcName = $('#rf-new-service-name').value.trim();
    const urlsRaw = $('#rf-new-service-urls').value.trim();
    if (!svcName) return toast('Service name is required', 'error');
    if (!urlsRaw) return toast('At least one server target URL/address is required', 'error');

    const field = proto === 'tcp' ? 'address' : 'url';
    const servers = urlsRaw.split('\n')
      .map(u => u.trim())
      .filter(Boolean)
      .map(u => {
        let target = u;
        if (proto === 'http' && !target.startsWith('http://') && !target.startsWith('https://')) {
          target = `http://${target}`;
        }
        return { [field]: target };
      });

    if (!servers.length) return toast('At least one valid server target is required', 'error');

    const svcConfig = { loadBalancer: { servers } };
    const phh = $('#rf-new-service-phh')?.value;
    if (phh && proto !== 'tcp') svcConfig.loadBalancer.passHostHeader = phh === 'true';
    let st = $('#rf-new-service-st')?.value?.trim();
    if (st === '__custom__') st = $('#rf-new-service-st-custom')?.value?.trim();
    if (st) svcConfig.loadBalancer.serversTransport = st;

    servicePayload = { name: svcName, config: svcConfig };
    routerConfig.service = svcName;
  } else {
    let service = $('#rf-service')?.value?.trim();
    if (service === '__custom__') service = $('#rf-service-custom')?.value?.trim();
    if (!service) return toast('Service target is required', 'error');
    routerConfig.service = service;
  }

  const prefix = proto === 'tcp' ? '/tcp' : '';
  try {
    if (editing) {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/routers/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { config: routerConfig }
      });
      toast(`Router "${name}" updated`);
    } else if (servicePayload || middlewarePayload) {
      await api(`/api/files/${encodeURIComponent(file)}/bundle`, {
        method: 'POST',
        body: {
          proto,
          router: { name, config: routerConfig },
          service: servicePayload,
          middleware: middlewarePayload
        }
      });
      const parts = ['Router'];
      if (servicePayload) parts.push('Service');
      if (middlewarePayload) parts.push('Middleware');
      toast(`${parts.join(' + ')} created successfully!`);
    } else {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/routers`, {
        method: 'POST',
        body: { name, config: routerConfig }
      });
      toast(`Router "${name}" created`);
    }
    closeDrawer();
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// SERVICE DRAWER
function openServiceDrawer(file, name, proto = 'http') {
  drawerCurrentMode = 'service';
  const editing = !!name;
  const svc = editing ? allServices.find(s => s.name === name && s.file === file) : null;
  const cfg = svc?.config || {};
  const lb = cfg.loadBalancer || {};
  const urls = lb.servers ? lb.servers.map(s => s.url || s.address || '').join('\n') : '';

  const formHtml = `
    <div class="form-row" style="margin-bottom:14px;">
      <div class="form-group">
        <label>Protocol</label>
        <select class="form-select" id="sf-proto" onchange="updateDrawerYamlPreview()" ${editing?'disabled':''}>
          <option value="http" ${proto==='http'?'selected':''}>HTTP</option>
          <option value="tcp" ${proto==='tcp'?'selected':''}>TCP</option>
        </select>
      </div>
      <div class="form-group">
        <label>Config File <span class="req">*</span></label>
        <select class="form-select" id="sf-file" onchange="updateDrawerYamlPreview()">
          ${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label>Service Name <span class="req">*</span></label>
      <input class="form-input" id="sf-name" value="${esc(name||'')}" ${editing?'readonly':''} placeholder="my-service" oninput="updateDrawerYamlPreview()">
    </div>

    <div class="form-group">
      <label>Server Targets (One per line) <span class="req">*</span></label>
      <textarea class="form-textarea" id="sf-urls" rows="4" placeholder="http://10.0.0.1:8080" oninput="updateDrawerYamlPreview()">${esc(urls)}</textarea>
      <div class="form-hint">HTTP: http://host:port · TCP: host:port</div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Pass Host Header</label>
        <select class="form-select" id="sf-phh" onchange="updateDrawerYamlPreview()">
          <option value="">Default (true)</option>
          <option value="true" ${lb.passHostHeader===true?'selected':''}>true</option>
          <option value="false" ${lb.passHostHeader===false?'selected':''}>false</option>
        </select>
      </div>
      <div class="form-group">
        <label>Servers Transport</label>
        <select class="form-select" id="sf-st" onchange="onTransportSelectChange(this.value, 'sf-st-custom-wrap')">
          <option value="">None (Default Transport)</option>
          ${allTransports.map(t => `<option value="${esc(t.name)}" ${t.name===lb.serversTransport?'selected':''}>${esc(t.name)} (${esc(t.file)})</option>`).join('')}
          <option value="__custom__" ${lb.serversTransport && !allTransports.some(t => t.name === lb.serversTransport)?'selected':''}>+ Custom Transport Name...</option>
        </select>
        <div id="sf-st-custom-wrap" style="display:${lb.serversTransport && !allTransports.some(t => t.name === lb.serversTransport)?'block':'none'}; margin-top:6px;">
          <input class="form-input" id="sf-st-custom" value="${esc((lb.serversTransport && !allTransports.some(t => t.name === lb.serversTransport))?lb.serversTransport:'')}" placeholder="e.g. skip-certificate-check" oninput="updateDrawerYamlPreview()">
        </div>
      </div>
    </div>`;

  const footerHtml = `
    <button class="btn btn-secondary" onclick="closeDrawer()">Cancel</button>
    <button class="btn btn-primary" onclick="saveServiceDrawer(${editing})">${editing ? 'Update Service' : 'Create Service'}</button>`;

  openDrawer(editing ? `Edit Service: ${name}` : 'New Service', 'Configure Load Balancer Targets', formHtml, footerHtml);
}

async function saveServiceDrawer(editing) {
  const proto = $('#sf-proto')?.value || 'http';
  const file = $('#sf-file').value;
  const name = $('#sf-name').value.trim();
  const urlsRaw = $('#sf-urls').value.trim();

  if (!name || !urlsRaw) return toast('Name and target URLs are required', 'error');

  const urlField = proto === 'tcp' ? 'address' : 'url';
  const servers = urlsRaw.split('\n').map(u => u.trim()).filter(Boolean).map(u => ({ [urlField]: u }));
  const config = { loadBalancer: { servers } };

  const phh = $('#sf-phh').value;
  if (phh) config.loadBalancer.passHostHeader = phh === 'true';
  let st = $('#sf-st')?.value?.trim();
  if (st === '__custom__') st = $('#sf-st-custom')?.value?.trim();
  if (st) config.loadBalancer.serversTransport = st;

  const prefix = proto === 'tcp' ? '/tcp' : '';
  try {
    if (editing) {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/services/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { config }
      });
      toast(`Service "${name}" updated`);
    } else {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/services`, {
        method: 'POST',
        body: { name, config }
      });
      toast(`Service "${name}" created`);
    }
    closeDrawer();
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// MIDDLEWARE DRAWER
function openMiddlewareDrawer(file, name, proto = 'http') {
  drawerCurrentMode = 'middleware';
  const editing = !!name;
  const mw = editing ? allMiddlewares.find(m => m.name === name && m.file === file) : null;
  const cfg = mw?.config || {};
  const currentType = Object.keys(cfg)[0] || 'authentik';

  const formHtml = `
    <div class="form-row" style="margin-bottom:14px;">
      <div class="form-group">
        <label>Protocol</label>
        <select class="form-select" id="mf-proto" ${editing?'disabled':''}>
          <option value="http" ${proto==='http'?'selected':''}>HTTP</option>
          <option value="tcp" ${proto==='tcp'?'selected':''}>TCP</option>
        </select>
      </div>
      <div class="form-group">
        <label>Config File <span class="req">*</span></label>
        <select class="form-select" id="mf-file">
          ${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label>Middleware Name <span class="req">*</span></label>
      <input class="form-input" id="mf-name" value="${esc(name||'')}" ${editing?'readonly':''} placeholder="authentik-auth">
    </div>

    <div class="form-group">
      <label>Middleware Preset</label>
      <select class="form-select" id="mf-preset" onchange="applyMiddlewarePreset(this.value)">
        <option value="authentik" ${currentType==='forwardAuth'?'selected':''}>Authentik / Authelia (ForwardAuth)</option>
        <option value="redirectRegex" ${currentType==='redirectRegex'?'selected':''}>Redirect Regex (URL Rewriting)</option>
        <option value="headers" ${currentType==='headers'?'selected':''}>Security Headers (HSTS, SSL)</option>
        <option value="stripPrefix" ${currentType==='stripPrefix'?'selected':''}>Strip Prefix</option>
        <option value="basicAuth" ${currentType==='basicAuth'?'selected':''}>Basic Auth</option>
        <option value="ipAllowList" ${currentType==='ipAllowList'?'selected':''}>IP AllowList</option>
        <option value="custom" ${!['forwardAuth','redirectRegex','headers','stripPrefix','basicAuth','ipAllowList'].includes(currentType)?'selected':''}>Custom JSON Config</option>
      </select>
    </div>

    <div class="form-group">
      <label>Configuration JSON <span class="req">*</span></label>
      <textarea class="form-textarea" id="mf-config" rows="10" oninput="updateDrawerYamlPreview()">${esc(editing ? JSON.stringify(cfg, null, 2) : '')}</textarea>
    </div>`;

  const footerHtml = `
    <button class="btn btn-secondary" onclick="closeDrawer()">Cancel</button>
    <button class="btn btn-primary" onclick="saveMiddlewareDrawer(${editing})">${editing ? 'Update Middleware' : 'Create Middleware'}</button>`;

  openDrawer(editing ? `Edit Middleware: ${name}` : 'New Middleware', 'Configure Traefik Middlewares', formHtml, footerHtml);
  if (!editing) applyMiddlewarePreset('authentik');
}

function applyMiddlewarePreset(preset) {
  const ta = $('#mf-config');
  if (!ta) return;

  const presets = {
    authentik: {
      forwardAuth: {
        address: 'http://authentik.local:9000/outpost.goauthentik.io/auth/traefik',
        trustForwardHeader: true,
        authResponseHeaders: ['X-authentik-username', 'X-authentik-groups', 'X-authentik-email']
      }
    },
    redirectRegex: {
      redirectRegex: {
        regex: '^https?://([^/]+)/$',
        replacement: 'https://$1/dashboard',
        permanent: true
      }
    },
    headers: {
      headers: {
        SSLRedirect: true,
        STSSeconds: 315360000,
        browserXSSFilter: true,
        contentTypeNosniff: true
      }
    },
    stripPrefix: {
      stripPrefix: {
        prefixes: ['/api']
      }
    },
    basicAuth: {
      basicAuth: {
        users: ['user:hashedPasswordPlaceholder']
      }
    },
    ipAllowList: {
      ipAllowList: {
        sourceRange: ['127.0.0.1/32', '10.0.0.0/24']
      }
    },
    custom: {}
  };

  ta.value = JSON.stringify(presets[preset] || {}, null, 2);
  updateDrawerYamlPreview();
}

async function saveMiddlewareDrawer(editing) {
  const proto = $('#mf-proto')?.value || 'http';
  const file = $('#mf-file').value;
  const name = $('#mf-name').value.trim();
  const cfgRaw = $('#mf-config').value.trim();

  if (!name || !cfgRaw) return toast('Name and config are required', 'error');

  let config;
  try {
    config = JSON.parse(cfgRaw);
  } catch (e) {
    return toast('Invalid JSON in middleware configuration', 'error');
  }

  const prefix = proto === 'tcp' ? '/tcp' : '';
  try {
    if (editing) {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/middlewares/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { config }
      });
      toast(`Middleware "${name}" updated`);
    } else {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/middlewares`, {
        method: 'POST',
        body: { name, config }
      });
      toast(`Middleware "${name}" created`);
    }
    closeDrawer();
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// SERVERS TRANSPORT DRAWER
function openTransportDrawer(file, name, proto = 'http') {
  drawerCurrentMode = 'transport';
  const editing = !!name;
  const transport = editing ? allTransports.find(t => t.name === name && t.file === file) : null;
  const cfg = transport?.config || {};

  const formHtml = `
    <div class="form-row" style="margin-bottom:14px;">
      <div class="form-group">
        <label>Protocol</label>
        <select class="form-select" id="tf-proto" ${editing?'disabled':''}>
          <option value="http" ${proto==='http'?'selected':''}>HTTP</option>
          <option value="tcp" ${proto==='tcp'?'selected':''}>TCP</option>
        </select>
      </div>
      <div class="form-group">
        <label>Config File <span class="req">*</span></label>
        <select class="form-select" id="tf-file">
          ${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="form-group">
      <label>Transport Name <span class="req">*</span></label>
      <input class="form-input" id="tf-name" value="${esc(name||'')}" ${editing?'readonly':''} placeholder="skip-certificate-check">
    </div>

    <div class="form-group">
      <label>Insecure Skip Verify (Self-signed certs)</label>
      <select class="form-select" id="tf-skip" onchange="updateDrawerYamlPreview()">
        <option value="true" ${cfg.insecureSkipVerify===true?'selected':''}>true (Skip SSL verification)</option>
        <option value="false" ${!cfg.insecureSkipVerify?'selected':''}>false (Strict SSL)</option>
      </select>
    </div>

    <div class="form-group">
      <label>Server Name (SNI Override)</label>
      <input class="form-input" id="tf-sni" value="${esc(cfg.serverName||'')}" placeholder="e.g. backend.local" oninput="updateDrawerYamlPreview()">
    </div>`;

  const footerHtml = `
    <button class="btn btn-secondary" onclick="closeDrawer()">Cancel</button>
    <button class="btn btn-primary" onclick="saveTransportDrawer(${editing})">${editing ? 'Update Transport' : 'Create Transport'}</button>`;

  openDrawer(editing ? `Edit Transport: ${name}` : 'New Transport', 'Configure Backend SSL & Timeouts', formHtml, footerHtml);
}

async function saveTransportDrawer(editing) {
  const proto = $('#tf-proto')?.value || 'http';
  const file = $('#tf-file').value;
  const name = $('#tf-name').value.trim();
  const skip = $('#tf-skip').value === 'true';
  const sni = $('#tf-sni').value.trim();

  if (!name) return toast('Transport name required', 'error');

  const config = { insecureSkipVerify: skip };
  if (sni) config.serverName = sni;

  const prefix = proto === 'tcp' ? '/tcp' : '';
  try {
    if (editing) {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/serversTransports/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: { config }
      });
      toast(`Transport "${name}" updated`);
    } else {
      await api(`/api/files/${encodeURIComponent(file)}${prefix}/serversTransports`, {
        method: 'POST',
        body: { name, config }
      });
      toast(`Transport "${name}" created`);
    }
    closeDrawer();
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Live YAML preview generation in Drawer
function updateDrawerYamlPreview() {
  const codeEl = $('#drawer-yaml-code');
  if (!codeEl) return;

  if (drawerCurrentMode === 'router') {
    const proto = $('#rf-proto')?.value || 'http';
    const name = $('#rf-name')?.value || 'my-router';
    const rule = $('#rf-rule')?.value || (proto === 'tcp' ? 'HostSNI(`app.example.com`)' : 'Host(`app.example.com`)');
    const prio = $('#rf-priority')?.value;
    const tlsEnable = $('#rf-tls-enable')?.value;
    const resolver = $('#rf-tls-resolver')?.value;
    const eps = $$('#rf-eps-chips .chip.active').map(c => c.dataset.val);
    let mws = $$('#rf-mws-chips .chip.active').map(c => c.dataset.val);

    let targetService = '';
    let serviceYaml = '';
    let middlewareYaml = '';

    if (drawerServiceMode === 'create' && !drawerEditingItem?.name) {
      targetService = $('#rf-new-service-name')?.value.trim() || 'my-service';
      const urls = ($('#rf-new-service-urls')?.value || '').split('\n').map(u => u.trim()).filter(Boolean);
      const field = proto === 'tcp' ? 'address' : 'url';
      const phh = $('#rf-new-service-phh')?.value;
      let st = $('#rf-new-service-st')?.value?.trim();
      if (st === '__custom__') st = $('#rf-new-service-st-custom')?.value?.trim();

      serviceYaml = `  services:\n    ${targetService}:\n      loadBalancer:\n        servers:\n`;
      if (urls.length) {
        serviceYaml += urls.map(u => {
          let val = u;
          if (proto === 'http' && !val.startsWith('http://') && !val.startsWith('https://')) {
            val = `http://${val}`;
          }
          return `          - ${field}: "${val}"`;
        }).join('\n') + '\n';
      } else {
        serviceYaml += `          - ${field}: "${proto === 'tcp' ? '127.0.0.1:8080' : 'http://127.0.0.1:8080'}"\n`;
      }
      if (phh && proto !== 'tcp') serviceYaml += `        passHostHeader: ${phh}\n`;
      if (st) serviceYaml += `        serversTransport: ${st}\n`;
    } else {
      let selSvc = $('#rf-service')?.value?.trim();
      if (selSvc === '__custom__') selSvc = $('#rf-service-custom')?.value?.trim();
      targetService = selSvc || 'my-service';
    }

    const inlineMwEnabled = $('#rf-enable-inline-mw')?.checked;
    const inlineMwName = $('#rf-new-mw-name')?.value.trim();
    if (inlineMwEnabled && inlineMwName) {
      if (!mws.includes(inlineMwName)) {
        mws = [...mws, inlineMwName];
      }
      middlewareYaml = `  middlewares:\n    ${inlineMwName}:\n      # ${$('#rf-new-mw-preset')?.value || 'inline middleware'}\n`;
    }

    let y = `${proto}:\n  routers:\n    ${name}:\n      rule: "${rule}"\n      service: ${targetService}\n`;
    if (prio) y += `      priority: ${prio}\n`;
    if (eps.length) y += `      entryPoints:\n${eps.map(e => `        - ${e}`).join('\n')}\n`;
    if (mws.length) y += `      middlewares:\n${mws.map(m => `        - ${m}`).join('\n')}\n`;
    if (tlsEnable === 'enabled') {
      y += `      tls:\n`;
      if (resolver) y += `        certResolver: ${resolver}\n`;
    }

    if (serviceYaml) y += '\n' + serviceYaml;
    if (middlewareYaml) y += '\n' + middlewareYaml;

    codeEl.textContent = y;
  } else if (drawerCurrentMode === 'service') {
    const proto = $('#sf-proto')?.value || 'http';
    const name = $('#sf-name')?.value || 'my-service';
    const urls = ($('#sf-urls')?.value || '').split('\n').filter(Boolean);
    const field = proto === 'tcp' ? 'address' : 'url';
    const phh = $('#sf-phh')?.value;
    let st = $('#sf-st')?.value?.trim();
    if (st === '__custom__') st = $('#sf-st-custom')?.value?.trim();

    let y = `${proto}:\n  services:\n    ${name}:\n      loadBalancer:\n        servers:\n`;
    y += urls.map(u => `          - ${field}: ${u.trim()}`).join('\n') + '\n';
    if (phh) y += `        passHostHeader: ${phh}\n`;
    if (st) y += `        serversTransport: ${st}\n`;
    codeEl.textContent = y;
  } else if (drawerCurrentMode === 'transport') {
    const proto = $('#tf-proto')?.value || 'http';
    const name = $('#tf-name')?.value || 'my-transport';
    const skip = $('#tf-skip')?.value === 'true';
    codeEl.textContent = `${proto}:\n  serversTransports:\n    ${name}:\n      insecureSkipVerify: ${skip}\n`;
  } else if (drawerCurrentMode === 'middleware') {
    const proto = $('#mf-proto')?.value || 'http';
    const name = $('#mf-name')?.value || 'my-middleware';
    codeEl.textContent = `${proto}:\n  middlewares:\n    ${name}:\n      # See configuration tab\n`;
  }
}

// ── 13. Delete Confirmations ───────────────────────────────────
function confirmDelete(type, file, name, proto) {
  const bodyHtml = `
    <div style="font-size:14px; line-height:1.5;">
      Are you sure you want to delete <strong style="color:var(--red);">${esc(name)}</strong> from <code style="color:var(--amber);">${esc(file)}</code>?
      <div class="form-hint" style="margin-top:8px;">A timestamped backup of the file will be generated automatically.</div>
    </div>`;
  const footerHtml = `
    <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" onclick="doDelete('${type}','${esc(file)}','${esc(name)}','${proto||''}')">Delete</button>`;
  openModal(`Delete ${type}`, bodyHtml, footerHtml);
}

async function doDelete(type, file, name, proto) {
  closeModal();
  const prefix = proto === 'tcp' ? '/tcp' : '';
  const endpoint = `/api/files/${encodeURIComponent(file)}${prefix}/${type}s/${encodeURIComponent(name)}`;
  try {
    await api(endpoint, { method: 'DELETE' });
    toast(`Deleted ${name}`);
    renderCurrentView();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── 14. Command Palette (Ctrl+K) ───────────────────────────────
const cmdOverlay = $('#cmd-overlay');
const cmdInput = $('#cmd-input');
const cmdResults = $('#cmd-results');

$('#open-cmd-btn').addEventListener('click', openCmdPalette);

window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCmdPalette();
  } else if (e.key === 'Escape' && cmdOverlay.classList.contains('active')) {
    closeCmdPalette();
  }
});

cmdOverlay.addEventListener('click', e => {
  if (e.target === cmdOverlay) closeCmdPalette();
});

function openCmdPalette() {
  cmdOverlay.classList.add('active');
  cmdInput.value = '';
  cmdInput.focus();
  renderCmdItems('');
}

function closeCmdPalette() {
  cmdOverlay.classList.remove('active');
}

cmdInput.addEventListener('input', e => {
  renderCmdItems(e.target.value.toLowerCase().trim());
});

function renderCmdItems(q) {
  const items = [
    { title: 'Dashboard', type: 'Navigation', action: () => setView('dashboard') },
    { title: 'Route Topology & Pipeline', type: 'Navigation', action: () => setView('topology') },
    { title: 'Routers', type: 'Navigation', action: () => setView('routers') },
    { title: 'Services', type: 'Navigation', action: () => setView('services') },
    { title: 'Middlewares', type: 'Navigation', action: () => setView('middlewares') },
    { title: 'Servers Transports', type: 'Navigation', action: () => setView('transports') },
    { title: 'Config Files', type: 'Navigation', action: () => setView('files') },
    { title: 'Backups & Diff', type: 'Navigation', action: () => setView('backups') },
    { title: 'Live Access Logs', type: 'Navigation', action: () => setView('logs') },
    { title: 'SSL Certificates', type: 'Navigation', action: () => setView('certificates') },
    { title: 'Traefik Static Config', type: 'Navigation', action: () => setView('static') },

    { title: '+ Create New Route & Service (Unified)', type: 'Action', action: () => openRouterDrawer(null, null, 'http', true) },
    { title: '+ Create New Route Only', type: 'Action', action: () => openRouterDrawer(null, null, 'http', false) },
    { title: '+ Create New Service', type: 'Action', action: () => openServiceDrawer() },
    { title: '+ Create New Middleware', type: 'Action', action: () => openMiddlewareDrawer() },
    { title: '+ Create New Transport', type: 'Action', action: () => openTransportDrawer() },
    { title: '+ Create New Config File', type: 'Action', action: () => openNewFileModal() },

    { title: 'Theme: Obsidian Dark (Linear)', type: 'Theme', action: () => setAppTheme('obsidian') },
    { title: 'Theme: Traefik Teal (Official)', type: 'Theme', action: () => setAppTheme('traefik') },
    { title: 'Theme: Carbon OLED (Minimal)', type: 'Theme', action: () => setAppTheme('carbon') },
    { title: 'Theme: Nord Soft Pastel', type: 'Theme', action: () => setAppTheme('nord') },
    { title: 'Theme: Pure Light (Clean)', type: 'Theme', action: () => setAppTheme('light') },
  ];

  // Also include matching routers
  for (const r of allRouters) {
    items.push({
      title: `${r.name} (${r.config.rule || 'TCP'})`,
      type: 'Route',
      action: () => { setView('routers'); openRouterDrawer(r.file, r.name, r.proto); }
    });
  }

  const matched = items.filter(it => !q || it.title.toLowerCase().includes(q) || it.type.toLowerCase().includes(q));

  cmdResults.innerHTML = matched.slice(0, 12).map((it, idx) => `
    <div class="cmd-item" onclick="executeCmdItem(${idx})">
      <span class="cmd-item-title">${esc(it.title)}</span>
      <span class="cmd-item-type">${esc(it.type)}</span>
    </div>`).join('');

  window._currentCmdMatches = matched;
}

function executeCmdItem(idx) {
  const item = window._currentCmdMatches?.[idx];
  if (item) {
    closeCmdPalette();
    item.action();
  }
}

// ── Startup ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setView('dashboard');
});
