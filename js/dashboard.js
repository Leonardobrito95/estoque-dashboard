/* ==========================================================================
   DASHBOARD — Controlador principal (modular ES6)
   Dados via API /api/estoque/*
   ========================================================================== */

import { drawBarChart, drawLineChart, attachResizeObserver } from './charts.js';

/* --------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */
const API = '/api/estoque';

async function apiFetch(path, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v && v !== 'todos'))
  ).toString();
  const url = qs ? `${API}/${path}?${qs}` : `${API}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status} — ${path}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || `API falhou — ${path}`);
  return json.data;
}

/* --------------------------------------------------------------------------
   Estado global
   -------------------------------------------------------------------------- */
const state = {
  data:           [],
  filteredData:   [],
  selectedRow:    null,
  searchQuery:    '',
  soDivergencias: false,
  page:           1,
  perPage:        15,
  filters: { mes: 'todos', tecnico: 'todos', cliente: 'todos', tipo: 'todos' },
  sortColumn:     null,
  sortDirection:  'asc',
  loading:        false,
};

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  bindEvents();
  await loadAll();
  simulateRealtime();
});

/* --------------------------------------------------------------------------
   Carregamento completo dos dados
   -------------------------------------------------------------------------- */
async function loadAll() {
  setLoading(true);
  try {
    const { mes, tecnico, cliente, tipo } = state.filters;

    const [movs, tecnicos, clientes, consumoTec, evolucao] = await Promise.all([
      apiFetch('movimentacoes', { mes, tecnico_id: tecnico, cliente_id: cliente, tipo }),
      apiFetch('tecnicos'),
      apiFetch('clientes'),
      apiFetch('consumo-tecnico', { mes }),
      apiFetch('evolucao'),
    ]);

    state.data         = movs;
    state.filteredData = movs;

    populateFilters(tecnicos, clientes, movs);
    applyLocalFilters();
    drawBarChart('chart-bar',  consumoTec.map(r => ({ nome: r.nome, consumo: Number(r.consumo) })));
    drawLineChart('chart-line', evolucao.map(r => ({ mes: r.mes, valor: Number(r.valor) })));
    attachResizeObserver(
      'chart-bar', 'chart-line',
      consumoTec.map(r => ({ nome: r.nome, consumo: Number(r.consumo) })),
      evolucao.map(r => ({ mes: r.mes, valor: Number(r.valor) }))
    );
    setConnectionStatus(true);
  } catch (err) {
    console.error('[Dashboard]', err);
    setConnectionStatus(false);
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

/* --------------------------------------------------------------------------
   Popular selects de filtro
   -------------------------------------------------------------------------- */
function populateFilters(tecnicos, clientes, movs) {
  const selMes = document.getElementById('filter-mes');
  const selTec = document.getElementById('filter-tecnico');
  const listCli = document.getElementById('lista-clientes');

  /* meses distintos dos dados */
  const monthMap = { 'Jan': 1, 'Fev': 2, 'Mar': 3, 'Abr': 4, 'Mai': 5, 'Jun': 6, 'Jul': 7, 'Ago': 8, 'Set': 9, 'Out': 10, 'Nov': 11, 'Dez': 12 };
  const parseMes = (m) => {
    if (!m) return 0;
    const [mes, ano] = m.split('/');
    return parseInt(ano) * 100 + (monthMap[mes] || 0);
  };

  const meses = [...new Set(movs.map(r => r.mes_referencia))]
    .filter(Boolean)
    .sort((a, b) => parseMes(b) - parseMes(a));

  selMes.innerHTML = '<option value="todos">Todos os meses</option>';
  meses.forEach(m => selMes.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`));

  selTec.innerHTML = '<option value="todos">Todos os técnicos</option>';
  tecnicos.forEach(t => selTec.insertAdjacentHTML('beforeend',
    `<option value="${t.id}">${t.nome}</option>`));

  if (listCli) {
    listCli.innerHTML = '';
    clientes.forEach(c => listCli.insertAdjacentHTML('beforeend',
      `<option value="${c.nome}"></option>`));
  }
}

/* --------------------------------------------------------------------------
   Renderização da tabela (com paginação)
   -------------------------------------------------------------------------- */
