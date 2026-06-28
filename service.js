'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const MAIN_WF_ID = 'CQCLdVdNwrmvI5do';

// ── Global state ──────────────────────────────────────────────────────────────
let dashboardData = null;   // cached payload from /api/data
let activeDays = 1;
let logPageNum = 1;
const LOG_PAGE_SIZE = 50;
let allLogs = [];
let allLogExecMap = {};
let allLogChatSet = new Set();
let allSessions = [];
let charts = {};

// ── Format helpers ────────────────────────────────────────────────────────────
function fmt(n, dec=1) { if (n == null) return '—'; return Number(n).toFixed(dec); }
function fmtDuration(ms) { if (!ms || ms < 1000) return '—'; if (ms < 60000) return Math.round(ms/1000)+'s'; if (ms < 3600000) return Math.round(ms/60000)+'m'; return fmt(ms/3600000,1)+'h'; }
function fmtK(n) { if (n == null) return '—'; return n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n); }
function fmtMs(ms) { if (!ms) return '—'; return ms >= 1000 ? (ms/1000).toFixed(1)+'s' : ms+'ms'; }
function fmtThb(n) { if (n == null) return '—'; return '฿'+Number(n).toFixed(4); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function toLocalDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

const fmtId = (v, n=8) => String(v ?? '—').slice(-n);

function normalizeWfName(raw) {
  if (!raw || /^\s*$/.test(raw) || /^unknown$/i.test(raw.trim())) return null;
  if (/advis/i.test(raw))               return 'Advisor';
  if (/educ/i.test(raw))                return 'Education';
  if (/summar/i.test(raw))              return 'Summary';
  if (/classif|intent/i.test(raw))      return 'Classification';
  if (/input.?guard/i.test(raw))        return 'Input Guardrail';
  if (/output.?guard/i.test(raw))       return 'Output Guardrail';
  return raw.trim();
}

function routeBadge(r) {
  const norm = (r||'').toLowerCase();
  const m = {advisor:'badge-blue',education:'badge-teal',summary:'badge-purple',unknown:'badge-amber'};
  return `<span class="badge ${m[norm]||'badge-neutral'}">${escHtml(r||'—')}</span>`;
}

function statusBadge(s) {
  const m = {success:'badge-green',error:'badge-red',guardrail_blocked:'badge-amber'};
  return `<span class="badge ${m[s]||'badge-neutral'}">${escHtml(s||'—')}</span>`;
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
const CHART_COLORS = ['#4f8ef7','#34c77b','#f59e0b','#f05252','#2dd4bf','#a78bfa','#fb923c'];
const baseOpts = {
  plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:'#1e2535', titleColor:'#e8eaf0', bodyColor:'#8b93a8', borderColor:'rgba(255,255,255,.1)', borderWidth:1 } },
  scales:{ x:{ grid:{ color:'rgba(255,255,255,.04)' }, ticks:{ color:'#5a6278', font:{ size:10 } } }, y:{ grid:{ color:'rgba(255,255,255,.04)' }, ticks:{ color:'#5a6278', font:{ size:10 } } } }
};

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
function mkChart(id, cfg) { destroyChart(id); const el = document.getElementById(id); if (!el) return; charts[id] = new Chart(el, cfg); }

// ── Date range ────────────────────────────────────────────────────────────────
function setDateRange(days) {
  activeDays = days;
  document.querySelectorAll('.date-pill').forEach(p => p.classList.toggle('active', +p.dataset.days === days));
  if (dashboardData) renderAll();
}

function getStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - activeDays + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Tab control ───────────────────────────────────────────────────────────────
function switchTab(id) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
  if (dashboardData) _renderTab(id, getStartDate());
}

function _renderTab(id, since) {
  const tabFns = {
    overview:    () => loadOverview(since),
    sessions:    () => loadSessions(since),
    ai:          () => loadAI(since),
    subworkflow: () => loadSubworkflows(since),
    guardrails:  () => loadGuardrails(since),
    routing:     () => loadRouting(since),
    errors:      () => loadErrors(since),
    logs:        () => loadLogs(),
  };
  try { tabFns[id]?.(); } catch(e) { console.error('[_renderTab]', id, e); }
}

// ── Load all data from API ────────────────────────────────────────────────────
async function loadAll() {
  document.getElementById('syncInfo').textContent = 'Loading…';
  try {
    const res = await fetch('/api/data');
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || res.statusText);
    }
    dashboardData = await res.json();
  } catch (e) {
    document.getElementById('syncInfo').textContent = 'Error: ' + e.message;
    console.error('[loadAll]', e);
    return;
  }
  renderAll();
}

function renderAll() {
  const since = getStartDate();
  const now = new Date().toLocaleTimeString();
  try {
    loadOverview(since);
    loadSessions(since);
    loadAI(since);
    loadSubworkflows(since);
    loadGuardrails(since);
    loadRouting(since);
    loadErrors(since);
    loadLogs();
    const collected = dashboardData.collectedAt
      ? ' (data from ' + new Date(dashboardData.collectedAt).toLocaleTimeString() + ')'
      : '';
    document.getElementById('syncInfo').textContent = 'Refreshed ' + now + collected;
  } catch (e) {
    console.error('[renderAll]', e);
    document.getElementById('syncInfo').textContent = 'Render error — see console';
  }
}

window.addEventListener('DOMContentLoaded', () => loadAll());

