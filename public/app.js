/* ═══════════════════════════════════════════════════════
   LCARS OPS DASHBOARD — Frontend App
   ═══════════════════════════════════════════════════════ */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const POLL_RAILWAY_MS    = 60_000;   // 1 min
const POLL_AI_USAGE_MS   = 300_000;  // 5 min
const POLL_PINECONE_MS   = 600_000;  // 10 min

const COLORS = {
  orange:      '#ff8800',
  gold:        '#ffaa00',
  butterscotch:'#ff9966',
  sunflower:   '#ffcc99',
  almond:      '#ffaa90',
  blue:        '#5566ff',
  ice:         '#99ccff',
  violet:      '#cc99ff',
  green:       '#779933',
  red:         '#cc4444',
  tomato:      '#ff5555',
  mars:        '#ff2200',
  dim:         '#666688',
  white:       '#ffffff',
};

const STATUS_COLORS = {
  SUCCESS:   COLORS.green,
  FAILED:    COLORS.red,
  CRASHED:   COLORS.mars,
  BUILDING:  COLORS.gold,
  DEPLOYING: COLORS.blue,
  REMOVED:   COLORS.dim,
  THROTTLED: COLORS.tomato,
  UNKNOWN:   COLORS.dim,
};

// ─── App State ────────────────────────────────────────────────────────────────
const state = {
  features: {},
  alerts: [],
  tokenChart: null,
  deployHistoryChart: null,
  filters: {
    hideRemoved: true,
    hideEmptyEnv: false,
  },
  lastTopology: null,
  lastDeployments: null,
  lastMetrics: null,
};

// ─── Stardate ─────────────────────────────────────────────────────────────────
function getStardate() {
  // Fan-standard formula: ~26000-range for 2026
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 0);
  const diff = now - startOfYear;
  const dayOfYear = Math.floor(diff / 86400000);
  const daysInYear = (year % 4 === 0) ? 366 : 365;
  const stardate = (year - 2000) * 1000 + (dayOfYear / daysInYear) * 1000;
  return stardate.toFixed(1);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  try {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`[lcars] fetch failed: ${path}`, e);
    return null;
  }
}

function timeAgo(isoString) {
  if (!isoString) return '—';
  const then = new Date(isoString);
  const diffMs = Date.now() - then.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatTokens(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

function getLast30Days() {
  const labels = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }
  return labels;
}

function addAlert(msg, level = 'warn', projectId = null) {
  state.alerts.push({ msg, level, ts: Date.now(), projectId });
  renderAlerts();
}

function clearAlerts() {
  state.alerts = [];
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const sd = document.getElementById('stardate-display');
  const cl = document.getElementById('clock-display');
  const dl = document.getElementById('date-display');

  if (sd) sd.textContent = getStardate();
  if (cl) {
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    cl.textContent = `${hh}:${mm}:${ss}`;
  }
  if (dl) {
    dl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    }).toUpperCase();
  }
}

// ─── Navigation ──────────────────────────────────────────────────────────────

// Track the previous view so the back button returns correctly
state.previousView = 'railway';

function switchView(viewId) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById(`view-${viewId}`);
  if (viewEl) viewEl.classList.add('active');
  const navBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');
}

function navigateBack() {
  switchView(state.previousView || 'railway');
}

function navigateToProjectDetail(projectId, projectName) {
  state.previousView = (() => {
    const active = document.querySelector('.nav-btn.active');
    return active ? active.dataset.view : 'railway';
  })();
  switchView('project-detail');
  loadProjectDetail(projectId, projectName);
}

function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const viewEl = document.getElementById(`view-${view}`);
      if (viewEl) viewEl.classList.add('active');
      // Trigger data load when switching views
      if (view === 'history')     updateHistory();
      if (view === 'crew')        updateCrewStatus();
      if (view === 'docs')        updateDocs();
      if (view === 'calendar')    updateCalendar();
      if (view === 'investments') updateInvestments();
    });
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function initFilters() {
  // Load from localStorage
  try {
    const saved = localStorage.getItem('lcars:filters');
    if (saved) {
      const parsed = JSON.parse(saved);
      state.filters.hideRemoved = parsed.hideRemoved ?? true;
      state.filters.hideEmptyEnv = parsed.hideEmptyEnv ?? false;
    }
  } catch (e) { /* ignore */ }

  const hideRemovedEl = document.getElementById('filter-hide-removed');
  const hideEmptyEnvEl = document.getElementById('filter-hide-empty-env');

  if (hideRemovedEl) {
    hideRemovedEl.checked = state.filters.hideRemoved;
    hideRemovedEl.addEventListener('change', () => {
      state.filters.hideRemoved = hideRemovedEl.checked;
      saveFilters();
      if (state.lastTopology) renderServiceCards(state.lastTopology, state.lastDeployments, state.lastMetrics);
    });
  }
  if (hideEmptyEnvEl) {
    hideEmptyEnvEl.checked = state.filters.hideEmptyEnv;
    hideEmptyEnvEl.addEventListener('change', () => {
      state.filters.hideEmptyEnv = hideEmptyEnvEl.checked;
      saveFilters();
      if (state.lastTopology) renderServiceCards(state.lastTopology, state.lastDeployments, state.lastMetrics);
    });
  }
}

function saveFilters() {
  try {
    localStorage.setItem('lcars:filters', JSON.stringify(state.filters));
  } catch (e) { /* ignore */ }
}

// ─── Feature Indicators ──────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('/config');
    const config = await res.json();
    state.features = config.features || {};
    document.title = config.title ? `${config.title} — LCARS` : 'LCARS OPS DASHBOARD';

    const map = {
      'conn-railway':   state.features.railway,
      'conn-anthropic': state.features.anthropic,
      'conn-pinecone':  state.features.pinecone,
    };
    Object.entries(map).forEach(([id, on]) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.toggle('active', !!on);
        el.classList.toggle('error', !on);
      }
    });
  } catch (e) {
    console.warn('[lcars] config load failed', e);
  }
}