function renderTable(data) {
  const tbody   = document.getElementById('table-body');
  const recEl   = document.getElementById('rec-count');
  const badgeEl = document.getElementById('badge-count');

  tbody.innerHTML = '';
  const totalRecs = data.length;
  if (recEl)   recEl.textContent   = totalRecs;
  if (badgeEl) badgeEl.textContent = totalRecs;

  if (totalRecs === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="data-table__empty">Nenhum registro encontrado.</td></tr>`;
    renderPagination(0);
    return;
  }

  const start    = (state.page - 1) * state.perPage;
  const pageData = data.slice(start, start + state.perPage);

  pageData.forEach((row, localIdx) => {
    const globalIdx = start + localIdx;
    const rowClass  = getRowClass(row);
    const estoque   = Number(row.qtd_estoque);
    const saida     = Number(row.qtd_saida);
    const consumo   = Number(row.consumo_medio);
    const diff      = saida - consumo;
    const diffSign  = diff > 0 ? '+' : '';

    const tr = document.createElement('tr');
    tr.className   = `data-table__row ${rowClass}`;
    tr.dataset.idx = globalIdx;
    tr.innerHTML = `
      <td class="data-table__cell data-table__cell--mono data-table__cell--os">${escHtml(row.os_id)}</td>
      <td class="data-table__cell data-table__cell--center">${getStatusBadge(row.status)}</td>
      <td class="data-table__cell data-table__cell--id">${escHtml(row.id_produto)}</td>
      <td class="data-table__cell data-table__cell--desc" title="${escHtml(row.descricao)}">${escHtml(row.descricao)}</td>
      <td class="data-table__cell data-table__cell--numeric">${estoque}</td>
      <td class="data-table__cell data-table__cell--numeric">${saida}</td>
      <td class="data-table__cell data-table__cell--numeric">${consumo.toFixed(1)}</td>
      <td class="data-table__cell data-table__cell--numeric ${diff > 0 ? 'cell--neg' : diff < 0 ? 'cell--pos' : ''}">${diffSign}${diff.toFixed(1)}</td>
      <td class="data-table__cell">${escHtml(row.tecnico_nome)}</td>
      <td class="data-table__cell data-table__cell--desc" title="${escHtml(row.os_assunto)}">${escHtml(row.os_assunto)}</td>
      <td class="data-table__cell" title="${escHtml(row.cliente_nome)}">${escHtml(row.cliente_nome)}</td>
      <td class="data-table__cell data-table__cell--mono">${escHtml(row.mes_referencia)}</td>
    `;
    tr.addEventListener('click', () => selectRow(tr, row, globalIdx));
    tbody.appendChild(tr);
  });

  renderPagination(totalRecs);
}

/* --------------------------------------------------------------------------
   Paginação
   -------------------------------------------------------------------------- */
function renderPagination(total) {
  const container = document.getElementById('pagination');
  if (!container) return;

  const totalPages = Math.ceil(total / state.perPage);
  const cur        = state.page;

  if (totalPages <= 1) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <button class="pag__btn" id="pag-prev" ${cur <= 1 ? 'disabled' : ''}>&#8592;</button>
    <span class="pag__info">
      Página <strong>${cur}</strong> de <strong>${totalPages}</strong>
      <span class="pag__total">(${total} registros)</span>
    </span>
    <button class="pag__btn" id="pag-next" ${cur >= totalPages ? 'disabled' : ''}>&#8594;</button>
  `;

  document.getElementById('pag-prev')?.addEventListener('click', () => {
    if (state.page > 1) { state.page--; renderTable(state.filteredData); }
  });
  document.getElementById('pag-next')?.addEventListener('click', () => {
    if (state.page < totalPages) { state.page++; renderTable(state.filteredData); }
  });
}

/* --------------------------------------------------------------------------
   Helpers de status
   -------------------------------------------------------------------------- */
function getRowClass(row) {
  if (row.status === 'divergencia') return 'data-table__row--divergence';
  if (row.status === 'alerta')      return 'data-table__row--warning';
  return '';
}

function getStatusBadge(status) {
  const map = {
    ok:          '<span class="status-badge status-badge--ok">OK</span>',
    alerta:      '<span class="status-badge status-badge--warn">Alerta</span>',
    divergencia: '<span class="status-badge status-badge--alert">Divergência</span>',
  };
  return map[status] || '<span class="status-badge status-badge--ok">OK</span>';
}

/* --------------------------------------------------------------------------
   KPI Cards
   -------------------------------------------------------------------------- */
function renderKPIs(data) {
  const totalEstoque = data.reduce((s, r) => s + Number(r.qtd_estoque),   0);
  const totalSaida   = data.reduce((s, r) => s + Number(r.qtd_saida),     0);
  const consumoMedio = data.length
    ? data.reduce((s, r) => s + Number(r.consumo_medio), 0) / data.length : 0;
  const alertas = data.filter(r => r.status === 'divergencia' || r.status === 'alerta').length;

  animateNumber('kpi-estoque',     totalEstoque);
  animateNumber('kpi-saida',       totalSaida);
  animateNumber('kpi-consumo',     Math.round(consumoMedio * 10) / 10, true);
  animateNumber('kpi-divergencia', alertas);
}

function animateNumber(id, target, isFloat = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration  = 700;
  const startTime = performance.now();
  function step(now) {
    const t       = Math.min((now - startTime) / duration, 1);
    const ease    = 1 - Math.pow(1 - t, 3);
    const current = target * ease;
    el.textContent = isFloat
      ? current.toFixed(1)
      : Math.round(current).toLocaleString('pt-BR');
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* --------------------------------------------------------------------------
   Painel de Alertas
   -------------------------------------------------------------------------- */
function renderAlerts(data) {
  const items     = document.getElementById('alert-items');
  const countEl   = document.getElementById('alert-count');
  const problemas = data.filter(r => r.status === 'divergencia' || r.status === 'alerta');

  if (countEl) countEl.textContent = problemas.length;
  if (!items) return;
  items.innerHTML = '';

  if (problemas.length === 0) {
    items.innerHTML = `<li class="alert-item__empty"><span style="font-size:1.1rem">✓</span> Nenhuma divergência detectada.</li>`;
    return;
  }

  problemas.forEach((r, i) => {
    const diff  = Number(r.qtd_saida) - Number(r.consumo_medio);
    const type  = r.status === 'divergencia' ? 'critical' : 'warning';
    const sign  = diff > 0 ? '+' : '';
    const li    = document.createElement('li');
    li.className = `alert-item alert-item--${type}`;
    li.style.animationDelay = `${i * 50}ms`;
    li.innerHTML = `
      <span class="alert-item__dot"></span>
      <div class="alert-item__body">
        <div class="alert-item__product">${escHtml(r.descricao)}</div>
        <div class="alert-item__detail">OS ${escHtml(r.os_id)} · ${escHtml(r.tecnico_nome)}</div>
      </div>
      <div class="alert-item__right">
        <span class="alert-item__diff">${sign}${diff.toFixed(1)}</span>
        <span class="alert-item__type">${r.status === 'divergencia' ? 'DIVG' : 'ALRT'}</span>
      </div>
    `;
    li.addEventListener('click', () => {
      const idx = state.filteredData.indexOf(r);
      const targetPage = Math.floor(idx / state.perPage) + 1;
      if (state.page !== targetPage) { state.page = targetPage; renderTable(state.filteredData); }
      setTimeout(() => {
        const tr = document.querySelector(`[data-idx="${idx}"]`);
        if (tr) { tr.click(); tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }, 50);
    });
    items.appendChild(li);
  });
}

/* --------------------------------------------------------------------------
   Detalhe da OS
   -------------------------------------------------------------------------- */
function selectRow(tr, row, idx) {
  document.querySelectorAll('.data-table__row--selected')
    .forEach(el => el.classList.remove('data-table__row--selected'));
  tr.classList.add('data-table__row--selected');
  state.selectedRow = row;
  renderDetailPanel(row);
  const btnClose = document.getElementById('btn-close-detail');
  if (btnClose) btnClose.style.display = 'block';
}

function clearDetailPanel() {
  state.selectedRow = null;
  document.querySelectorAll('.data-table__row--selected')
    .forEach(el => el.classList.remove('data-table__row--selected'));
  
  const badgeEl = document.getElementById('detail-os-id');
  const bodyEl  = document.getElementById('detail-body');
  const btnClose = document.getElementById('btn-close-detail');
  
  if (badgeEl) badgeEl.textContent = '—';
  if (btnClose) btnClose.style.display = 'none';
  if (bodyEl) bodyEl.innerHTML = '<p class="detail-panel__empty">Selecione uma linha da tabela para visualizar os detalhes da Ordem de Serviço.</p>';
}

function renderDetailPanel(row) {
  const badgeEl = document.getElementById('detail-os-id');
  const bodyEl  = document.getElementById('detail-body');
  if (!badgeEl || !bodyEl) return;

  badgeEl.textContent = `OS ${row.os_id}` || '—';

  const estoque  = Number(row.qtd_estoque);
  const saida    = Number(row.qtd_saida);
  const consumo  = Number(row.consumo_medio);
  const diff     = saida - consumo;
  const diffStr  = (diff > 0 ? '+' : '') + diff.toFixed(1);
  const diffColor = diff > 0 ? 'var(--c-red)' : 'var(--c-green)';
  const statusMap = {
    ok:          { label: 'Normal',      cls: 'badge--ok'    },
    alerta:      { label: 'Alerta',      cls: 'badge--warn'  },
    divergencia: { label: 'Divergência', cls: 'badge--alert' },
  };
  const st = statusMap[row.status] || statusMap.ok;

  bodyEl.innerHTML = `
    <div class="detail-panel__grid">
      <div class="detail-panel__field detail-panel__field--full">
        <span class="detail-panel__field-label">Assunto da OS</span>
        <span class="detail-panel__field-value">${escHtml(row.os_assunto)}</span>
      </div>
      <div class="detail-panel__field detail-panel__field--full">
        <span class="detail-panel__field-label">Status da Movimentação</span>
        <span class="data-table__cell--badge ${st.cls}" style="margin-top:3px;display:inline-block">${st.label}</span>
      </div>
      <div class="detail-panel__divider"></div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Cliente</span>
        <span class="detail-panel__field-value">${escHtml(row.cliente_nome)}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">ID Cliente</span>
        <span class="detail-panel__field-value--mono">${escHtml(row.cliente_id)}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Técnico</span>
        <span class="detail-panel__field-value">${escHtml(row.tecnico_nome)}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">ID Técnico</span>
        <span class="detail-panel__field-value--mono">${escHtml(row.tecnico_id)}</span>
      </div>
      <div class="detail-panel__divider"></div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">ID Produto</span>
        <span class="detail-panel__field-value--mono">${escHtml(row.id_produto)}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Mês Referência</span>
        <span class="detail-panel__field-value--mono">${escHtml(row.mes_referencia)}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Estoque Atual</span>
        <span class="detail-panel__field-value--mono">${estoque}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Qtd Saída</span>
        <span class="detail-panel__field-value--mono">${saida}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Consumo Médio</span>
        <span class="detail-panel__field-value--mono">${consumo.toFixed(1)}</span>
      </div>
      <div class="detail-panel__field">
        <span class="detail-panel__field-label">Diferença</span>
        <span class="detail-panel__field-value--mono" style="color:${diffColor};font-weight:600">${diffStr}</span>
      </div>
    </div>
  `;
}

/* --------------------------------------------------------------------------
   Eventos
   -------------------------------------------------------------------------- */
function bindEvents() {
  document.getElementById('btn-close-detail')?.addEventListener('click', clearDetailPanel);

  document.getElementById('btn-aplicar')?.addEventListener('click', async () => {
    state.page = 1;
    updateStateFilters();
    await loadAll();
  });

  ['filter-mes','filter-tecnico','filter-cliente','filter-tipo'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      // Usar input também pega digitação do datalist
      updateStateFilters();
      applyLocalFilters();
    });
  });

  const btnDiv = document.getElementById('btn-so-diverg');
  if (btnDiv) {
    btnDiv.addEventListener('click', () => {
      state.soDivergencias = !state.soDivergencias;
      btnDiv.classList.toggle('active', state.soDivergencias);
      btnDiv.textContent = state.soDivergencias ? '⚠ Divergências ON' : '⚠ Só Divergências';
      state.page = 1;
      applyLocalFilters();
    });
  }

  const searchEl = document.getElementById('table-search');
  if (searchEl) {
    let timer;
    searchEl.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.searchQuery = e.target.value.toLowerCase();
        state.page = 1;
        applyLocalFilters();
      }, 200);
    });
  }

  document.querySelectorAll('.data-table__cell--th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      state.sortDirection = state.sortColumn === col && state.sortDirection === 'asc' ? 'desc' : 'asc';
      state.sortColumn    = col;
      document.querySelectorAll('.data-table__cell--th')
        .forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
      th.classList.add(`sorted-${state.sortDirection}`);
      state.page = 1;
      applyLocalFilters();
    });
  });

  document.getElementById('btn-export')?.addEventListener('click', exportCSV);
}

