const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const app = $('#app');

const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async put(url, body) { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async del(url) { const r = await fetch(url, { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); },
};

function toast(msg, duration = 3000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function timeAgo(date) {
  if (!date) return 'never';
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

// --- Pages ---

async function renderDashboard() {
  const { agents } = await api.get('/api/agents');
  if (agents.length === 0) {
    app.innerHTML = `<div class="empty-state"><h3>No agents yet</h3><p>Create your first agent to get started.</p><br><a href="#/agents/new" class="btn btn-primary">+ Create Agent</a></div>`;
    return;
  }
  app.innerHTML = `<h1>Agents</h1><div class="card-grid">${agents.map(a => `
    <div class="card" onclick="location.hash='/agents/${a.id}'">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>${esc(a.displayName)}</h3>
        <span class="badge badge-${a.status || 'idle'}">${a.status || 'idle'}</span>
      </div>
      <div class="desc">${esc(a.description || 'No description')}</div>
      <div class="meta">
        <span>${a.enabled !== false ? '🟢 Enabled' : '🔴 Disabled'}</span>
        <span>${a.slackChannels?.length || 0} channels</span>
        <span>${a.slackUsers?.length || 0} users</span>
      </div>
    </div>
  `).join('')}</div>`;
}

async function renderAgentDetail(id) {
  let agent;
  try {
    const data = await api.get(`/api/agents/${id}`);
    agent = data.agent;
  } catch {
    app.innerHTML = `<h1>Agent not found</h1><a href="#/">← Back</a>`;
    return;
  }

  let usageHtml = '';
  try {
    const { usage } = await api.get(`/api/agents/${id}/usage?period=day`);
    if (usage && usage.length > 0) {
      const maxTokens = Math.max(...usage.map(u => u.totalTokens), 1);
      usageHtml = `
        <h2>Usage (Last 30 days)</h2>
        <div class="chart-container">
          <div class="bar-chart">
            ${usage.slice(-14).map(u => `
              <div class="bar-group">
                <div class="bar input" style="height:${(u.inputTokens / maxTokens) * 160}px" title="Input: ${formatNumber(u.inputTokens)}"></div>
                <div class="bar output" style="height:${(u.outputTokens / maxTokens) * 160}px" title="Output: ${formatNumber(u.outputTokens)}"></div>
                <div class="bar-label">${u.period.slice(5)}</div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:12px;font-size:12px;color:var(--text-dim)">
            <span style="color:var(--accent)">■</span> Input &nbsp;
            <span style="color:var(--green)">■</span> Output
          </div>
        </div>`;
    }
  } catch { /* usage not available */ }

  app.innerHTML = `
    <div class="detail-header">
      <div><a href="#/" style="color:var(--text-dim);font-size:13px">← Back</a><h1 style="margin-top:8px">${esc(agent.displayName)}</h1></div>
      <div class="actions">
        <button class="btn btn-secondary" onclick="toggleAgent('${id}', ${agent.enabled !== false})">${agent.enabled !== false ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-danger" onclick="deleteAgent('${id}')">Delete</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab active" data-tab="config">Config</button>
      <button class="tab" data-tab="agents-md">AGENTS.md</button>
      <button class="tab" data-tab="usage">Usage</button>
    </div>
    <div id="tab-config">
      <div class="form-group"><label>ID</label><input value="${esc(agent.id)}" disabled></div>
      <div class="form-group"><label>Display Name</label><input id="f-displayName" value="${esc(agent.displayName)}"></div>
      <div class="form-group"><label>Description</label><input id="f-description" value="${esc(agent.description || '')}"></div>
      <div class="form-group"><label>Model</label><input id="f-model" value="${esc(agent.model || '')}"></div>
      <div class="form-group"><label>Slack Channels (comma-sep)</label><input id="f-channels" value="${esc((agent.slackChannels || []).join(', '))}"></div>
      <div class="form-group"><label>Slack Users (comma-sep)</label><input id="f-users" value="${esc((agent.slackUsers || []).join(', '))}"></div>
      <button class="btn btn-primary" onclick="saveAgent('${id}')">Save Changes</button>
    </div>
    <div id="tab-agents-md" style="display:none">
      <div class="form-group"><textarea id="f-agentsMd" style="min-height:300px;font-family:monospace">${esc(agent.agentsMd || '(loading...)')}</textarea></div>
      <button class="btn btn-primary" onclick="saveAgentsMd('${id}')">Save AGENTS.md</button>
    </div>
    <div id="tab-usage" style="display:none">${usageHtml || '<div class="empty-state"><p>No usage data yet.</p></div>'}</div>
  `;

  // Load AGENTS.md content
  try {
    const r = await fetch(`/api/agents/${id}/agents-md`);
    if (r.ok) {
      const { content } = await r.json();
      const ta = $('#f-agentsMd');
      if (ta) ta.value = content;
    }
  } catch { /* ok */ }

  // Tab switching
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      ['config', 'agents-md', 'usage'].forEach(t => {
        const el = $(`#tab-${t}`);
        if (el) el.style.display = tab.dataset.tab === t ? '' : 'none';
      });
    });
  });
}