// ─── Railway: Render Service Cards ───────────────────────────────────────────
function renderServiceCards(topology, deployments, metrics) {
  const grid = document.getElementById('services-grid');
  if (!grid) return;

  if (!topology?.projects?.edges?.length) {
    grid.innerHTML = topology?.error
      ? `<div class="error-msg">${escHtml(topology.error)}</div>`
      : '<div class="not-configured">RAILWAY_API_TOKEN NOT CONFIGURED</div>';
    return;
  }

  const cards = [];
  for (const { node: project } of topology.projects.edges) {
    const projectServices = project.services?.edges ?? [];

    // Filter: hide empty projects (no services)
    if (state.filters.hideEmptyEnv && projectServices.length === 0) continue;

    for (const { node: service } of projectServices) {
      const dep = deployments?.[service.id];
      const met = metrics?.[service.id];
      const status = dep?.status ?? 'UNKNOWN';

      // Filter: hide REMOVED/inactive services
      if (state.filters.hideRemoved && (status === 'REMOVED' || (!dep && status === 'UNKNOWN'))) {
        // If there's no deployment record at all, skip. If explicitly REMOVED, skip.
        if (status === 'REMOVED' || !dep) continue;
      }

      const statusClass = status.toLowerCase();
      const lastDeploy = dep?.createdAt ? timeAgo(dep.createdAt) : '—';
      const deployUrl = dep?.url || dep?.staticUrl;
      const cpu = met?.cpu != null ? `${met.cpu.toFixed(3)} cores` : '—';
      const memMB = met?.memoryGB != null ? `${(met.memoryGB * 1024).toFixed(0)} MB` : '—';
      const netRx = met?.networkRxGB != null ? `${(met.networkRxGB * 1024).toFixed(1)} MB` : '—';
      const railwayProjectUrl = `https://railway.app/project/${escHtml(project.id)}`;

      // Commit info
      const commitHash = dep?.meta?.commitHash ?? dep?.meta?.GIT_COMMIT_SHA ?? '';
      const shortHash = commitHash ? commitHash.slice(0, 7) : '';
      const commitMsg = dep?.meta?.commitMessage ?? dep?.meta?.GIT_COMMIT_MESSAGE ?? '';
      const branch = dep?.meta?.branch ?? dep?.meta?.GIT_BRANCH ?? '';

      cards.push(`
        <div class="service-card status-${statusClass}">
          <div class="service-card-top-stripe"></div>
          <div class="service-card-header">
            <span class="status-dot status-${statusClass}"></span>
            <span class="service-name">${escHtml(service.name.toUpperCase())}</span>
            <span class="service-status badge-${statusClass}">${status}</span>
          </div>
          <div class="service-card-body">
            <div class="metric-row">
              <span class="metric-label">PROJECT</span>
              <span><a href="${railwayProjectUrl}" target="_blank" class="railway-link">${escHtml(project.name)}</a></span>
            </div>
            <div class="metric-row">
              <span class="metric-label">LAST DEPLOY</span>
              <span>${lastDeploy}</span>
            </div>
            ${branch ? `<div class="metric-row">
              <span class="metric-label">BRANCH</span>
              <span style="color:var(--lcars-ice);font-size:11px">${escHtml(branch)}</span>
            </div>` : ''}
            ${commitMsg ? `<div class="metric-row">
              <span class="metric-label">COMMIT</span>
              <span class="commit-msg" title="${escHtml(commitMsg)}">${escHtml(shortHash ? shortHash + ' ' : '')}${escHtml(commitMsg.length > 40 ? commitMsg.slice(0, 40) + '…' : commitMsg)}</span>
            </div>` : ''}
            <div class="metric-row">
              <span class="metric-label">CPU</span>
              <span>${cpu}</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">MEMORY</span>
              <span>${memMB}</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">NET RX</span>
              <span>${netRx}</span>
            </div>
            ${deployUrl ? `<div class="metric-row">
              <span class="metric-label">URL</span>
              <span><a href="${escHtml(deployUrl)}" target="_blank" style="color:var(--lcars-ice)">${escHtml(deployUrl.replace(/^https?:\/\//, ''))}</a></span>
            </div>` : ''}
            <div class="metric-row" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,136,0,0.1)">
              <span class="metric-label">RAILWAY</span>
              <a href="${railwayProjectUrl}" target="_blank" class="railway-link" style="font-size:10px">OPEN PROJECT ↗</a>
            </div>
            <div class="metric-row" style="margin-top:8px">
              <button class="detail-back-btn" style="margin:0;font-size:10px;padding:3px 10px"
                onclick="navigateToProjectDetail('${escHtml(project.id)}', '${escHtml(project.name)}')">
                VIEW DETAILS
              </button>
            </div>
          </div>
        </div>
      `);
    }
  }

  grid.innerHTML = cards.length ? cards.join('') : '<div class="loading-msg">NO SERVICES FOUND (CHECK FILTERS)</div>';
}

// ─── Railway: Deploy Timeline ─────────────────────────────────────────────────
function renderDeployTimeline(deployments) {
  const container = document.getElementById('deploy-timeline');
  if (!container) return;

  if (!deployments || !Object.keys(deployments).length) {
    container.innerHTML = '<div class="loading-msg">NO DEPLOY HISTORY</div>';
    return;
  }

  // Flatten all recent deploys from all services, sort by time desc
  const allDeploys = [];
  for (const [serviceId, svcData] of Object.entries(deployments)) {
    const recent = svcData.recentDeploys ?? [svcData];
    for (const dep of recent) {
      allDeploys.push({
        ...dep,
        serviceName: svcData.serviceName ?? serviceId,
        projectName: svcData.projectName ?? '',
        projectId:   svcData.projectId ?? '',
      });
    }
  }

  allDeploys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const toShow = allDeploys.slice(0, 30);

  const rows = toShow.map(dep => {
    const status = dep.status ?? 'UNKNOWN';
    const statusClass = status.toLowerCase();
    const commitHash = dep.meta?.commitHash ?? dep.meta?.GIT_COMMIT_SHA ?? '';
    const shortHash = commitHash ? commitHash.slice(0, 7) : '';
    const commitMsg = dep.meta?.commitMessage ?? dep.meta?.GIT_COMMIT_MESSAGE ?? '';
    const branch = dep.meta?.branch ?? dep.meta?.GIT_BRANCH ?? '';
    const projectUrl = dep.projectId ? `https://railway.app/project/${escHtml(dep.projectId)}` : null;

    const metaStr = [
      shortHash,
      branch ? `[${branch}]` : '',
      commitMsg ? commitMsg.slice(0, 35) + (commitMsg.length > 35 ? '…' : '') : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="deploy-row status-${statusClass}">
        <span class="status-dot status-${statusClass}"></span>
        <span class="deploy-time">${timeAgo(dep.createdAt)}</span>
        <span class="deploy-svc-col">
          ${projectUrl ? `<a href="${projectUrl}" target="_blank" class="railway-link deploy-project">${escHtml(dep.projectName)}</a>` : `<span class="deploy-project">${escHtml(dep.projectName)}</span>`}
          <span class="deploy-svc">${escHtml(dep.serviceName.toUpperCase())}</span>
        </span>
        <span class="deploy-meta" title="${escHtml(commitMsg)}">${escHtml(metaStr || '—')}</span>
        <span class="deploy-status badge-${statusClass}">${status}</span>
      </div>
    `;
  });

  container.innerHTML = rows.join('');
}

// ─── Railway: Main Update ─────────────────────────────────────────────────────
async function updateRailway() {
  const [topology, deployments, metrics] = await Promise.all([
    fetchJSON('/railway/topology'),
    fetchJSON('/railway/deployments'),
    fetchJSON('/railway/metrics'),
  ]);

  // Cache for filter re-renders
  state.lastTopology   = topology;
  state.lastDeployments = deployments;
  state.lastMetrics    = metrics;

  renderServiceCards(topology, deployments, metrics);
  renderDeployTimeline(deployments);
  updateQuickStats(topology, deployments, metrics);

  // Check for crashed/failed services — include project context
  clearAlerts();
  if (deployments) {
    for (const [id, svc] of Object.entries(deployments)) {
      const label = [svc.projectName, svc.serviceName ?? id].filter(Boolean).join(' / ');
      if (svc.status === 'CRASHED') addAlert(`${label}: CRASHED`, 'error', svc.projectId);
      if (svc.status === 'FAILED') addAlert(`${label}: DEPLOY FAILED`, 'warn', svc.projectId);
    }
  }

  const el = document.getElementById('railway-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;
}

// ─── Quick Stats (right panel) ────────────────────────────────────────────────
function updateQuickStats(topology, deployments, metrics) {
  const container = document.getElementById('quick-stat-items');
  if (!container) return;

  const totalServices = topology?.projects?.edges?.reduce((sum, { node: p }) =>
    sum + (p.services?.edges?.length ?? 0), 0) ?? 0;

  const healthy = Object.values(deployments ?? {}).filter(d => d.status === 'SUCCESS').length;
  const failed  = Object.values(deployments ?? {}).filter(d => ['FAILED','CRASHED'].includes(d.status)).length;
  const active  = topology?.projects?.edges?.length ?? 0;

  container.innerHTML = `
    <div class="quick-stat-item">
      <span class="quick-stat-label">PROJECTS</span>
      <span class="quick-stat-value" style="color:var(--lcars-ice)">${active}</span>
    </div>
    <div class="quick-stat-item">
      <span class="quick-stat-label">SERVICES</span>
      <span class="quick-stat-value" style="color:var(--lcars-ice)">${totalServices}</span>
    </div>
    <div class="quick-stat-item">
      <span class="quick-stat-label">HEALTHY</span>
      <span class="quick-stat-value" style="color:var(--lcars-green)">${healthy}</span>
    </div>
    ${failed > 0 ? `<div class="quick-stat-item">
      <span class="quick-stat-label">DEGRADED</span>
      <span class="quick-stat-value" style="color:var(--lcars-mars)">${failed}</span>
    </div>` : ''}
  `;
}

// ─── AI Usage: Chart ──────────────────────────────────────────────────────────
function renderTokenChart(data) {
  const canvas = document.getElementById('token-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const labels = getLast30Days();

  const datasets = [];

  // Anthropic
  if (data?.anthropic?.available && data.anthropic.buckets?.length) {
    const buckets = data.anthropic.buckets;
    const inputData = labels.map(label => {
      const bucket = buckets.find(b => {
        const d = new Date(b.start_time ?? b.timestamp ?? b.date ?? 0);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) === label;
      });
      if (!bucket) return 0;
      const results = bucket.results ?? bucket.data ?? [bucket];
      return results.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0);
    });
    const outputData = labels.map(label => {
      const bucket = buckets.find(b => {
        const d = new Date(b.start_time ?? b.timestamp ?? b.date ?? 0);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) === label;
      });
      if (!bucket) return 0;
      const results = bucket.results ?? bucket.data ?? [bucket];
      return results.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0);
    });

    datasets.push({
      label: 'ANTHROPIC INPUT',
      data: inputData,
      borderColor: COLORS.orange,
      backgroundColor: 'rgba(255,136,0,0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 2,
    });
    datasets.push({
      label: 'ANTHROPIC OUTPUT',
      data: outputData,
      borderColor: COLORS.gold,
      backgroundColor: 'rgba(255,170,0,0.06)',
      fill: true,
      tension: 0.3,
      pointRadius: 2,
    });
  }

  if (datasets.length === 0) {
    // Show placeholder
    datasets.push({
      label: 'NO DATA',
      data: labels.map(() => 0),
      borderColor: COLORS.dim,
      backgroundColor: 'transparent',
    });
  }

  if (state.tokenChart) state.tokenChart.destroy();

  state.tokenChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: COLORS.sunflower,
            font: { family: 'Antonio', size: 11 },
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: '#111111',
          borderColor: COLORS.orange,
          borderWidth: 1,
          titleColor: COLORS.sunflower,
          bodyColor: COLORS.sunflower,
          titleFont: { family: 'Antonio' },
          bodyFont: { family: 'Antonio' },
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatTokens(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: COLORS.dim,
            font: { family: 'Antonio', size: 10 },
            maxTicksLimit: 10,
          },
          grid: { color: 'rgba(255,136,0,0.08)' },
        },
        y: {
          ticks: {
            color: COLORS.dim,
            font: { family: 'Antonio', size: 10 },
            callback: (v) => formatTokens(v),
          },
          grid: { color: 'rgba(255,136,0,0.08)' },
        },
      },
    },
  });
}

// ─── AI Usage: Summary Cards ──────────────────────────────────────────────────
function renderUsageSummary(data) {
  const container = document.getElementById('usage-summary');
  if (!container) return;

  const cards = [];

  // Anthropic card
  if (data?.anthropic?.available) {
    const buckets = data.anthropic.buckets ?? [];
    let totalInput = 0, totalOutput = 0;
    for (const b of buckets) {
      const results = b.results ?? b.data ?? [b];
      for (const r of results) {
        totalInput  += r.input_tokens  ?? 0;
        totalOutput += r.output_tokens ?? 0;
      }
    }
    const costs = data.anthropic.costs ?? [];
    let totalCost = costs.reduce((sum, c) => sum + (c.total_cost ?? c.amount ?? 0), 0);

    cards.push(`
      <div class="usage-card">
        <div class="usage-card-header">
          <div class="usage-card-dot" style="background:${COLORS.orange}"></div>
          <span class="usage-card-title">ANTHROPIC</span>
        </div>
        <div class="usage-readout">
          <div class="readout-row">
            <span class="readout-label">INPUT (30D)</span>
            <span class="readout-small">${formatTokens(totalInput)}</span>
          </div>
          <div class="readout-row">
            <span class="readout-label">OUTPUT (30D)</span>
            <span class="readout-small">${formatTokens(totalOutput)}</span>
          </div>
          ${totalCost > 0 ? `<div class="readout-row">
            <span class="readout-label">COST (30D)</span>
            <span class="readout-small">$${totalCost.toFixed(2)}</span>
          </div>` : ''}
        </div>
      </div>
    `);
  } else {
    const reason = data?.anthropic?.reason ?? 'Not configured';
    cards.push(`
      <div class="usage-card">
        <div class="usage-card-header">
          <div class="usage-card-dot" style="background:${COLORS.dim}"></div>
          <span class="usage-card-title">ANTHROPIC</span>
        </div>
        <div class="readout-unavail">${escHtml(reason)}</div>
        ${reason.includes('org') || reason.includes('Admin') ? `
          <div style="margin-top:8px;font-size:10px;color:var(--lcars-text-dim)">
            Requires Admin API key (org account)
          </div>` : ''}
      </div>
    `);
  }

  // Gemini — always shows static card
  cards.push(`
    <div class="usage-card">
      <div class="usage-card-header">
        <div class="usage-card-dot" style="background:${COLORS.violet}"></div>
        <span class="usage-card-title">GEMINI</span>
      </div>
      <div class="readout-unavail">NO USAGE API AVAILABLE</div>
      <div style="margin-top:8px">
        <a href="https://aistudio.google.com/" target="_blank"
           style="color:var(--lcars-ice);font-size:11px;letter-spacing:0.08em">
          VIEW IN AI STUDIO ↗
        </a>
      </div>
    </div>
  `);

  container.innerHTML = cards.join('');
}

// ─── AI Usage: Main Update ────────────────────────────────────────────────────
async function updateAIUsage() {
  const data = await fetchJSON('/usage/combined');
  if (!data) return;
  renderTokenChart(data);
  renderUsageSummary(data);

  const el = document.getElementById('ai-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;
}

// ─── Pinecone ─────────────────────────────────────────────────────────────────
async function updatePinecone() {
  const stats = await fetchJSON('/pinecone/stats');
  const container = document.getElementById('pinecone-stats');
  if (!container) return;

  if (!stats?.available) {
    const reason = stats?.reason ?? 'Not configured';
    container.innerHTML = `<div class="not-configured">${escHtml(reason)}</div>`;
    return;
  }

  const fullness = Math.min(100, Math.round((stats.indexFullness ?? 0) * 100));
  const nsEntries = Object.entries(stats.namespaces ?? {});

  const namespaceRows = nsEntries.length
    ? nsEntries.map(([ns, data]) => `
        <tr>
          <td>${escHtml(ns || '(default)')}</td>
          <td>${(data.vectorCount ?? 0).toLocaleString()}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="2" style="color:var(--lcars-text-dim)">NO NAMESPACES</td></tr>';

  container.innerHTML = `
    <div class="pinecone-stat-card">
      <div class="pinecone-big-number">${(stats.totalVectorCount ?? 0).toLocaleString()}</div>
      <div class="pinecone-stat-label">TOTAL VECTORS</div>
    </div>

    <div class="pinecone-stat-card">
      <div class="pinecone-big-number">${stats.dimension ?? '—'}</div>
      <div class="pinecone-stat-label">DIMENSIONS</div>
    </div>

    <div class="pinecone-stat-card">
      <div class="pinecone-big-number" style="font-size:36px">${fullness}%</div>
      <div class="pinecone-stat-label">INDEX FULLNESS</div>
      <div class="fullness-gauge">
        <div class="fullness-gauge-fill" style="width:${fullness}%"></div>
      </div>
    </div>

    <div class="pinecone-stat-card" style="grid-column: span 2">
      <div class="pinecone-stat-label" style="margin-bottom:8px">
        INDEX: ${escHtml(stats.indexName ?? '—')} &nbsp;|&nbsp;
        STATUS: <span style="color:${stats.status === 'ready' ? 'var(--lcars-green)' : 'var(--lcars-gold)'}">
          ${(stats.status ?? '—').toUpperCase()}
        </span>
      </div>
      <table class="pinecone-namespace-table">
        <thead><tr><th>NAMESPACE</th><th>VECTORS</th></tr></thead>
        <tbody>${namespaceRows}</tbody>
      </table>
    </div>
  `;

  const el = document.getElementById('pinecone-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;
}

// ─── History Charts ───────────────────────────────────────────────────────────

function renderDeployHistoryChart(historyDays) {
  const canvas = document.getElementById('deploy-history-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels   = historyDays.map(d => d.date.slice(5)); // MM-DD
  const totals   = historyDays.map(d => d.total);

  // Collect all unique projects across all days
  const projectNames = [...new Set(
    historyDays.flatMap(d => Object.keys(d.byProject ?? {}))
  )];

  const projectColors = [
    COLORS.orange, COLORS.ice, COLORS.violet, COLORS.gold, COLORS.green,
    COLORS.butterscotch, COLORS.almond, COLORS.tomato,
  ];

  const datasets = projectNames.length > 1
    ? projectNames.map((name, i) => ({
        label: name.toUpperCase(),
        data: historyDays.map(d => d.byProject?.[name] ?? 0),
        borderColor: projectColors[i % projectColors.length],
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 4,
      }))
    : [{
        label: 'DEPLOYS',
        data: totals,
        borderColor: COLORS.orange,
        backgroundColor: 'rgba(255,136,0,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
      }];

  if (state.deployHistoryChart) state.deployHistoryChart.destroy();

  state.deployHistoryChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: COLORS.sunflower, font: { family: 'Antonio', size: 11 }, padding: 16 },
        },
        tooltip: {
          backgroundColor: '#111111',
          borderColor: COLORS.gold,
          borderWidth: 1,
          titleColor: COLORS.sunflower,
          bodyColor: COLORS.sunflower,
          titleFont: { family: 'Antonio' },
          bodyFont: { family: 'Antonio' },
        },
      },
      scales: {
        x: {
          ticks: { color: COLORS.dim, font: { family: 'Antonio', size: 12 } },
          grid: { color: 'rgba(255,170,0,0.08)' },
        },
        y: {
          ticks: {
            color: COLORS.dim,
            font: { family: 'Antonio', size: 12 },
            stepSize: 1,
            precision: 0,
          },
          grid: { color: 'rgba(255,170,0,0.08)' },
        },
      },
    },
  });
}

async function updateHistory() {
  const railwayHistory = await fetchJSON('/railway/history?days=7');
  if (railwayHistory) renderDeployHistoryChart(railwayHistory);

  const el = document.getElementById('history-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;
}

// ─── Crew Status ──────────────────────────────────────────────────────────────

const CREW_ACCENT = {
  orange:      '#ff8800',
  ice:         '#99ccff',
  tomato:      '#ff5555',
  violet:      '#cc99ff',
  gold:        '#ffaa00',
  green:       '#779933',
};

async function updateCrewStatus() {
  const data = await fetchJSON('/crew/status');
  const container = document.getElementById('crew-grid');
  if (!container) return;

  if (!data) {
    container.innerHTML = '<div class="loading-msg">UNABLE TO REACH CREW STATUS ENDPOINT</div>';
    return;
  }

  if (!data.available) {
    container.innerHTML = `<div class="not-configured">${escHtml(data.reason ?? 'Crew status unavailable')}</div>`;
    const el = document.getElementById('crew-last-updated');
    if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;
    return;
  }

  const cards = (data.members ?? []).map(member => {
    const accent = CREW_ACCENT[member.accentColor] || CREW_ACCENT.orange;
    const statusLabel = { ok: 'ACTIVE', stale: 'STALE', pending: 'NO DATA' }[member.status] ?? 'UNKNOWN';
    const lastMsgTs = member.lastMessage?.timestamp
      ? timeAgo(member.lastMessage.timestamp)
      : null;

    const msgBlock = member.lastMessage
      ? `<div class="crew-card-last-msg">
          <div class="crew-card-msg-meta">LAST REPORT &nbsp;·&nbsp; ${escHtml(lastMsgTs ?? '—')}</div>
          <div class="crew-card-msg-content">${escHtml(member.lastMessage.content || '(no content)')}</div>
        </div>`
      : `<div class="crew-card-no-activity">NO RECENT ACTIVITY FOUND</div>`;

    return `
      <div class="crew-card">
        <div class="crew-card-stripe" style="background:${accent}"></div>
        <div class="crew-card-header">
          <span class="crew-card-name">${escHtml(member.name)}</span>
          <span class="crew-status-badge ${member.status}">${statusLabel}</span>
        </div>
        <div class="crew-card-body">
          <div class="crew-card-role">${escHtml(member.role)}</div>
          <div class="crew-card-schedule">⏱ ${escHtml(member.schedule)}</div>
          ${msgBlock}
        </div>
      </div>
    `;
  });

  container.innerHTML = cards.length ? cards.join('') : '<div class="loading-msg">NO CREW MEMBERS CONFIGURED</div>';

  const el = document.getElementById('crew-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;
}

// ─── System View ──────────────────────────────────────────────────────────────
async function updateSystem() {
  const container = document.getElementById('system-info');
  if (!container) return;

  const health = await fetchJSON('/health');
  const uptime = health?.uptime ? formatUptime(health.uptime) : '—';

  container.innerHTML = `
    <div class="system-card">
      <div class="system-card-title">SERVER STATUS</div>
      <div class="metric-row">
        <span class="metric-label">STATUS</span>
        <span style="color:var(--lcars-green)">${health?.status ?? '—'}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">UPTIME</span>
        <span>${uptime}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">VERSION</span>
        <span>${health?.version ?? '1.0.0'}</span>
      </div>
    </div>

    <div class="system-card">
      <div class="system-card-title">INTEGRATIONS</div>
      ${Object.entries(state.features).map(([name, enabled]) => `
        <div class="metric-row">
          <span class="metric-label">${name.toUpperCase()}</span>
          <span style="color:${enabled ? 'var(--lcars-green)' : 'var(--lcars-text-dim)'}">
            ${enabled ? 'CONNECTED' : 'NOT CONFIGURED'}
          </span>
        </div>
      `).join('')}
    </div>

    <div class="system-card">
      <div class="system-card-title">DASHBOARD</div>
      <div class="metric-row">
        <span class="metric-label">STARDATE</span>
        <span>${getStardate()}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">LAST REFRESH</span>
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  `;
}

function formatUptime(secs) {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// ─── Alerts (right panel) ─────────────────────────────────────────────────────
function renderAlerts() {
  const list = document.getElementById('alert-list');
  const none = document.getElementById('alert-none');
  if (!list) return;

  if (state.alerts.length === 0) {
    if (none) none.style.display = '';
    list.innerHTML = '';
    return;
  }

  if (none) none.style.display = 'none';
  list.innerHTML = state.alerts.map(a => {
    const link = a.projectId
      ? `<a href="https://railway.app/project/${escHtml(a.projectId)}" target="_blank" class="alert-link">↗</a>`
      : '';
    return `
      <div class="alert-item">
        <span>⚠</span>
        <span>${escHtml(a.msg)}${link ? ' ' + link : ''}</span>
      </div>
    `;
  }).join('');
}

// ─── XSS safety ──────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Project Detail View ─────────────────────────────────────────────────────

async function loadProjectDetail(projectId, projectName) {
  const titleEl = document.getElementById('project-detail-title');
  if (titleEl) titleEl.textContent = `PROJECT — ${(projectName || '').toUpperCase()}`;

  // Set loading state
  const serviceEl  = document.getElementById('project-detail-services');
  const metricsEl  = document.getElementById('project-detail-metrics');
  const logsEl     = document.getElementById('project-detail-logs');
  const deploysEl  = document.getElementById('project-detail-deploys');
  const commitsEl  = document.getElementById('project-detail-commits');

  if (serviceEl)  serviceEl.innerHTML  = '<div class="loading-msg">SCANNING SERVICES…</div>';
  if (metricsEl)  metricsEl.innerHTML  = '';
  if (logsEl)     logsEl.innerHTML     = '<div class="loading-msg">RETRIEVING DEPLOYMENT LOGS…</div>';
  if (deploysEl)  deploysEl.innerHTML  = '<div class="loading-msg">LOADING DEPLOY HISTORY…</div>';
  if (commitsEl)  commitsEl.innerHTML  = '<div class="loading-msg">CHECKING COMMIT HISTORY…</div>';

  const data = await fetchJSON(`/project-detail/${encodeURIComponent(projectId)}`);

  if (!data) {
    if (serviceEl) serviceEl.innerHTML = '<div class="error-msg">FAILED TO LOAD PROJECT DETAIL</div>';
    return;
  }

  renderProjectServices(data, serviceEl, metricsEl);
  renderProjectLogs(data, logsEl);
  renderProjectDeploys(data, deploysEl);
  renderProjectCommits(data, commitsEl);
}

function renderProjectServices(data, serviceEl, metricsEl) {
  if (!serviceEl) return;
  const services = data.services ?? [];

  if (!services.length) {
    serviceEl.innerHTML = '<div class="loading-msg">NO SERVICES FOUND FOR THIS PROJECT</div>';
    return;
  }

  // Service status cards
  const cards = services.map(svc => {
    const status = svc.status ?? 'UNKNOWN';
    const statusClass = status.toLowerCase();
    const lastDeploy = svc.lastDeploy ? timeAgo(svc.lastDeploy) : '—';
    const deployUrl = svc.deployUrl;
    const shortHash = svc.commitHash ? svc.commitHash.slice(0, 7) : '';
    const commitMsg = svc.commitMsg ?? '';

    return `
      <div class="service-card status-${statusClass}">
        <div class="service-card-top-stripe"></div>
        <div class="service-card-header">
          <span class="status-dot status-${statusClass}"></span>
          <span class="service-name">${escHtml(svc.name.toUpperCase())}</span>
          <span class="service-status badge-${statusClass}">${status}</span>
        </div>
        <div class="service-card-body">
          <div class="metric-row">
            <span class="metric-label">LAST DEPLOY</span>
            <span>${lastDeploy}</span>
          </div>
          ${svc.branch ? `<div class="metric-row">
            <span class="metric-label">BRANCH</span>
            <span style="color:var(--lcars-ice);font-size:11px">${escHtml(svc.branch)}</span>
          </div>` : ''}
          ${commitMsg ? `<div class="metric-row">
            <span class="metric-label">COMMIT</span>
            <span class="commit-msg" title="${escHtml(commitMsg)}">${escHtml(shortHash ? shortHash + ' ' : '')}${escHtml(commitMsg.length > 45 ? commitMsg.slice(0, 45) + '…' : commitMsg)}</span>
          </div>` : ''}
          ${svc.githubRepo ? `<div class="metric-row">
            <span class="metric-label">REPO</span>
            <span style="font-size:11px;color:var(--lcars-text-dim)">${escHtml(svc.githubRepo)}</span>
          </div>` : ''}
          ${deployUrl ? `<div class="metric-row">
            <span class="metric-label">URL</span>
            <span><a href="${escHtml(deployUrl)}" target="_blank" style="color:var(--lcars-ice);font-size:11px">${escHtml(deployUrl.replace(/^https?:\/\//, ''))}</a></span>
          </div>` : ''}
        </div>
      </div>
    `;
  });
  serviceEl.innerHTML = cards.join('');

  // Metrics cards
  if (!metricsEl) return;
  const metricCards = services
    .filter(svc => svc.metrics)
    .map(svc => {
      const m = svc.metrics;
      const cpu    = m.cpu    != null ? `${m.cpu.toFixed(3)} cores`          : '—';
      const mem    = m.memoryGB   != null ? `${(m.memoryGB * 1024).toFixed(0)} MB`    : '—';
      const netRx  = m.networkRx  != null ? `${(m.networkRx * 1024).toFixed(1)} MB`   : '—';
      const netTx  = m.networkTx  != null ? `${(m.networkTx * 1024).toFixed(1)} MB`   : '—';
      const disk   = m.diskGB     != null ? `${(m.diskGB * 1024).toFixed(0)} MB`      : '—';

      return `
        <div class="detail-metric-card">
          <div class="detail-metric-card-title">${escHtml(svc.name.toUpperCase())} — RESOURCES</div>
          <div class="metric-row">
            <span class="metric-label">CPU</span>
            <span>${cpu}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">MEMORY</span>
            <span>${mem}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">NET RX</span>
            <span>${netRx}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">NET TX</span>
            <span>${netTx}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">DISK</span>
            <span>${disk}</span>
          </div>
        </div>
      `;
    });

  metricsEl.innerHTML = metricCards.length
    ? metricCards.join('')
    : '<div class="loading-msg" style="grid-column:1/-1">NO RESOURCE METRICS AVAILABLE (DEPLOYMENT NOT RUNNING OR METRICS NOT YET POLLED)</div>';
}

function renderProjectLogs(data, logsEl) {
  if (!logsEl) return;
  const services = data.services ?? [];
  const logs = data.logs ?? {};

  const panels = services.map(svc => {
    const lines = logs[svc.id] ?? [];
    const content = lines.length
      ? lines.map(l =>
          `<span class="deploy-log-line-ts">${escHtml(l.ts)}</span>${escHtml(l.message)}`
        ).join('\n')
      : '<span style="color:var(--lcars-text-dim)">NO LOG DATA AVAILABLE FOR THIS DEPLOYMENT</span>';

    return `
      <div class="deploy-log-panel">
        <div class="deploy-log-title">DEPLOYMENT LOG — ${escHtml(svc.name.toUpperCase())}</div>
        <div class="deploy-log-lines">${content}</div>
      </div>
    `;
  });

  logsEl.innerHTML = panels.length ? panels.join('') : '<div class="loading-msg">NO SERVICES WITH LOGS</div>';
}

function renderProjectDeploys(data, deploysEl) {
  if (!deploysEl) return;
  const services = data.services ?? [];

  const allDeploys = [];
  for (const svc of services) {
    for (const dep of (svc.recentDeploys ?? [])) {
      allDeploys.push({ ...dep, serviceName: svc.name });
    }
  }
  allDeploys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!allDeploys.length) {
    deploysEl.innerHTML = '<div class="loading-msg">NO DEPLOY HISTORY</div>';
    return;
  }

  const rows = allDeploys.slice(0, 30).map(dep => {
    const status = dep.status ?? 'UNKNOWN';
    const statusClass = status.toLowerCase();
    const commitHash = dep.meta?.commitHash ?? dep.meta?.GIT_COMMIT_SHA ?? '';
    const shortHash = commitHash ? commitHash.slice(0, 7) : '';
    const commitMsg = dep.meta?.commitMessage ?? dep.meta?.GIT_COMMIT_MESSAGE ?? '';
    const branch = dep.meta?.branch ?? dep.meta?.GIT_BRANCH ?? '';

    const metaStr = [
      shortHash,
      branch ? `[${branch}]` : '',
      commitMsg ? commitMsg.slice(0, 40) + (commitMsg.length > 40 ? '…' : '') : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="deploy-row status-${statusClass}">
        <span class="status-dot status-${statusClass}"></span>
        <span class="deploy-time">${timeAgo(dep.createdAt)}</span>
        <span class="deploy-svc-col">
          <span class="deploy-svc">${escHtml((dep.serviceName || '').toUpperCase())}</span>
        </span>
        <span class="deploy-meta" title="${escHtml(commitMsg)}">${escHtml(metaStr || '—')}</span>
        <span class="deploy-status badge-${statusClass}">${status}</span>
      </div>
    `;
  });

  deploysEl.innerHTML = rows.join('');
}

function renderProjectCommits(data, commitsEl) {
  if (!commitsEl) return;

  if (!data.githubAvailable) {
    commitsEl.innerHTML = `<div class="not-configured">${escHtml(data.githubNote ?? 'GITHUB COMMITS UNAVAILABLE')}</div>`;
    return;
  }

  // Future: render commit rows when GitHub token support is added
  commitsEl.innerHTML = '<div class="loading-msg">NO COMMIT DATA</div>';
}

// ─── Docs View ────────────────────────────────────────────────────────────────
async function updateDocs() {
  const container = document.getElementById('docs-list');
  if (!container) return;

  const data = await fetchJSON('/docs');
  const el = document.getElementById('docs-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;

  if (!data || !data.files || data.files.length === 0) {
    container.innerHTML = '<div class="not-configured">NO DOCUMENTS FOUND</div>';
    return;
  }

  const extIcon = (name) => {
    if (name.endsWith('.md'))   return '📄';
    if (name.endsWith('.json')) return '📋';
    if (name.endsWith('.txt'))  return '📝';
    if (name.endsWith('.pdf'))  return '📕';
    return '📁';
  };

  const rows = data.files.map(f => `
    <div class="doc-item">
      <span class="doc-icon">${extIcon(f.name)}</span>
      <div class="doc-info">
        <div class="doc-name">${escHtml(f.name)}</div>
        <div class="doc-meta">${escHtml(f.modified || '—')}</div>
      </div>
      <span class="doc-size">${escHtml(f.size || '')}</span>
    </div>
  `);

  container.innerHTML = rows.join('');
}

// ─── Calendar View ────────────────────────────────────────────────────────────
async function updateCalendar() {
  const container = document.getElementById('calendar-grid');
  if (!container) return;

  const data = await fetchJSON('/crons');
  const el = document.getElementById('calendar-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;

  if (!data || !data.jobs || data.jobs.length === 0) {
    container.innerHTML = '<div class="not-configured">NO CRON JOBS CONFIGURED</div>';
    return;
  }

  const cards = data.jobs.map(job => {
    const enabled = job.enabled !== false;
    const name    = job.name || job.id || 'UNNAMED JOB';
    const sched   = job.schedule || job.cron || '—';
    const desc    = job.description || job.payload?.text || '—';
    const next    = job.nextRun ? `NEXT: ${new Date(job.nextRun).toLocaleString()}` : '';

    return `
      <div class="cron-card">
        <div class="cron-card-name">${escHtml(name.toUpperCase())}</div>
        <span class="cron-enabled-badge ${enabled ? 'on' : 'off'}">${enabled ? 'ACTIVE' : 'DISABLED'}</span>
        <div class="cron-card-schedule">${escHtml(sched)}</div>
        ${desc !== '—' ? `<div class="cron-card-desc">${escHtml(desc)}</div>` : ''}
        ${next ? `<div class="cron-next">⏱ ${escHtml(next)}</div>` : ''}
      </div>
    `;
  });

  container.innerHTML = cards.join('');
}

// ─── Investments View ─────────────────────────────────────────────────────────
async function updateInvestments() {
  const container = document.getElementById('investments-grid');
  if (!container) return;

  const data = await fetchJSON('/investments');
  const el = document.getElementById('investments-last-updated');
  if (el) el.textContent = `UPDATED ${new Date().toLocaleTimeString()}`;

  if (!data || !data.proposals || data.proposals.length === 0) {
    container.innerHTML = '<div class="not-configured">NO INVESTMENT PROPOSALS LOADED<br><span style="font-size:11px;margin-top:8px;display:block;color:var(--lcars-text-dim)">Connect a data source to populate proposals.</span></div>';
    return;
  }

  const badgeClass = (action) => {
    const a = (action || '').toLowerCase();
    if (a.includes('buy'))   return 'buy';
    if (a.includes('sell'))  return 'sell';
    if (a.includes('hold'))  return 'hold';
    return 'watch';
  };

  const cards = data.proposals.map(p => `
    <div class="invest-card">
      <div class="invest-card-header">
        <div>
          <div class="invest-card-ticker">${escHtml(p.ticker || p.symbol || '—')}</div>
          <div class="invest-card-name">${escHtml(p.name || '')}</div>
        </div>
        <span class="invest-card-badge ${badgeClass(p.action)}">${escHtml((p.action || 'WATCH').toUpperCase())}</span>
      </div>
      <div class="invest-card-body">
        ${p.source ? `<div class="invest-source">SOURCE: ${escHtml(p.source)}</div>` : ''}
        ${p.thesis ? `<div class="invest-thesis">${escHtml(p.thesis)}</div>` : ''}
        ${p.price  ? `<div class="metric-row"><span class="metric-label">PRICE</span><span>${escHtml(String(p.price))}</span></div>` : ''}
        ${p.target ? `<div class="metric-row"><span class="metric-label">TARGET</span><span style="color:var(--lcars-green)">${escHtml(String(p.target))}</span></div>` : ''}
        ${p.risk   ? `<div class="metric-row"><span class="metric-label">RISK</span><span style="color:var(--lcars-gold)">${escHtml(p.risk)}</span></div>` : ''}
      </div>
    </div>
  `);

  container.innerHTML = cards.join('');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function init() {
  initNav();
  initFilters();
  updateClock();
  setInterval(updateClock, 1000);

  await loadConfig();

  // Initial data load
  await Promise.all([
    updateRailway(),
    updateAIUsage(),
    updatePinecone(),
    updateSystem(),
    updateHistory(),
    updateCrewStatus(),
  ]);

  // Periodic polling
  setInterval(updateRailway,     POLL_RAILWAY_MS);
  setInterval(updateAIUsage,     POLL_AI_USAGE_MS);
  setInterval(updatePinecone,    POLL_PINECONE_MS);
  setInterval(updateSystem,      60_000);
  setInterval(updateHistory,     POLL_AI_USAGE_MS); // same cadence as AI usage (5 min)
  setInterval(updateCrewStatus,  POLL_AI_USAGE_MS); // 5 min

  console.log('[lcars] Dashboard online. Stardate:', getStardate());
}

document.addEventListener('DOMContentLoaded', init);