function updateStateFilters() {
  state.filters.mes     = document.getElementById('filter-mes')?.value     || 'todos';
  state.filters.tecnico = document.getElementById('filter-tecnico')?.value || 'todos';
  state.filters.cliente = document.getElementById('filter-cliente')?.value.trim() || 'todos';
  state.filters.tipo    = document.getElementById('filter-tipo')?.value    || 'todos';
}

/* --------------------------------------------------------------------------
   Filtro local (sem nova requisição à API)
   -------------------------------------------------------------------------- */
function applyLocalFilters() {
  const { mes, tecnico, cliente, tipo } = state.filters;

  let filtered = state.data.filter(r => {
    if (mes     !== 'todos' && r.mes_referencia !== mes)     return false;
    if (tecnico !== 'todos' && String(r.tecnico_id) !== tecnico) return false;
    if (cliente !== 'todos' && cliente !== '' && r.cliente_nome !== cliente) return false;
    if (tipo    !== 'todos' && r.tipo_movimentacao !== tipo)  return false;
    if (state.soDivergencias && r.status !== 'divergencia' && r.status !== 'alerta') return false;
    if (state.searchQuery) {
      const haystack = Object.values(r).join(' ').toLowerCase();
      if (!haystack.includes(state.searchQuery)) return false;
    }
    return true;
  });

  if (state.sortColumn) {
    filtered = [...filtered].sort((a, b) => {
      const va = a[state.sortColumn], vb = b[state.sortColumn];
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
      return state.sortDirection === 'asc' ? cmp : -cmp;
    });
  }

  state.filteredData = filtered;
  renderTable(filtered);
  renderKPIs(filtered);
  renderAlerts(filtered);
}

