/* ==========================================================================
   CHARTS — Canvas rendering (sem dependências externas)
   ========================================================================== */

const PALETTE = {
  navy:        '#1a2744',
  navyMid:     '#2d4170',
  navyLight:   '#3d5490',
  orange:      '#f5890a',
  orangeLight: '#ffa940',
  green:       '#28a745',
  blue:        '#4a90d9',
  surface:     '#f4f6fb',
  border:      '#d1d9eb',
  muted:       '#8899bb',
  text:        '#4a5a7a',
};

/* --------------------------------------------------------------------------
   Utilitários
   -------------------------------------------------------------------------- */
function dpr() { return window.devicePixelRatio || 1; }

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = dpr();
  canvas.width  = rect.width  * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { ctx, w: rect.width, h: rect.height };
}

function lerp(a, b, t) { return a + (b - a) * t; }

/* --------------------------------------------------------------------------
   Bar Chart — Consumo por Técnico
   -------------------------------------------------------------------------- */
export function drawBarChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const { ctx, w, h } = setupCanvas(canvas);
  const padding = { top: 14, right: 16, bottom: 36, left: 40 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  if (!data || data.length === 0) return;

  const maxVal = Math.max(...data.map(d => d.consumo));
  const barW   = chartW / data.length;
  const barPad = barW * 0.25;

  /* Grid lines */
  const steps = 4;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  for (let i = 0; i <= steps; i++) {
    const y = padding.top + chartH - (i / steps) * chartH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();

    /* Y labels */
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `${9 * dpr() === 1 ? 1 : 1}px 'IBM Plex Mono', monospace`;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round((i / steps) * maxVal), padding.left - 6, y + 3);
  }
  ctx.setLineDash([]);

  /* Bars with gradient + animation */
  data.forEach((d, i) => {
    const x      = padding.left + i * barW + barPad / 2;
    const bw     = barW - barPad;
    const bh     = (d.consumo / maxVal) * chartH;
    const y      = padding.top + chartH - bh;
    const isDivg = d.consumo > maxVal * 0.8;

    const grad = ctx.createLinearGradient(x, y, x, y + bh);
    if (isDivg) {
      grad.addColorStop(0, PALETTE.orange);
      grad.addColorStop(1, 'rgba(245,137,10,0.3)');
    } else {
      grad.addColorStop(0, PALETTE.blue);
      grad.addColorStop(1, 'rgba(74,144,217,0.3)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, bw, bh, [2, 2, 0, 0]) : ctx.rect(x, y, bw, bh);
    ctx.fill();

    /* Value label on top */
    ctx.fillStyle = isDivg ? PALETTE.orange : PALETTE.navyLight;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d.consumo, x + bw / 2, y - 3);

    /* X label */
    ctx.fillStyle = PALETTE.text;
    ctx.font = '9px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    const label = d.nome.length > 8 ? d.nome.slice(0, 7) + '.' : d.nome;
    ctx.fillText(label, x + bw / 2, padding.top + chartH + 14);
  });

  /* Axis line */
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + chartH);
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.stroke();
}

/* --------------------------------------------------------------------------
   Line Chart — Evolução do Estoque
   -------------------------------------------------------------------------- */
export function drawLineChart(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const { ctx, w, h } = setupCanvas(canvas);
  const padding = { top: 14, right: 20, bottom: 36, left: 44 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  if (!data || data.length === 0) return;

  const vals   = data.map(d => d.valor);
  const minVal = Math.min(...vals) * 0.9;
  const maxVal = Math.max(...vals) * 1.05;
  const range  = maxVal - minVal;

  const toX = i => padding.left + (i / (data.length - 1)) * chartW;
  const toY = v => padding.top + chartH - ((v - minVal) / range) * chartH;

  /* Grid */
  const steps = 4;
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  for (let i = 0; i <= steps; i++) {
    const v = minVal + (i / steps) * range;
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(v), padding.left - 6, y + 3);
  }
  ctx.setLineDash([]);

  /* Area fill */
  const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  grad.addColorStop(0, 'rgba(74,144,217,0.18)');
  grad.addColorStop(1, 'rgba(74,144,217,0)');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0].valor));
  data.forEach((d, i) => { if (i > 0) ctx.lineTo(toX(i), toY(d.valor)); });
  ctx.lineTo(toX(data.length - 1), padding.top + chartH);
  ctx.lineTo(toX(0), padding.top + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* Line */
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0].valor));
  data.forEach((d, i) => { if (i > 0) ctx.lineTo(toX(i), toY(d.valor)); });
  ctx.strokeStyle = PALETTE.blue;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  /* Points + labels */
  data.forEach((d, i) => {
    const x = toX(i);
    const y = toY(d.valor);

    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.blue;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* X label */
    ctx.fillStyle = PALETTE.text;
    ctx.font = '9px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.mes, x, padding.top + chartH + 14);

    /* Value above point */
    ctx.fillStyle = PALETTE.navyLight;
    ctx.font = '8px "IBM Plex Mono", monospace';
    ctx.fillText(d.valor, x, y - 7);
  });

  /* Axis */
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + chartH);
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.stroke();
}

/* --------------------------------------------------------------------------
   Re-render on resize
   -------------------------------------------------------------------------- */
let resizeTimer;
export function attachResizeObserver(barId, lineId, barData, lineData) {
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawBarChart(barId, barData);
      drawLineChart(lineId, lineData);
    }, 80);
  });
  const bar  = document.getElementById(barId);
  const line = document.getElementById(lineId);
  if (bar?.parentElement)  observer.observe(bar.parentElement);
  if (line?.parentElement) observer.observe(line.parentElement);
}
