/* ═══════════════════════════════════════════════════════════════
   Traefik Route Manager — Client Application
   ═══════════════════════════════════════════════════════════════ */

const API = '';

// ── State ──────────────────────────────────────────────────────
let currentView = 'dashboard';
let filesCache = [];
let allRouters = [], allServices = [], allMiddlewares = [];
let searchTerm = '';

// ── DOM refs ───────────────────────────────────────────────────
const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

// ── API helpers ────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ── Toast ──────────────────────────────────────────────────────
function toast(message, type = 'success') {
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  $('#toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 3500);
}

// ── Modal ──────────────────────────────────────────────────────
function openModal(title, bodyHtml, footerHtml) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-footer').innerHTML = footerHtml;
  $('#modal-overlay').classList.add('active');
}
function closeModal() { $('#modal-overlay').classList.remove('active'); }

$('#modal-close').addEventListener('click', closeModal);
$('#modal-overlay').addEventListener('click', e => { if (e.target === $('#modal-overlay')) closeModal(); });

// ── Navigation ─────────────────────────────────────────────────
function setView(view) {
  currentView = view;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

  const titles = { dashboard: 'Dashboard', routers: 'Routers', services: 'Services', middlewares: 'Middlewares', files: 'Config Files', backups: 'Backups' };
  $('#page-title').textContent = titles[view] || view;

  const showSearch = ['routers', 'services', 'middlewares'].includes(view);
  $('#search-box').style.display = showSearch ? 'flex' : 'none';
  searchTerm = '';
  $('#search-input').value = '';

  loadView(view);
}

$$('.nav-item').forEach(n => n.addEventListener('click', e => {
  e.preventDefault();
  setView(n.dataset.view);
  if (window.innerWidth <= 768) $('#sidebar').classList.remove('open');
}));

$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

$('#search-input').addEventListener('input', e => {
  searchTerm = e.target.value.toLowerCase();
  if (currentView === 'routers') renderRouters();
  else if (currentView === 'services') renderServices();
  else if (currentView === 'middlewares') renderMiddlewares();
});

// ── Data Loading ───────────────────────────────────────────────
async function loadAllData() {
  filesCache = await api('/api/files');
  allRouters = []; allServices = []; allMiddlewares = [];
  for (const f of filesCache) {
    const data = await api(`/api/files/${encodeURIComponent(f.name)}`);
    if (data.http?.routers) {
      for (const [name, cfg] of Object.entries(data.http.routers)) {
        allRouters.push({ name, config: cfg, file: f.name, type: 'http' });
      }
    }
    if (data.tcp?.routers) {
      for (const [name, cfg] of Object.entries(data.tcp.routers)) {
        allRouters.push({ name, config: cfg, file: f.name, type: 'tcp' });
      }
    }
    if (data.http?.services) {
      for (const [name, cfg] of Object.entries(data.http.services)) {
        allServices.push({ name, config: cfg, file: f.name, type: 'http' });
      }
    }
    if (data.tcp?.services) {
      for (const [name, cfg] of Object.entries(data.tcp.services)) {
        allServices.push({ name, config: cfg, file: f.name, type: 'tcp' });
      }
    }
    if (data.http?.middlewares) {
      for (const [name, cfg] of Object.entries(data.http.middlewares)) {
        allMiddlewares.push({ name, config: cfg, file: f.name });
      }
    }
  }
}

async function loadView(view) {
  await loadAllData();
  if (view === 'dashboard') renderDashboard();
  else if (view === 'routers') renderRouters();
  else if (view === 'services') renderServices();
  else if (view === 'middlewares') renderMiddlewares();
  else if (view === 'files') renderFiles();
  else if (view === 'backups') renderBackups();
}