// ── loadOverview ──────────────────────────────────────────────────────────────
function loadOverview(since) {
  const execRows = (dashboardData.executionLog || []).filter(r => r.started_at >= since);
  if (!execRows.length) return;

  const seen = new Set();
  const chatBotRows = [];
  for (const r of execRows) {
    if (r.workflow_id !== MAIN_WF_ID || seen.has(r.execution_id)) continue;
    seen.add(r.execution_id);
    chatBotRows.push(r);
  }

  const total   = chatBotRows.length;
  const success = chatBotRows.filter(r => r.status === 'success').length;
  const avgWallMs = total ? Math.round(chatBotRows.reduce((s,r) => s + (r.wall_time_ms||0), 0) / total) : 0;

  const agentData = (dashboardData.agentCallLog || []).filter(r => r.started_at >= since);
  const totalCostThb = agentData.reduce((s,r) => s + (r.total_cost_thb||0), 0);
  const totalCostUsd = agentData.reduce((s,r) => s + (r.total_cost_usd||0), 0);

  document.getElementById('ov-total').textContent     = total.toLocaleString();
  document.getElementById('ov-total-sub').textContent = `chat-bot sessions · last ${activeDays} day(s)`;
  document.getElementById('ov-success').textContent   = total ? ((success/total)*100).toFixed(1)+'%' : '—';
  document.getElementById('ov-success-sub').textContent = (total-success) + ' errors / guardrail blocks';
  document.getElementById('ov-latency').textContent   = fmtMs(avgWallMs);
  document.getElementById('ov-latency-sub').textContent = 'avg wall time per chat-bot session';
  document.getElementById('ov-cost').textContent      = fmtThb(totalCostThb);
  document.getElementById('ov-cost-sub').textContent  = '$' + fmt(totalCostUsd, 4) + ' USD (all agent calls in period)';

  const byDay = {};
  chatBotRows.forEach(r => { const d = toLocalDate(r.started_at); byDay[d] = (byDay[d]||0) + 1; });
  const days = Object.keys(byDay).sort();
  mkChart('ov-chart-volume', {
    type: 'bar',
    data: { labels: days, datasets: [{ data: days.map(d => byDay[d]), backgroundColor: '#4f8ef7', borderRadius: 3 }] },
    options: { ...baseOpts },
  });

  const wfLat = {};
  agentData.forEach(r => {
    const wf = normalizeWfName(r.workflow_name||'') || r.workflow_name || 'unknown';
    if (!wfLat[wf]) wfLat[wf] = [];
    wfLat[wf].push(r.processing_time_ms||0);
  });
  const maxLat = Math.max(1, ...Object.values(wfLat).map(a => a.reduce((x,y) => x+y, 0) / a.length));
  document.getElementById('ov-latency-bars').innerHTML = Object.entries(wfLat)
    .sort((a,b) => (b[1].reduce((x,y)=>x+y,0)/b[1].length) - (a[1].reduce((x,y)=>x+y,0)/a[1].length))
    .map(([wf, arr]) => {
      const avg = arr.reduce((x,y) => x+y, 0) / arr.length;
      const pct = Math.round((avg/maxLat)*100);
      return `<div class="prog-row"><span class="prog-label">${escHtml(wf)}</span><div class="prog-bg"><div class="prog-fill" style="width:${pct}%;background:var(--accent)"></div></div><span class="prog-val">${fmtMs(Math.round(avg))}</span></div>`;
    }).join('') || '<div style="color:var(--text3);font-size:13px;padding:8px 0">No agent data yet</div>';

  document.getElementById('ov-table').innerHTML = chatBotRows.slice(0,20).map(r => {
    const msg     = (r.user_message||'').slice(0,40) + ((r.user_message||'').length > 40 ? '…' : '');
    const ts      = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
    const msgType = (r.message_type||'').toLowerCase() || '—';
    return `<tr class="row-clickable" onclick="openDrawer('${r.execution_id}')">
      <td class="td-mono" style="font-size:11px">${ts}</td>
      <td class="td-mono">${escHtml(fmtId(r.session_id))}</td>
      <td class="td-mono">${escHtml(fmtId(r.customer_id))}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${escHtml(msg)}</td>
      <td>${routeBadge(r.route_to)}</td>
      <td>${fmtMs(r.wall_time_ms)}</td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(msgType)}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="color:var(--text3);padding:16px 0">No data for this period</td></tr>';
}

// ── loadSessions + renderSessions + filterLogsToSession ───────────────────────
function loadSessions(since) {
  const emptyState = (msg) => {
    ['sess-total','sess-avg-turns','sess-avg-cost','sess-avg-duration'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '—';
    });
    document.getElementById('sess-table').innerHTML =
      `<tr><td colspan="9" style="color:var(--text3);padding:16px 0">${msg}</td></tr>`;
    allSessions = [];
  };

  const agentRows = (dashboardData.agentCallLog || []).filter(r => r.started_at >= since);
  if (!agentRows.length) { emptyState('No agent call data in this period'); renderSessions(); return; }

  const agentByExec = {};
  agentRows.forEach(r => {
    const eid = r.execution_id;
    if (!agentByExec[eid]) agentByExec[eid] = {procMs:0, cost:0};
    agentByExec[eid].procMs += (r.processing_time_ms||0);
    agentByExec[eid].cost   += (r.total_cost_thb||0);
  });
  const agentExecIds = Object.keys(agentByExec);

  const flagExecSet = new Set((dashboardData.flagRows || []).map(r => r.execution_id));
  const matchedExecIds = agentExecIds.filter(eid => flagExecSet.has(eid));
  if (!matchedExecIds.length) { emptyState('No sessions found (no execution_id overlap between agent_call_log and workflow_agent_flags)'); renderSessions(); return; }

  const matchedSet = new Set(matchedExecIds);
  const execData = (dashboardData.executionLog || []).filter(r => matchedSet.has(r.execution_id) && r.started_at >= since);

  const sessionMap = {};
  execData.forEach(r => {
    if (!r.session_id) return;
    const sid = String(r.session_id);
    if (!sessionMap[sid]) {
      sessionMap[sid] = {
        session_id: sid, customer_id: String(r.customer_id||'—'),
        turns: 0, routes: {advisor:0, education:0, summary:0, unknown:0},
        first: r.started_at, last: r.started_at, lastStatus: r.status,
        totalCost: 0, totalWallMs: 0,
      };
    }
    const s = sessionMap[sid];
    s.turns++;
    const route = (r.route_to||'unknown').toLowerCase();
    s.routes[route] = (s.routes[route]||0) + 1;
    if (r.started_at > s.last) { s.last = r.started_at; s.lastStatus = r.status; }
    const ac = agentByExec[r.execution_id];
    if (ac) { s.totalCost += ac.cost; s.totalWallMs += ac.procMs; }
  });

  allSessions = Object.values(sessionMap).sort((a,b) => new Date(b.last) - new Date(a.last));

  const totalSess = allSessions.length;
  if (!totalSess) { emptyState('No sessions in this period'); renderSessions(); return; }

  const avgTurns = totalSess ? allSessions.reduce((s,r)=>s+r.turns,0)/totalSess : 0;
  const avgCost  = totalSess ? allSessions.reduce((s,r)=>s+r.totalCost,0)/totalSess : 0;
  const avgDurMs = totalSess ? allSessions.reduce((s,r)=>s+(r.totalWallMs||0),0)/totalSess : 0;

  document.getElementById('sess-total').textContent = totalSess.toLocaleString();
  document.getElementById('sess-total-sub').textContent = `last ${activeDays} day(s)`;
  document.getElementById('sess-avg-turns').textContent = fmt(avgTurns, 1);
  document.getElementById('sess-avg-cost').textContent = fmtThb(avgCost);
  document.getElementById('sess-avg-duration').textContent = fmtDuration(avgDurMs);

  const byDay = {};
  allSessions.forEach(s => { const d = toLocalDate(s.first); byDay[d]=(byDay[d]||0)+1; });
  const days = Object.keys(byDay).sort();
  mkChart('sess-chart-volume', {
    type:'bar',
    data:{ labels:days, datasets:[{ data:days.map(d=>byDay[d]), backgroundColor:'#4f8ef7', borderRadius:3 }] },
    options:{ ...baseOpts }
  });

  const bucketLabels = ['1 turn','2–3','4–5','6–10','10+'];
  const buckets = [0,0,0,0,0];
  allSessions.forEach(s => {
    if (s.turns===1) buckets[0]++;
    else if (s.turns<=3) buckets[1]++;
    else if (s.turns<=5) buckets[2]++;
    else if (s.turns<=10) buckets[3]++;
    else buckets[4]++;
  });
  const maxB = Math.max(1,...buckets);
  document.getElementById('sess-turns-bars').innerHTML = bucketLabels
    .map((l,i) => `<div class="prog-row"><span class="prog-label">${l}</span><div class="prog-bg"><div class="prog-fill" style="width:${Math.round((buckets[i]/maxB)*100)}%;background:var(--teal)"></div></div><span class="prog-val">${buckets[i]}</span></div>`)
    .join('');

  renderSessions();
}

function renderSessions() {
  const search = (document.getElementById('sess-search')?.value||'').toLowerCase();
  const filtered = search ? allSessions.filter(s =>
    (s.session_id||'').toLowerCase().includes(search) || (s.customer_id||'').toLowerCase().includes(search)
  ) : allSessions;

  const routeColors = { advisor:'#4f8ef7', education:'#2dd4bf', summary:'#a78bfa', unknown:'#f59e0b' };

  document.getElementById('sess-table').innerHTML = filtered.slice(0,100).map(s => {
    const durMs = s.totalWallMs || 0;
    const first = s.first ? new Date(s.first).toLocaleString() : '—';
    const last  = s.last  ? new Date(s.last).toLocaleString()  : '—';
    const routeLabels = { advisor:'Advisor', education:'Education', summary:'Summary', unknown:'Unknown' };
    const routeDots = Object.entries(s.routes)
      .filter(([,cnt])=>cnt>0)
      .map(([r,cnt])=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:11px;color:var(--text2);white-space:nowrap"><span style="width:6px;height:6px;border-radius:50%;background:${routeColors[r]||'#888'};flex-shrink:0;display:inline-block"></span>${routeLabels[r]||r} ×${cnt}</span>`)
      .join('');
    return `<tr class="row-clickable" onclick="filterLogsToSession('${escHtml(s.session_id)}')">
      <td class="td-mono" style="font-size:11px" title="${escHtml(s.session_id)}">${escHtml(String(s.session_id||'').slice(-12))}</td>
      <td class="td-mono" style="font-size:11px">${escHtml(fmtId(s.customer_id))}</td>
      <td class="td-right" style="font-weight:500">${s.turns}</td>
      <td class="td-mono" style="font-size:11px">${first}</td>
      <td class="td-mono" style="font-size:11px">${last}</td>
      <td>${fmtDuration(durMs)}</td>
      <td>${routeDots||'—'}</td>
      <td class="td-right">${s.totalCost ? fmtThb(s.totalCost) : '—'}</td>
      <td>${statusBadge(s.lastStatus)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" style="color:var(--text3);padding:16px 0">No sessions found</td></tr>';

  if (filtered.length > 100) {
    document.getElementById('sess-table').innerHTML += `<tr><td colspan="9" style="color:var(--text3);font-size:12px;padding:8px 0">${filtered.length-100} more sessions — use search to narrow results</td></tr>`;
  }
}

function filterLogsToSession(sessionId) {
  document.getElementById('log-search').value = sessionId;
  document.getElementById('log-status-filter').value = '';
  logPageNum = 1;
  renderLogs();
  switchTab('logs');
}

// ── loadAI ────────────────────────────────────────────────────────────────────
function loadAI(since) {
  const rows = (dashboardData.agentCallLog || []).filter(r => r.started_at >= since);
  if (!rows.length) return;

  const totalCalls     = rows.length;
  const totalInp       = rows.reduce((s,r) => s + (r.input_tokens||0),    0);
  const totalOut       = rows.reduce((s,r) => s + (r.output_tokens||0),   0);
  const totalCostThb   = rows.reduce((s,r) => s + (r.total_cost_thb||0),  0);
  const totalCostUsd   = rows.reduce((s,r) => s + (r.total_cost_usd||0),  0);
  const totalInpUsd    = rows.reduce((s,r) => s + (r.input_cost_usd||0),  0);
  const totalOutUsd    = rows.reduce((s,r) => s + (r.output_cost_usd||0), 0);
  const thbRate        = totalCostUsd > 0 ? totalCostThb / totalCostUsd : 33;

  document.getElementById('ai-calls').textContent    = totalCalls.toLocaleString();
  document.getElementById('ai-inp-tok').textContent  = fmtK(totalInp);
  document.getElementById('ai-inp-cost').textContent = '฿' + fmt(totalInpUsd * thbRate, 4) + ' input cost';
  document.getElementById('ai-out-tok').textContent  = fmtK(totalOut);
  document.getElementById('ai-out-cost').textContent = '฿' + fmt(totalOutUsd * thbRate, 4) + ' output cost';
  document.getElementById('ai-cost-thb').textContent = fmtThb(totalCostThb);
  document.getElementById('ai-cost-usd').textContent = '$' + fmt(totalCostUsd, 4) + ' USD';

  const routeCost = {
    all:       { sum: 0, cnt: 0 },
    advisor:   { sum: 0, cnt: 0 },
    education: { sum: 0, cnt: 0 },
    summary:   { sum: 0, cnt: 0 },
  };
  rows.forEach(r => {
    const cost   = r.total_cost_thb || 0;
    const normed = normalizeWfName(r.workflow_name || '');
    routeCost.all.sum += cost; routeCost.all.cnt++;
    if      (normed === 'Advisor')   { routeCost.advisor.sum   += cost; routeCost.advisor.cnt++;   }
    else if (normed === 'Education') { routeCost.education.sum += cost; routeCost.education.cnt++; }
    else if (normed === 'Summary')   { routeCost.summary.sum   += cost; routeCost.summary.cnt++;   }
  });
  const avgOrDash = (g) => g.cnt ? fmtThb(g.sum / g.cnt) : '—';
  document.getElementById('ai-cppt-all').textContent = avgOrDash(routeCost.all);
  document.getElementById('ai-cppt-adv').textContent = avgOrDash(routeCost.advisor);
  document.getElementById('ai-cppt-edu').textContent = avgOrDash(routeCost.education);
  document.getElementById('ai-cppt-sum').textContent = avgOrDash(routeCost.summary);

  const byDay = {};
  rows.forEach(r => {
    const d = toLocalDate(r.started_at);
    if (!byDay[d]) byDay[d] = { inp: 0, out: 0 };
    byDay[d].inp += (r.input_tokens||0);
    byDay[d].out += (r.output_tokens||0);
  });
  const days = Object.keys(byDay).sort();
  mkChart('ai-chart-tokens', {
    type: 'bar',
    data: { labels: days, datasets: [
      { label: 'Input tokens',  data: days.map(d => byDay[d].inp), backgroundColor: '#4f8ef7', borderRadius: 2 },
      { label: 'Output tokens', data: days.map(d => byDay[d].out), backgroundColor: '#2dd4bf', borderRadius: 2 },
    ]},
    options: { ...baseOpts,
      plugins: { ...baseOpts.plugins, legend: { display: true, labels: { color: '#8b93a8', font: { size: 11 } } } },
      scales:  { x: { ...baseOpts.scales.x, stacked: true }, y: { ...baseOpts.scales.y, stacked: true } },
    },
  });

  const wfCost = {};
  rows.forEach(r => {
    const wf = normalizeWfName(r.workflow_name||'') || r.workflow_name || 'unknown';
    wfCost[wf] = (wfCost[wf]||0) + (r.total_cost_thb||0);
  });
  const wfKeys = Object.keys(wfCost).sort((a,b) => wfCost[b] - wfCost[a]);
  mkChart('ai-chart-cost', {
    type: 'bar',
    data: { labels: wfKeys, datasets: [{ data: wfKeys.map(k => +wfCost[k].toFixed(5)), backgroundColor: CHART_COLORS, borderRadius: 3 }] },
    options: { ...baseOpts, indexAxis: 'y' },
  });

  const agentMap = {};
  rows.forEach(r => {
    const a  = r.agent_name || 'unknown';
    const wf = normalizeWfName(r.workflow_name||'') || r.workflow_name || '—';
    if (!agentMap[a]) agentMap[a] = { workflow: wf, calls: 0, inp: 0, out: 0, total: 0, inpNull: 0, cost: 0, lat: 0 };
    agentMap[a].calls++;
    agentMap[a].inp   += (r.input_tokens||0);
    agentMap[a].out   += (r.output_tokens||0);
    agentMap[a].total += (r.total_tokens||0);
    if (r.input_tokens == null) agentMap[a].inpNull++;
    agentMap[a].cost  += (r.total_cost_thb||0);
    agentMap[a].lat   += (r.processing_time_ms||0);
  });
  document.getElementById('ai-agent-table').innerHTML = Object.entries(agentMap)
    .sort((a,b) => b[1].cost - a[1].cost)
    .map(([name, v]) => {
      const allInpNull = v.inpNull === v.calls;
      const inpCell = allInpNull
        ? `<span style="color:var(--text3)" title="input_tokens not logged">${fmtK(Math.round(v.total/v.calls))} <span style="font-size:10px">(total)</span></span>`
        : fmtK(Math.round(v.inp / v.calls));
      const outCell = allInpNull ? '<span style="color:var(--text3)">—</span>' : fmtK(Math.round(v.out / v.calls));
      return `<tr>
        <td style="font-weight:500">${escHtml(name)}</td>
        <td class="td-mono" style="font-size:11px">${escHtml(v.workflow)}</td>
        <td>${v.calls.toLocaleString()}</td>
        <td class="td-right">${inpCell}</td>
        <td class="td-right">${outCell}</td>
        <td class="td-right">${fmtThb(v.cost / v.calls)}</td>
        <td class="td-right">${fmtMs(Math.round(v.lat / v.calls))}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="color:var(--text3)">No data</td></tr>';
}

// ── loadSubworkflows ──────────────────────────────────────────────────────────
function loadSubworkflows(since) {
  const execRows = (dashboardData.executionLog || []).filter(r => r.started_at >= since);
  const agentRows = (dashboardData.agentCallLog || []).filter(r => r.started_at >= since);

  const uniqueExecRows = [...new Map(execRows.map(r => [r.execution_id, r])).values()];
  const chatBotExecRows = uniqueExecRows.filter(r => r.workflow_id === MAIN_WF_ID);
  const totalExec = chatBotExecRows.length;
  const execIds = new Set(chatBotExecRows.map(r => r.execution_id));

  const rawFlags = (dashboardData.flagRows || []).filter(f => execIds.has(f.execution_id));

  const flagsById = {};
  rawFlags.forEach(f => { flagsById[f.execution_id] = {...f}; });
  chatBotExecRows.forEach(r => {
    if (!flagsById[r.execution_id]) flagsById[r.execution_id] = { execution_id: r.execution_id };
    const route = (r.route_to||'').toLowerCase();
    if (route === 'advisor')   flagsById[r.execution_id].used_advisor   = true;
    if (route === 'education') flagsById[r.execution_id].used_education = true;
    if (route === 'summary')   flagsById[r.execution_id].used_summary   = true;
    if (r.output_guardrail_triggered) flagsById[r.execution_id].used_output_guardrail = true;
  });
  const relevantFlags = Object.values(flagsById);

  const SW = [
    { key:'used_input_guardrail',  label:'Input guardrail',    color:'#4f8ef7' },
    { key:'used_classification',   label:'Classification',     color:'#2dd4bf' },
    { key:'used_advisor',          label:'Advisor',            color:'#34c77b' },
    { key:'used_education',        label:'Education',          color:'#a78bfa' },
    { key:'used_summary',          label:'Summary',            color:'#f59e0b' },
    { key:'used_output_guardrail', label:'Output guardrail',   color:'#4f8ef7' },
  ];

  const swCounts = {};
  SW.forEach(s => { swCounts[s.key] = relevantFlags.filter(r => r[s.key]).length; });

  const flagCoverage = rawFlags.length;
  const missingFlags = totalExec - flagCoverage;

  document.getElementById('sw-metrics').innerHTML = [
    { label:'Total conversations', val: totalExec.toLocaleString(), cls:'blue', sub:'chat-bot sessions · in period' },
    { label:'Classification rate', val: totalExec ? fmt((swCounts.used_classification/totalExec)*100)+'%' : '—', cls:'teal',
      sub: `${swCounts.used_classification} / ${totalExec}${missingFlags > 0 ? ` · ⚠ ${missingFlags} exec without flags` : ''}` },
    { label:'Escalation to staff', val: swCounts.used_summary||0, cls:'amber', sub:'reached summary' },
  ].map(m => `<div class="metric-card ${m.cls}"><div class="metric-label">${m.label}</div><div class="metric-value ${m.cls}">${m.val}</div><div class="metric-sub">${m.sub}</div></div>`).join('');

  document.getElementById('sw-activation-bars').innerHTML = SW.map(s => {
    const cnt = swCounts[s.key]||0;
    const pct = totalExec ? Math.round((cnt/totalExec)*100) : 0;
    return `<div class="prog-row"><span class="prog-label">${s.label}</span><div class="prog-bg"><div class="prog-fill" style="width:${pct}%;background:${s.color}"></div></div><span class="prog-val">${pct}%</span></div>`;
  }).join('');

  const byWfExec = {};
  agentRows.forEach(r => {
    const wfName = normalizeWfName(r.workflow_name||'');
    if (!wfName) return;
    const key = wfName + '::' + (r.execution_id||'');
    if (!byWfExec[key]) byWfExec[key] = {wfName, procMs:0, inp:0, out:0, cost:0};
    byWfExec[key].procMs += (r.processing_time_ms||0);
    byWfExec[key].inp    += (r.input_tokens||0);
    byWfExec[key].out    += (r.output_tokens||0);
    byWfExec[key].cost   += (r.total_cost_thb||0);
  });

  const wfDetail = {};
  Object.values(byWfExec).forEach(item => {
    const lcKey = item.wfName.toLowerCase();
    if (!wfDetail[lcKey]) wfDetail[lcKey] = {label:item.wfName, runs:0, sumProcMs:0, sumInp:0, sumOut:0, sumCost:0};
    wfDetail[lcKey].runs++;
    wfDetail[lcKey].sumProcMs += item.procMs;
    wfDetail[lcKey].sumInp    += item.inp;
    wfDetail[lcKey].sumOut    += item.out;
    wfDetail[lcKey].sumCost   += item.cost;
  });

  const detailEntries = Object.values(wfDetail).sort((a,b) => (b.sumProcMs/b.runs) - (a.sumProcMs/a.runs));
  const chartLabels = detailEntries.map(e => e.label);
  const chartAvgMs  = detailEntries.map(e => Math.round(e.sumProcMs / e.runs));
  mkChart('sw-chart-latency', {
    type:'bar',
    data:{ labels:chartLabels, datasets:[{ data:chartAvgMs, backgroundColor:CHART_COLORS.slice(0,chartLabels.length), borderRadius:4 }] },
    options:{ ...baseOpts, indexAxis:'y', scales:{ x:{...baseOpts.scales.x, ticks:{ ...baseOpts.scales.x.ticks, callback: v => v+'ms' }}, y:baseOpts.scales.y } }
  });

  document.getElementById('sw-table').innerHTML = detailEntries.map(e => {
    const avgLat  = Math.round(e.sumProcMs / e.runs);
    const avgInp  = Math.round(e.sumInp    / e.runs);
    const avgOut  = Math.round(e.sumOut    / e.runs);
    const avgCost = e.sumCost / e.runs;
    const actPct  = totalExec ? fmt((e.runs / totalExec) * 100) + '%' : '—';
    return `<tr>
      <td style="font-weight:500">${escHtml(e.label)}</td>
      <td class="td-right">${e.runs.toLocaleString()}</td>
      <td class="td-right">${actPct}</td>
      <td class="td-right">${avgLat ? fmtMs(avgLat) : '—'}</td>
      <td class="td-right">${avgInp ? fmtK(avgInp) : '—'}</td>
      <td class="td-right">${avgOut ? fmtK(avgOut) : '—'}</td>
      <td class="td-right">${avgCost ? fmtThb(avgCost) : '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:var(--text3);padding:12px 0">No sub-workflow data in this period</td></tr>';
}

// ── loadGuardrails ────────────────────────────────────────────────────────────
function loadGuardrails(since) {
  const rows = (dashboardData.executionLog || []).filter(r => r.started_at >= since);
  if (!rows.length) return;

  const total = rows.length;
  const inpBlock = rows.filter(r=>r.input_guardrail_triggered).length;
  const outBlock = rows.filter(r=>r.output_guardrail_triggered).length;
  const nsfw    = rows.filter(r=>r.output_guardrail_nsfw).length;
  const halluc  = rows.filter(r=>r.output_guardrail_hallucination).length;

  document.getElementById('gr-in-pass').textContent  = total ? fmt(((total-inpBlock)/total)*100)+'%' : '—';
  document.getElementById('gr-in-blocked').textContent  = inpBlock+' blocked in period';
  document.getElementById('gr-out-pass').textContent = total ? fmt(((total-outBlock)/total)*100)+'%' : '—';
  document.getElementById('gr-out-blocked').textContent = outBlock+' blocked in period';
  document.getElementById('gr-halluc').textContent   = halluc;
  document.getElementById('gr-nsfw').textContent     = nsfw;

  const byDay = {};
  rows.forEach(r => {
    const d = toLocalDate(r.started_at) || 'x';
    if (!byDay[d]) byDay[d] = {inp:0,out:0};
    if (r.input_guardrail_triggered)  byDay[d].inp++;
    if (r.output_guardrail_triggered) byDay[d].out++;
  });
  const days3 = Object.keys(byDay).sort();
  mkChart('gr-chart-trend', {
    type:'line',
    data:{ labels:days3, datasets:[
      { label:'Input blocked',  data:days3.map(d=>byDay[d].inp), borderColor:'#f05252', backgroundColor:'rgba(240,82,82,.1)', tension:.3, fill:true },
      { label:'Output blocked', data:days3.map(d=>byDay[d].out), borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,.1)', tension:.3, fill:true }
    ]},
    options:{ ...baseOpts, plugins:{ ...baseOpts.plugins, legend:{ display:true, labels:{ color:'#8b93a8', font:{size:11} } } } }
  });

  const totalFlags = inpBlock + outBlock + nsfw + halluc;
  document.getElementById('gr-total-flags').textContent = totalFlags;
  const donutLabels = ['Input blocked','Output blocked','NSFW','Hallucination'];
  const donutData   = [inpBlock, outBlock, nsfw, halluc];
  const donutColors = ['#f05252','#f59e0b','#a78bfa','#fb923c'];
  mkChart('gr-donut', {
    type:'doughnut',
    data:{ labels:donutLabels, datasets:[{ data:donutData, backgroundColor:donutColors, borderWidth:0, hoverOffset:4 }] },
    options:{ cutout:'70%', plugins:{ legend:{display:false}, tooltip:baseOpts.plugins.tooltip } }
  });
  document.getElementById('gr-legend').innerHTML = donutLabels.map((l,i)=>`<div class="legend-item"><div class="legend-dot" style="background:${donutColors[i]}"></div>${l}: ${donutData[i]}</div>`).join('');

  const events = rows.filter(r=>r.input_guardrail_triggered||r.output_guardrail_triggered).slice(0,50);
  document.getElementById('gr-table').innerHTML = events.map(r => {
    const isInp = r.input_guardrail_triggered;
    const type = isInp ? 'Input' : 'Output';
    const flag = r.output_guardrail_nsfw ? '<span class="badge badge-purple">nsfw</span>' : r.output_guardrail_hallucination ? '<span class="badge badge-amber">hallucination</span>' : '<span class="badge badge-red">blocked</span>';
    const t = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
    const msgRaw = isInp ? (r.user_message||'') : (r.ai_reply||'');
    const msg = msgRaw.length > 60 ? escHtml(msgRaw.slice(0,60))+'…' : escHtml(msgRaw);
    return `<tr>
      <td class="td-mono" style="font-size:11px">${t}</td>
      <td class="td-mono">${escHtml(fmtId(r.session_id))}</td>
      <td>${type}</td><td>${flag}</td>
      <td style="max-width:220px;font-size:12px;color:var(--text2)" title="${escHtml(msgRaw)}">${msg||'—'}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="color:var(--text3);padding:12px 0">No guardrail events in this period</td></tr>';
}

// ── loadRouting ───────────────────────────────────────────────────────────────
function loadRouting(since) {
  const rawRows = (dashboardData.executionLog || []).filter(r => r.started_at >= since);
  if (!rawRows.length) return;

  const rows = [...new Map(rawRows.filter(r => r.workflow_id === MAIN_WF_ID).map(r => [r.execution_id, r])).values()];
  const total = rows.length;
  const execIds = rows.map(r => r.execution_id);
  const execIdSet = new Set(execIds);

  const flagRows = (dashboardData.flagRows || []).filter(f => execIdSet.has(f.execution_id));
  const classifiedSet = new Set(flagRows.filter(r => r.used_classification).map(r => r.execution_id));
  const classifiedCount = classifiedSet.size;
  const bypassCount = total - classifiedCount;

  const cnts = {advisor:0,education:0,summary:0,unknown:0};
  rows.forEach(r => { const k = (r.route_to||'unknown').toLowerCase(); if (cnts[k]!==undefined) cnts[k]++; else cnts.unknown++; });

  const classifiedSummary = rows.filter(r => (r.route_to||'').toLowerCase() === 'summary' && classifiedSet.has(r.execution_id)).length;
  const bypassSummary     = cnts.summary - classifiedSummary;
  const classifiedUnknown = rows.filter(r => ((r.route_to||'unknown').toLowerCase() === 'unknown' || !r.route_to) && classifiedSet.has(r.execution_id)).length;
  const blockUnknown      = cnts.unknown - classifiedUnknown;

  ['adv','edu','sum','unk'].forEach((k,i) => {
    const key = ['advisor','education','summary','unknown'][i];
    const cnt = cnts[key];
    document.getElementById('rt-'+k).textContent = cnt.toLocaleString();
    document.getElementById('rt-'+k+'-pct').textContent = total ? fmt((cnt/total)*100)+'% of conversations' : '—';
  });
  document.getElementById('rt-sum-pct').textContent =
    `${classifiedSummary} via classification · ${bypassSummary} direct bypass`;
  document.getElementById('rt-unk-pct').textContent =
    `${classifiedUnknown} classified unknown · ${blockUnknown} guardrail blocked`;
  document.getElementById('rt-total').textContent = total;

  const rtColors = ['#4f8ef7','#2dd4bf','#a78bfa','#f59e0b'];
  const rtLabels = ['Advisor','Education','Summary','Unknown'];
  const rtData   = [cnts.advisor, cnts.education, cnts.summary, cnts.unknown];
  mkChart('rt-donut', {
    type:'doughnut',
    data:{ labels:rtLabels, datasets:[{ data:rtData, backgroundColor:rtColors, borderWidth:0, hoverOffset:4 }] },
    options:{ cutout:'70%', plugins:{ legend:{display:false}, tooltip:baseOpts.plugins.tooltip } }
  });
  document.getElementById('rt-legend').innerHTML = rtLabels.map((l,i)=>`<div class="legend-item"><div class="legend-dot" style="background:${rtColors[i]}"></div>${l}: ${rtData[i]}</div>`).join('');

  const byDay = {};
  rows.forEach(r => {
    const d = toLocalDate(r.started_at) || 'x';
    if (!byDay[d]) byDay[d] = {advisor:0,education:0,summary:0,unknown:0};
    const k = (r.route_to||'unknown').toLowerCase(); if (byDay[d][k]!==undefined) byDay[d][k]++;
  });
  const days4 = Object.keys(byDay).sort();
  mkChart('rt-chart-trend', {
    type:'bar',
    data:{ labels:days4, datasets:rtLabels.map((l,i)=>({ label:l, data:days4.map(d=>byDay[d][l.toLowerCase()]||0), backgroundColor:rtColors[i], borderRadius:2 })) },
    options:{ ...baseOpts, plugins:{ ...baseOpts.plugins, legend:{ display:true, labels:{ color:'#8b93a8', font:{size:11} } } }, scales:{ x:{...baseOpts.scales.x,stacked:true}, y:{...baseOpts.scales.y,stacked:true} } }
  });

  const escl = rows.filter(r=>r.need_staff_contact).length;
  const confirmed = rows.filter(r=>(r.route_to||'').toLowerCase()==='summary').length;
  document.getElementById('rt-escl').textContent = escl;
  document.getElementById('rt-escl-pct').textContent = total ? fmt((escl/total)*100)+'% of turns' : '—';
  document.getElementById('rt-escl-rate').textContent = total ? fmt((escl/total)*100)+'%' : '—';
  document.getElementById('rt-confirmed').textContent = confirmed;

  document.getElementById('rt-bypass').textContent = bypassCount;
  document.getElementById('rt-bypass-sub').textContent =
    `${bypassSummary} direct→summary · ${blockUnknown} guardrail blocked`;
}

// ── loadErrors ────────────────────────────────────────────────────────────────
function loadErrors(since) {
  const execErrors = (dashboardData.executionLog || [])
    .filter(r => r.started_at >= since && (r.status === 'error' || r.status === 'guardrail_blocked'));
  const httpErrors = (dashboardData.httpErrors || []).filter(r => r.started_at >= since);
  const total = (dashboardData.executionLog || []).filter(r => r.started_at >= since).length;

  const errCount = execErrors.length;
  const httpErrCount = httpErrors.length;
  const guardrailCount = execErrors.filter(r=>r.status==='guardrail_blocked').length;

  document.getElementById('er-total').textContent = errCount;
  document.getElementById('er-rate').textContent = total ? fmt((errCount/total)*100,2)+'% error rate' : '—';
  document.getElementById('er-http').textContent = httpErrCount;
  document.getElementById('er-guardrail').textContent = guardrailCount;

  const byDay = {};
  execErrors.forEach(r => {
    const d = toLocalDate(r.started_at) || 'x';
    byDay[d] = (byDay[d]||0) + 1;
  });
  const days5 = Object.keys(byDay).sort();
  mkChart('er-chart-trend', {
    type:'line',
    data:{ labels:days5, datasets:[{ label:'Errors', data:days5.map(d=>byDay[d]), borderColor:'#f05252', backgroundColor:'rgba(240,82,82,.12)', tension:.3, fill:true }] },
    options:{ ...baseOpts }
  });

  const httpByStatus = {};
  httpErrors.forEach(r => {
    const k = (r.response_status||'timeout') + ' — ' + (r.node_name||'unknown');
    httpByStatus[k] = (httpByStatus[k]||0) + 1;
  });
  const maxHttpErr = Math.max(1, ...Object.values(httpByStatus));
  document.getElementById('er-http-list').innerHTML = Object.entries(httpByStatus).map(([label, cnt]) =>
    `<div class="prog-row"><span class="prog-label">${escHtml(label)}</span><div class="prog-bg"><div class="prog-fill" style="width:${Math.round((cnt/maxHttpErr)*100)}%;background:var(--red)"></div></div><span class="prog-val">${cnt}</span></div>`
  ).join('') || '<div style="color:var(--text3);font-size:13px;padding:8px 0">No HTTP errors 🎉</div>';

  const combinedErrors = [
    ...execErrors.map(r=>({ time:r.started_at, session:r.session_id, type: r.status==='guardrail_blocked'?'Guardrail':'Execution error', detail:r.error_message||r.status, node:'—' })),
    ...httpErrors.map(r=>({ time:r.started_at, session:r.execution_id, type:'HTTP error', detail:(r.response_status||'timeout')+' '+escHtml(r.url||''), node:r.node_name||'—' })),
  ].sort((a,b) => new Date(b.time) - new Date(a.time));

  document.getElementById('er-table').innerHTML = combinedErrors.slice(0,50).map(r => {
    const isHttp = r.type === 'HTTP error';
    return `<tr>
      <td class="td-mono" style="font-size:11px">${r.time ? new Date(r.time).toLocaleString() : '—'}</td>
      <td class="td-mono">${escHtml(fmtId(r.session))}</td>
      <td><span class="badge ${isHttp?'badge-amber':'badge-red'}">${escHtml(r.type)}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${escHtml(r.detail||'—')}</td>
      <td class="td-mono" style="font-size:11px">${escHtml(r.node)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="color:var(--text3);padding:12px 0">No errors in this period 🎉</td></tr>';
}

// ── loadLogs + renderLogs + filterLogs + logPage ──────────────────────────────
// Shows the last 50 agent_call_log rows (pre-sliced by the collect service)
function loadLogs() {
  // Build exec map from all execution log rows
  allLogExecMap = {};
  (dashboardData.executionLog || []).forEach(r => { allLogExecMap[r.execution_id] = r; });

  // Build chat set via time-window join
  const mainWins = (dashboardData.executionLog || [])
    .filter(r => r.workflow_id === MAIN_WF_ID)
    .map(r => ({
      start: new Date(r.started_at).getTime(),
      end:   new Date(r.started_at).getTime() + (r.wall_time_ms || 120000) + 60000,
    }))
    .sort((a,b) => a.start - b.start);

  allLogChatSet = new Set();
  (dashboardData.executionLog || []).forEach(r => {
    if (r.workflow_id === MAIN_WF_ID || r.session_id) {
      allLogChatSet.add(r.execution_id);
      return;
    }
    const t = new Date(r.started_at).getTime();
    for (const w of mainWins) {
      if (w.start > t) break;
      if (t <= w.end) { allLogChatSet.add(r.execution_id); break; }
    }
  });

  allLogs = dashboardData.logRows || [];
  logPageNum = 1;
  renderLogs();
}

function filterLogs() { logPageNum = 1; renderLogs(); }
function logPage(dir) { logPageNum = Math.max(1, logPageNum + dir); renderLogs(); }

function renderLogs() {
  const search = (document.getElementById('log-search')?.value||'').toLowerCase();
  const route  = document.getElementById('log-route-filter')?.value||'';
  const status = document.getElementById('log-status-filter')?.value||'';

  let filtered = allLogs;
  if (search) filtered = filtered.filter(r => {
    const ex = allLogExecMap[r.execution_id];
    return (ex?.session_id||'').toLowerCase().includes(search) || (ex?.customer_id||'').toLowerCase().includes(search);
  });
  if (route) filtered = filtered.filter(r => (allLogExecMap[r.execution_id]?.route_to||'').toLowerCase() === route);
  if (status === 'chat-bot')        filtered = filtered.filter(r => allLogChatSet.has(r.execution_id));
  else if (status === 'no-session') filtered = filtered.filter(r => !allLogChatSet.has(r.execution_id));
  else if (status)                  filtered = filtered.filter(r => allLogExecMap[r.execution_id]?.status === status);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
  logPageNum = Math.min(logPageNum, totalPages);
  const page = filtered.slice((logPageNum-1)*LOG_PAGE_SIZE, logPageNum*LOG_PAGE_SIZE);

  document.getElementById('log-page-info').textContent = `${filtered.length} rows (last ${allLogs.length} collected)`;
  document.getElementById('log-prev').disabled = logPageNum <= 1;
  document.getElementById('log-next').disabled = logPageNum >= totalPages;

  document.getElementById('log-table').innerHTML = page.map(r => {
    const ex = allLogExecMap[r.execution_id] || {};
    const agentLabel = [r.agent_name, r.workflow_name].filter(Boolean).join(' · ') || '—';
    return `<tr class="row-clickable" onclick="openDrawer('${r.execution_id}')">
      <td class="td-mono" style="font-size:11px">${r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</td>
      <td class="td-mono">${escHtml(fmtId(ex.session_id))}</td>
      <td class="td-mono">${escHtml(fmtId(ex.customer_id))}</td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(agentLabel)}</td>
      <td>${routeBadge(ex.route_to)}</td>
      <td class="td-right">${r.input_tokens != null ? fmtK(r.input_tokens) : '—'}</td>
      <td class="td-right">${r.output_tokens != null ? fmtK(r.output_tokens) : '—'}</td>
      <td class="td-right">${r.total_cost_thb != null ? fmtThb(r.total_cost_thb) : '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="color:var(--text3);padding:16px 0">No matching agent calls</td></tr>';
}

// ── openDrawer + closeDrawer ──────────────────────────────────────────────────
async function openDrawer(execId) {
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerTitle').textContent = 'Execution · …'+String(execId).slice(-8);
  document.getElementById('drawerBody').innerHTML = '<div class="state-box"><div class="spinner"></div><span>Loading…</span></div>';

  let exec, agents, httpReqs;
  try {
    const res = await fetch('/api/drawer?id=' + encodeURIComponent(execId));
    if (!res.ok) throw new Error(res.statusText);
    ({ exec, agents, httpReqs } = await res.json());
  } catch (e) {
    document.getElementById('drawerBody').innerHTML = `<div class="state-box">Failed to load: ${escHtml(e.message)}</div>`;
    return;
  }

  if (!exec) { document.getElementById('drawerBody').innerHTML = '<div class="state-box">Execution not found</div>'; return; }

  const totalTokens = (agents||[]).reduce((s,r)=>s+(r.total_tokens||0),0);
  const totalCost   = (agents||[]).reduce((s,r)=>s+(r.total_cost_thb||0),0);

  let html = `
    <div class="drawer-section">
      <div class="drawer-section-title">Conversation</div>
      ${exec.user_message ? `<div class="msg-bubble user"><span style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">User</span>${escHtml(exec.user_message)}</div>` : ''}
      ${exec.ai_reply    ? `<div class="msg-bubble ai"><span style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">AI · ${escHtml(exec.reply_type||'')}</span>${escHtml(exec.ai_reply)}</div>` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Summary</div>
      <div class="kv-row"><span class="kv-key">Status</span><span class="kv-val">${statusBadge(exec.status)}</span></div>
      <div class="kv-row"><span class="kv-key">Route</span><span class="kv-val">${routeBadge(exec.route_to)}</span></div>
      <div class="kv-row"><span class="kv-key">Wall time</span><span class="kv-val">${fmtMs(exec.wall_time_ms)}</span></div>
      <div class="kv-row"><span class="kv-key">Total tokens</span><span class="kv-val">${fmtK(totalTokens)}</span></div>
      <div class="kv-row"><span class="kv-key">Total cost</span><span class="kv-val">${fmtThb(totalCost)}</span></div>
      <div class="kv-row"><span class="kv-key">Session ID</span><span class="kv-val td-mono" style="font-size:11px">${escHtml(exec.session_id||'—')}</span></div>
      <div class="kv-row"><span class="kv-key">Customer ID</span><span class="kv-val td-mono" style="font-size:11px">${escHtml(exec.customer_id||'—')}</span></div>
      <div class="kv-row"><span class="kv-key">Narrative</span><span class="kv-val" style="font-size:12px;color:var(--text2)">${escHtml(exec.narrative||'—')}</span></div>
    </div>`;

  if (exec.input_guardrail_triggered || exec.output_guardrail_triggered) {
    html += `<div class="drawer-section">
      <div class="drawer-section-title">Guardrail flags</div>
      <div class="kv-row"><span class="kv-key">Input guardrail</span><span class="kv-val">${exec.input_guardrail_triggered ? '<span class="badge badge-red">triggered</span>' : '<span class="badge badge-green">pass</span>'}</span></div>
      <div class="kv-row"><span class="kv-key">Output guardrail</span><span class="kv-val">${exec.output_guardrail_triggered ? '<span class="badge badge-red">triggered</span>' : '<span class="badge badge-green">pass</span>'}</span></div>
      <div class="kv-row"><span class="kv-key">NSFW</span><span class="kv-val">${exec.output_guardrail_nsfw ? '<span class="badge badge-purple">flagged</span>' : '—'}</span></div>
      <div class="kv-row"><span class="kv-key">Hallucination</span><span class="kv-val">${exec.output_guardrail_hallucination ? '<span class="badge badge-amber">flagged</span>' : '—'}</span></div>
    </div>`;
  }

  if ((agents||[]).length) {
    html += `<div class="drawer-section">
      <div class="drawer-section-title">Agent calls (${agents.length})</div>`;
    agents.forEach((a, i) => {
      html += `<div class="log-step">
        <div class="step-num">${i+1}</div>
        <div>
          <div class="step-name">${escHtml(a.agent_name||'—')}</div>
          <div class="step-meta">${escHtml(a.workflow_name||'—')} · ${fmtMs(a.processing_time_ms)} · ${fmtK(a.total_tokens||0)} tokens · ${fmtThb(a.total_cost_thb)}</div>
        </div>
        <span class="badge badge-green" style="margin-left:auto">done</span>
      </div>`;
    });
    html += '</div>';
  }

  if ((httpReqs||[]).length) {
    html += `<div class="drawer-section">
      <div class="drawer-section-title">HTTP calls (${httpReqs.length})</div>`;
    httpReqs.forEach((h, i) => {
      const ok = h.success !== false;
      html += `<div class="log-step">
        <div class="step-num">${i+1}</div>
        <div>
          <div class="step-name">${escHtml(h.node_name||'—')}</div>
          <div class="step-meta">${escHtml(h.workflow_name||'—')} · ${fmtMs(h.processing_time_ms)} · HTTP ${h.response_status||'—'}</div>
        </div>
        <span class="badge ${ok?'badge-green':'badge-red'}" style="margin-left:auto">${h.response_status||'err'}</span>
      </div>`;
    });
    html += '</div>';
  }

  document.getElementById('drawerBody').innerHTML = html;
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}