async function renderCreateAgent() {
  app.innerHTML = `
    <h1>Create New Agent</h1>
    <div class="form-group"><label>ID (lowercase, no spaces)</label><input id="f-id" placeholder="my-agent"></div>
    <div class="form-group"><label>Display Name</label><input id="f-displayName" placeholder="My Agent"></div>
    <div class="form-group"><label>Description</label><input id="f-description" placeholder="What does this agent do?"></div>
    <div class="form-group"><label>Model (optional)</label><input id="f-model" placeholder=""></div>
    <div class="form-group"><label>Slack Channels (comma-sep)</label><input id="f-channels" placeholder="C12345, C67890"></div>
    <div class="form-group"><label>Slack Users (comma-sep)</label><input id="f-users" placeholder="U12345"></div>
    <div class="form-group"><label>AGENTS.md Initial Content</label><textarea id="f-agentsMd" placeholder="# My Agent\n\nYou are a helpful assistant.">
# Agent Instructions

You are a helpful AI assistant.
</textarea></div>
    <button class="btn btn-primary" onclick="createAgent()">Create Agent</button>
    <a href="#/" class="btn btn-secondary" style="margin-left:8px">Cancel</a>
  `;
}

async function renderHealth() {
  const data = await api.get('/api/health');
  let summaryHtml = '';
  try {
    const { summary } = await api.get('/api/usage/summary');
    if (summary && summary.length > 0) {
      summaryHtml = `<h2 style="margin-top:24px">Usage Summary</h2><div class="card-grid">${summary.map(s => `
        <div class="card" style="cursor:default">
          <h3>${esc(s.agentId)}</h3>
          <div class="meta" style="flex-direction:column;gap:4px;margin-top:8px">
            <span>Input: ${formatNumber(s.totalInputTokens)} tokens</span>
            <span>Output: ${formatNumber(s.totalOutputTokens)} tokens</span>
            <span>Total: ${formatNumber(s.totalTokens)} tokens</span>
            <span>${s.recordCount} requests</span>
          </div>
        </div>
      `).join('')}</div>`;
    }
  } catch { /* ok */ }

  app.innerHTML = `
    <h1>System Health</h1>
    <div class="health-grid">
      <div class="health-item"><div class="value" style="color:${data.status === 'ok' ? 'var(--green)' : 'var(--red)'}">${data.status === 'ok' ? '✓' : '✗'}</div><div class="label">Status</div></div>
      <div class="health-item"><div class="value">${data.slackConnected ? '✓' : '✗'}</div><div class="label">Slack</div></div>
      <div class="health-item"><div class="value">${data.agentCount}</div><div class="label">Agents</div></div>
      <div class="health-item"><div class="value">${formatNumber(data.uptimeSec)}s</div><div class="label">Uptime</div></div>
    </div>
    ${summaryHtml}
  `;
}

// --- Actions ---

window.saveAgent = async function(id) {
  try {
    const split = v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
    await api.put(`/api/agents/${id}`, {
      displayName: $('#f-displayName').value,
      description: $('#f-description').value || undefined,
      model: $('#f-model').value || undefined,
      slackChannels: split($('#f-channels').value),
      slackUsers: split($('#f-users').value),
    });
    toast('Agent saved!');
  } catch (e) { toast('Error: ' + e.message); }
};

window.saveAgentsMd = async function(id) {
  try {
    await api.put(`/api/agents/${id}`, { agentsMd: $('#f-agentsMd').value });
    toast('AGENTS.md saved!');
  } catch (e) { toast('Error: ' + e.message); }
};

window.toggleAgent = async function(id, currentlyEnabled) {
  try {
    await api.put(`/api/agents/${id}`, { enabled: !currentlyEnabled });
    toast(currentlyEnabled ? 'Agent disabled' : 'Agent enabled');
    route();
  } catch (e) { toast('Error: ' + e.message); }
};

window.deleteAgent = async function(id) {
  if (!confirm(`Delete agent "${id}"? This cannot be undone.`)) return;
  try {
    await api.del(`/api/agents/${id}`);
    toast('Agent deleted');
    location.hash = '#/';
  } catch (e) { toast('Error: ' + e.message); }
};

window.createAgent = async function() {
  try {
    const split = v => v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
    await api.post('/api/agents', {
      id: $('#f-id').value,
      displayName: $('#f-displayName').value,
      agentsMd: $('#f-agentsMd').value,
      slackChannels: split($('#f-channels').value),
      slackUsers: split($('#f-users').value),
      model: $('#f-model').value || undefined,
      description: $('#f-description').value || undefined,
    });
    toast('Agent created!');
    location.hash = '#/';
  } catch (e) { toast('Error: ' + e.message); }
};

function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// --- Router ---

async function route() {
  const hash = location.hash || '#/';
  // Update active nav link
  $$('nav a[data-nav]').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === hash);
  });

  try {
    if (hash === '#/' || hash === '#') {
      await renderDashboard();
    } else if (hash === '#/agents/new') {
      await renderCreateAgent();
    } else if (hash.startsWith('#/agents/')) {
      await renderAgentDetail(hash.slice('#/agents/'.length));
    } else if (hash === '#/health') {
      await renderHealth();
    } else {
      app.innerHTML = '<h1>Not found</h1>';
    }
  } catch (e) {
    app.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${esc(e.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', route);
route();