// ── SVG Icons ──────────────────────────────────────────────────
const icons = {
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  restore: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>',
};

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
  const ov = {
    files: filesCache.length,
    httpRouters: allRouters.filter(r => r.type === 'http').length,
    tcpRouters: allRouters.filter(r => r.type === 'tcp').length,
    httpServices: allServices.filter(s => s.type === 'http').length,
    tcpServices: allServices.filter(s => s.type === 'tcp').length,
    middlewares: allMiddlewares.length,
  };
  const el = $('#view-dashboard');
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card cyan">
        <div class="stat-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg></div>
        <div class="stat-value">${ov.httpRouters}</div>
        <div class="stat-label">HTTP Routers</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M6 14h.01"/></svg></div>
        <div class="stat-value">${ov.httpServices}</div>
        <div class="stat-label">HTTP Services</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>
        <div class="stat-value">${ov.middlewares}</div>
        <div class="stat-label">Middlewares</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg></div>
        <div class="stat-value">${ov.files}</div>
        <div class="stat-label">Config Files</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3"/></svg></div>
        <div class="stat-value">${ov.tcpRouters}</div>
        <div class="stat-label">TCP Routers</div>
      </div>
      <div class="stat-card red">
        <div class="stat-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/></svg></div>
        <div class="stat-value">${ov.tcpServices}</div>
        <div class="stat-label">TCP Services</div>
      </div>
    </div>
    <div class="section-header"><h3>Recent Routes</h3></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Rule</th><th>Service</th><th>File</th><th>Type</th></tr></thead>
      <tbody>${allRouters.slice(0, 10).map(r => `<tr>
        <td class="cell-name">${r.name}</td>
        <td class="cell-mono">${esc(r.config.rule || r.config.rule || '—')}</td>
        <td>${r.config.service || '—'}</td>
        <td><span class="cell-badge badge-amber">${r.file}</span></td>
        <td><span class="cell-badge ${r.type === 'http' ? 'badge-cyan' : 'badge-blue'}">${r.type.toUpperCase()}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Routers View ───────────────────────────────────────────────
function renderRouters() {
  const filtered = allRouters.filter(r =>
    !searchTerm || r.name.toLowerCase().includes(searchTerm) ||
    (r.config.rule || '').toLowerCase().includes(searchTerm) ||
    (r.config.service || '').toLowerCase().includes(searchTerm)
  );
  const el = $('#view-routers');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-left"><span>${filtered.length} router${filtered.length !== 1 ? 's' : ''}</span></div>
        <div class="toolbar-right"><button class="btn btn-primary" onclick="openRouterForm()"><span>${icons.plus}</span> New Router</button></div>
      </div>
      <table><thead><tr><th>Name</th><th>Rule</th><th>Service</th><th>EntryPoints</th><th>Middlewares</th><th>File</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${filtered.map(r => {
        const ep = r.config.entryPoints ? r.config.entryPoints.join(', ') : '—';
        const mw = r.config.middlewares ? r.config.middlewares.join(', ') : '—';
        return `<tr>
          <td class="cell-name">${esc(r.name)}</td>
          <td class="cell-mono">${esc(r.config.rule || '—')}</td>
          <td>${esc(r.config.service || '—')}</td>
          <td>${ep}</td>
          <td>${mw}</td>
          <td><span class="cell-badge badge-amber">${r.file}</span></td>
          <td class="cell-actions">
            <button class="btn-icon" title="Edit" onclick="openRouterForm('${esc(r.file)}','${esc(r.name)}','${r.type}')">${icons.edit}</button>
            <button class="btn-icon danger" title="Delete" onclick="confirmDelete('router','${esc(r.file)}','${esc(r.name)}','${r.type}')">${icons.trash}</button>
          </td></tr>`;
      }).join('')}</tbody></table>
    </div>`;
}

// ── Services View ──────────────────────────────────────────────
function renderServices() {
  const filtered = allServices.filter(s =>
    !searchTerm || s.name.toLowerCase().includes(searchTerm)
  );
  const el = $('#view-services');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-left"><span>${filtered.length} service${filtered.length !== 1 ? 's' : ''}</span></div>
        <div class="toolbar-right"><button class="btn btn-primary" onclick="openServiceForm()"><span>${icons.plus}</span> New Service</button></div>
      </div>
      <table><thead><tr><th>Name</th><th>URLs</th><th>Type</th><th>File</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${filtered.map(s => {
        let urls = '—';
        const lb = s.config.loadBalancer;
        if (lb?.servers) urls = lb.servers.map(sv => sv.url || sv.address || '?').join(', ');
        return `<tr>
          <td class="cell-name">${esc(s.name)}</td>
          <td class="cell-mono">${esc(urls)}</td>
          <td><span class="cell-badge ${s.type==='http'?'badge-cyan':'badge-blue'}">${s.type.toUpperCase()}</span></td>
          <td><span class="cell-badge badge-amber">${s.file}</span></td>
          <td class="cell-actions">
            <button class="btn-icon" title="Edit" onclick="openServiceForm('${esc(s.file)}','${esc(s.name)}','${s.type}')">${icons.edit}</button>
            <button class="btn-icon danger" title="Delete" onclick="confirmDelete('service','${esc(s.file)}','${esc(s.name)}','${s.type}')">${icons.trash}</button>
          </td></tr>`;
      }).join('')}</tbody></table>
    </div>`;
}

// ── Middlewares View ────────────────────────────────────────────
function renderMiddlewares() {
  const filtered = allMiddlewares.filter(m =>
    !searchTerm || m.name.toLowerCase().includes(searchTerm)
  );
  const el = $('#view-middlewares');
  el.innerHTML = `
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="toolbar-left"><span>${filtered.length} middleware${filtered.length !== 1 ? 's' : ''}</span></div>
        <div class="toolbar-right"><button class="btn btn-primary" onclick="openMiddlewareForm()"><span>${icons.plus}</span> New Middleware</button></div>
      </div>
      <table><thead><tr><th>Name</th><th>Type</th><th>File</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${filtered.map(m => {
        const mwType = Object.keys(m.config)[0] || '—';
        return `<tr>
          <td class="cell-name">${esc(m.name)}</td>
          <td><span class="cell-badge badge-green">${mwType}</span></td>
          <td><span class="cell-badge badge-amber">${m.file}</span></td>
          <td class="cell-actions">
            <button class="btn-icon" title="Edit" onclick="openMiddlewareForm('${esc(m.file)}','${esc(m.name)}')">${icons.edit}</button>
            <button class="btn-icon danger" title="Delete" onclick="confirmDelete('middleware','${esc(m.file)}','${esc(m.name)}')">${icons.trash}</button>
          </td></tr>`;
      }).join('')}</tbody></table>
    </div>`;
}

// ── Files View ─────────────────────────────────────────────────
function renderFiles() {
  const el = $('#view-files');
  el.innerHTML = `
    <div class="section-header"><h3>Dynamic Config Files</h3>
      <button class="btn btn-primary" onclick="openNewFileForm()"><span>${icons.plus}</span> New File</button>
    </div>
    <div class="file-grid">${filesCache.map(f => `
      <div class="file-card" onclick="showFileRaw('${esc(f.name)}')">
        <div class="file-card-header">
          <div class="file-card-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg></div>
          <div class="file-card-name">${f.name}</div>
        </div>
        <div class="file-card-stats">
          <span class="file-stat"><strong>${f.httpRouters}</strong> routers</span>
          <span class="file-stat"><strong>${f.httpServices}</strong> services</span>
          <span class="file-stat"><strong>${f.httpMiddlewares}</strong> middlewares</span>
          ${f.tcpRouters ? `<span class="file-stat"><strong>${f.tcpRouters}</strong> tcp routers</span>` : ''}
        </div>
      </div>`).join('')}
    </div>`;
}

async function showFileRaw(filename) {
  const raw = await api(`/api/files/${encodeURIComponent(filename)}/raw`);
  openModal(filename, `<div class="code-block">${esc(raw)}</div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`);
}

// ── Backups View ───────────────────────────────────────────────
async function renderBackups() {
  const backups = await api('/api/backups');
  const el = $('#view-backups');
  if (!backups.length) {
    el.innerHTML = '<div class="empty-state"><p>No backups yet. Backups are created automatically before every config change.</p></div>';
    return;
  }
  el.innerHTML = `<div class="table-wrap">${backups.map(b => `
    <div class="backup-item">
      <div class="backup-info">
        <span class="backup-name">${esc(b.name)}</span>
        <span class="backup-meta">${new Date(b.created).toLocaleString()} · ${(b.size / 1024).toFixed(1)} KB</span>
      </div>
      <div class="cell-actions">
        <button class="btn-icon" title="Restore" onclick="restoreBackup('${esc(b.name)}')">${icons.restore}</button>
        <button class="btn-icon danger" title="Delete" onclick="deleteBackup('${esc(b.name)}')">${icons.trash}</button>
      </div>
    </div>`).join('')}</div>`;
}

async function restoreBackup(name) {
  if (!confirm(`Restore backup "${name}"? A backup of the current file will be created first.`)) return;
  try { await api(`/api/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' }); toast('Backup restored'); loadView(currentView); }
  catch (e) { toast(e.message, 'error'); }
}

async function deleteBackup(name) {
  if (!confirm(`Delete backup "${name}"?`)) return;
  try { await api(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }); toast('Backup deleted'); renderBackups(); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Confirm Delete ─────────────────────────────────────────────
function confirmDelete(type, file, name, proto) {
  openModal(`Delete ${type}`,
    `<div class="confirm-body">
      <div class="confirm-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <p>Are you sure you want to delete <span class="confirm-name">${esc(name)}</span> from <span class="confirm-name">${esc(file)}</span>?</p>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-danger" onclick="doDelete('${type}','${esc(file)}','${esc(name)}','${proto || ''}')">Delete</button>`);
}

async function doDelete(type, file, name, proto) {
  closeModal();
  const prefix = proto === 'tcp' ? '/tcp' : '';
  const endpoint = `/api/files/${encodeURIComponent(file)}${prefix}/${type}s/${encodeURIComponent(name)}`;
  try { await api(endpoint, { method: 'DELETE' }); toast(`${type} "${name}" deleted`); loadView(currentView); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Router Form ────────────────────────────────────────────────
function openRouterForm(file, name, type) {
  const editing = !!name;
  const router = editing ? allRouters.find(r => r.name === name && r.file === file) : null;
  const cfg = router?.config || {};
  openModal(editing ? `Edit Router: ${name}` : 'New Router',
    `<div class="form-group"><label>File <span class="required">*</span></label>
      <select id="f-file">${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}</select></div>
    <div class="form-group"><label>Router Name <span class="required">*</span></label>
      <input id="f-name" value="${esc(name||'')}" ${editing?'readonly':''}><div class="help-text">e.g. my-app-router</div></div>
    <div class="form-group"><label>Rule <span class="required">*</span></label>
      <input id="f-rule" value="${esc(cfg.rule||'')}"><div class="help-text">e.g. Host(\`app.example.com\`)</div></div>
    <div class="form-row">
      <div class="form-group"><label>Service <span class="required">*</span></label>
        <input id="f-service" value="${esc(cfg.service||'')}"></div>
      <div class="form-group"><label>Priority</label>
        <input id="f-priority" type="number" value="${cfg.priority||''}"></div>
    </div>
    <div class="form-group"><label>Entry Points</label>
      <input id="f-ep" value="${(cfg.entryPoints||[]).join(', ')}"><div class="help-text">Comma-separated, e.g. websecure</div></div>
    <div class="form-group"><label>Middlewares</label>
      <input id="f-mw" value="${(cfg.middlewares||[]).join(', ')}"><div class="help-text">Comma-separated middleware names</div></div>
    <div class="form-group"><label>TLS (YAML)</label>
      <textarea id="f-tls" rows="3">${cfg.tls ? JSON.stringify(cfg.tls, null, 2) : ''}</textarea>
      <div class="help-text">JSON/YAML for TLS config, leave empty to skip</div></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="saveRouter(${editing},'${type||'http'}')">${editing ? 'Update' : 'Create'}</button>`);
}

async function saveRouter(editing, type) {
  const file = $('#f-file').value;
  const name = $('#f-name').value.trim();
  const rule = $('#f-rule').value.trim();
  const service = $('#f-service').value.trim();
  if (!name || !rule || !service) { toast('Name, rule, and service are required', 'error'); return; }

  const config = { rule, service };
  const ep = $('#f-ep').value.trim();
  if (ep) config.entryPoints = ep.split(',').map(s => s.trim()).filter(Boolean);
  const mw = $('#f-mw').value.trim();
  if (mw) config.middlewares = mw.split(',').map(s => s.trim()).filter(Boolean);
  const pr = $('#f-priority').value;
  if (pr) config.priority = parseInt(pr);
  const tls = $('#f-tls').value.trim();
  if (tls) { try { config.tls = JSON.parse(tls); } catch { toast('Invalid TLS JSON', 'error'); return; } }

  const prefix = type === 'tcp' ? '/tcp' : '';
  try {
    if (editing) await api(`/api/files/${encodeURIComponent(file)}${prefix}/routers/${encodeURIComponent(name)}`, { method: 'PUT', body: { config } });
    else await api(`/api/files/${encodeURIComponent(file)}${prefix}/routers`, { method: 'POST', body: { name, config } });
    closeModal(); toast(editing ? 'Router updated' : 'Router created'); loadView(currentView);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Service Form ───────────────────────────────────────────────
function openServiceForm(file, name, type) {
  const editing = !!name;
  const svc = editing ? allServices.find(s => s.name === name && s.file === file) : null;
  const cfg = svc?.config || {};
  const lb = cfg.loadBalancer || {};
  const urls = lb.servers ? lb.servers.map(s => s.url || s.address || '').join('\n') : '';

  openModal(editing ? `Edit Service: ${name}` : 'New Service',
    `<div class="form-group"><label>File <span class="required">*</span></label>
      <select id="f-file">${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}</select></div>
    <div class="form-group"><label>Service Name <span class="required">*</span></label>
      <input id="f-name" value="${esc(name||'')}" ${editing?'readonly':''}></div>
    <div class="form-group"><label>Server URLs <span class="required">*</span></label>
      <textarea id="f-urls" rows="3">${esc(urls)}</textarea>
      <div class="help-text">One URL per line, e.g. http://192.168.1.10:8080</div></div>
    <div class="form-row">
      <div class="form-group"><label>Pass Host Header</label>
        <select id="f-phh"><option value="">Default</option><option value="true" ${lb.passHostHeader===true?'selected':''}>Yes</option><option value="false" ${lb.passHostHeader===false?'selected':''}>No</option></select></div>
      <div class="form-group"><label>Servers Transport</label>
        <input id="f-st" value="${esc(lb.serversTransport||'')}"><div class="help-text">e.g. skip-certificate-check</div></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="saveService(${editing},'${type||'http'}')">${editing ? 'Update' : 'Create'}</button>`);
}

async function saveService(editing, type) {
  const file = $('#f-file').value;
  const name = $('#f-name').value.trim();
  const urlsRaw = $('#f-urls').value.trim();
  if (!name || !urlsRaw) { toast('Name and URLs are required', 'error'); return; }

  const urlField = type === 'tcp' ? 'address' : 'url';
  const servers = urlsRaw.split('\n').map(u => u.trim()).filter(Boolean).map(u => ({ [urlField]: u }));
  const config = { loadBalancer: { servers } };

  const phh = $('#f-phh').value;
  if (phh) config.loadBalancer.passHostHeader = phh === 'true';
  const st = $('#f-st').value.trim();
  if (st) config.loadBalancer.serversTransport = st;

  const prefix = type === 'tcp' ? '/tcp' : '';
  try {
    if (editing) await api(`/api/files/${encodeURIComponent(file)}${prefix}/services/${encodeURIComponent(name)}`, { method: 'PUT', body: { config } });
    else await api(`/api/files/${encodeURIComponent(file)}${prefix}/services`, { method: 'POST', body: { name, config } });
    closeModal(); toast(editing ? 'Service updated' : 'Service created'); loadView(currentView);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Middleware Form ────────────────────────────────────────────
function openMiddlewareForm(file, name) {
  const editing = !!name;
  const mw = editing ? allMiddlewares.find(m => m.name === name && m.file === file) : null;
  const cfgYaml = mw ? JSON.stringify(mw.config, null, 2) : '';

  openModal(editing ? `Edit Middleware: ${name}` : 'New Middleware',
    `<div class="form-group"><label>File <span class="required">*</span></label>
      <select id="f-file">${filesCache.map(f => `<option value="${f.name}" ${f.name===file?'selected':''}>${f.name}</option>`).join('')}</select></div>
    <div class="form-group"><label>Middleware Name <span class="required">*</span></label>
      <input id="f-name" value="${esc(name||'')}" ${editing?'readonly':''}></div>
    <div class="form-group"><label>Configuration (JSON) <span class="required">*</span></label>
      <textarea id="f-config" rows="8">${esc(cfgYaml)}</textarea>
      <div class="help-text">JSON object, e.g. {"redirectRegex":{"regex":"(.*)","replacement":"https://example.com"}}</div></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="saveMiddleware(${editing})">${editing ? 'Update' : 'Create'}</button>`);
}

async function saveMiddleware(editing) {
  const file = $('#f-file').value;
  const name = $('#f-name').value.trim();
  const cfgRaw = $('#f-config').value.trim();
  if (!name || !cfgRaw) { toast('Name and config are required', 'error'); return; }
  let config;
  try { config = JSON.parse(cfgRaw); } catch { toast('Invalid JSON', 'error'); return; }

  try {
    if (editing) await api(`/api/files/${encodeURIComponent(file)}/middlewares/${encodeURIComponent(name)}`, { method: 'PUT', body: { config } });
    else await api(`/api/files/${encodeURIComponent(file)}/middlewares`, { method: 'POST', body: { name, config } });
    closeModal(); toast(editing ? 'Middleware updated' : 'Middleware created'); loadView(currentView);
  } catch (e) { toast(e.message, 'error'); }
}

// ── New File Form ──────────────────────────────────────────────
function openNewFileForm() {
  openModal('New Config File',
    `<div class="form-group"><label>Filename <span class="required">*</span></label>
      <input id="f-filename" placeholder="my-routes.yml"><div class="help-text">Must end in .yml or .yaml</div></div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="createNewFile()">Create</button>`);
}

async function createNewFile() {
  const filename = $('#f-filename').value.trim();
  if (!filename) { toast('Filename required', 'error'); return; }
  try { await api('/api/files', { method: 'POST', body: { filename } }); closeModal(); toast('File created'); loadView(currentView); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => setView('dashboard'));