/* --------------------------------------------------------------------------
   Export CSV
   -------------------------------------------------------------------------- */
function exportCSV() {
  const headers = [
    'OS ID','Status','ID Produto','Descrição','Qtd Estoque','Qtd Saída',
    'Consumo Médio','Diferença','Técnico','Assunto OS','Cliente','Mês'
  ];
  const rows = state.filteredData.map(r => {
    const diff = Number(r.qtd_saida) - Number(r.consumo_medio);
    return [
      r.os_id, r.status, r.id_produto, r.descricao,
      r.qtd_estoque, r.qtd_saida, Number(r.consumo_medio).toFixed(1),
      ((diff > 0 ? '+' : '') + diff.toFixed(1)),
      r.tecnico_nome, r.os_assunto, r.cliente_nome, r.mes_referencia
    ];
  });
  const csv  = [headers, ...rows].map(r =>
    r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `estoque_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------------------
   UI helpers
   -------------------------------------------------------------------------- */
function setLoading(on) {
  state.loading = on;
  const tbody = document.getElementById('table-body');
  if (on && tbody) {
    tbody.innerHTML = `<tr><td colspan="12" class="data-table__empty" style="color:var(--c-text-muted)">
      Carregando dados…
    </td></tr>`;
  }
}

function setConnectionStatus(online) {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (dot) {
    dot.className = `statusbar__dot ${online ? 'statusbar__dot--online' : 'statusbar__dot--offline'}`;
  }
  if (label) label.textContent = online ? 'Conectado — Localweb' : 'Erro de conexão';
}

function showError(msg) {
  const tbody = document.getElementById('table-body');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="12" class="data-table__empty" style="color:var(--c-red)">
      Erro ao carregar dados: ${escHtml(msg)}
    </td></tr>`;
  }
}

function startClock() {
  const elUpdate = document.getElementById('last-update');
  const elSync   = document.getElementById('sync-time');
  const tick = () => {
    const now = new Date().toLocaleTimeString('pt-BR');
    if (elUpdate) elUpdate.textContent = now;
    if (elSync)   elSync.textContent   = now;
  };
  tick();
  setInterval(tick, 1000);
}

function simulateRealtime() {
  setInterval(() => {
    const dot = document.getElementById('conn-dot');
    if (dot) {
      dot.style.boxShadow = '0 0 0 6px rgba(40,167,69,0.4)';
      setTimeout(() => { dot.style.boxShadow = ''; }, 500);
    }
  }, 30000);
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
