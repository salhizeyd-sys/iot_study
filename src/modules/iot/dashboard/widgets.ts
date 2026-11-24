import { Widget } from '../../../core';
import { esc } from '../../../ui';

export type TelemetryValue = number | boolean | string;
export type TelemetryState = Record<string, TelemetryValue>;
export type TelemetryHistory = Record<string, number[]>;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function renderGaugeSvg(widget: Widget, rawVal: TelemetryValue | undefined): string {
  const min = widget.min ?? 0;
  const max = widget.max ?? 100;
  const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
  const hasNum = Number.isFinite(num);
  const ratio = hasNum && max > min ? clamp((num - min) / (max - min), 0, 1) : 0;

  const r = 64;
  const cx = 90;
  const cy = 84;
  const arcLen = Math.PI * r;
  const dashOffset = arcLen * (1 - ratio);
  const displayVal = hasNum ? `${Number(num.toFixed(1))}${widget.unit ? ' ' + widget.unit : ''}` : '—';

  return `
    <svg class="widget-svg" viewBox="0 0 180 105" aria-label="${esc(widget.label)}">
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--bd)" stroke-width="12" stroke-linecap="round" />
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="var(--ac)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${arcLen.toFixed(2)}" stroke-dashoffset="${dashOffset.toFixed(2)}" />
      <text x="${cx}" y="${cy - 12}" text-anchor="middle" fill="var(--tx)" font-size="18" font-weight="700">${esc(displayVal)}</text>
      <text x="${cx - r}" y="${cy + 16}" text-anchor="middle" fill="var(--mu)" font-size="11">${min}</text>
      <text x="${cx + r}" y="${cy + 16}" text-anchor="middle" fill="var(--mu)" font-size="11">${max}</text>
    </svg>`;
}

function renderLineChartSvg(
  widget: Widget,
  rawVal: TelemetryValue | undefined,
  series: number[]
): string {
  const points = series.length ? series : typeof rawVal === 'number' ? [rawVal] : [];
  const w = 240;
  const h = 92;
  const padX = 10;
  const padY = 12;

  if (!points.length) {
    return `<svg class="widget-svg" viewBox="0 0 ${w} ${h}" aria-label="${esc(widget.label)}">
      <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="var(--mu)" font-size="12">بانتظار القراءات…</text>
    </svg>`;
  }

  const dataMin = widget.min ?? Math.min(...points);
  const dataMax = widget.max ?? Math.max(...points);
  const span = dataMax - dataMin || 1;

  const coords = points.map((val, idx) => {
    const x =
      points.length === 1
        ? w / 2
        : padX + (idx / (points.length - 1)) * (w - padX * 2);
    const normY = clamp((val - dataMin) / span, 0, 1);
    const y = h - padY - normY * (h - padY * 2);
    return { x, y };
  });

  const polyPoints = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  const latestVal = points[points.length - 1];

  return `
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--mu);margin-bottom:4px">
      <span>الحالي: <b style="color:var(--tx)">${Number(latestVal.toFixed(2))}${
        widget.unit ? ' ' + esc(widget.unit) : ''
      }</b></span>
      <span>${points.length} نقطة</span>
    </div>
    <svg class="widget-svg" viewBox="0 0 ${w} ${h}" aria-label="${esc(widget.label)}">
      <line x1="${padX}" y1="${h - padY}" x2="${w - padX}" y2="${h - padY}" stroke="var(--bd)" stroke-width="1" />
      <polyline fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${polyPoints}" />
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="var(--ac)" />
    </svg>`;
}

function renderStatusBadge(widget: Widget, rawVal: TelemetryValue | undefined): string {
  const isBool = typeof rawVal === 'boolean';
  const text =
    rawVal === undefined
      ? 'غير متصل'
      : isBool
        ? rawVal
          ? 'نشط (ON)'
          : 'متوقف (OFF)'
        : `${String(rawVal)}${widget.unit ? ' ' + widget.unit : ''}`;

  const cls =
    rawVal === true || String(rawVal).toLowerCase() === 'online' || String(rawVal).toLowerCase() === 'ok'
      ? 'ok'
      : rawVal === false || rawVal === undefined
        ? 'wn'
        : '';

  return `<div class="badge-pill tag ${cls}" data-widget-key="${esc(widget.key)}">${esc(text)}</div>`;
}

export function renderDashboardWidgets(
  container: HTMLElement,
  widgets: Widget[],
  state: TelemetryState,
  history: TelemetryHistory,
  onControlChange: (key: string, value: TelemetryValue) => void
): void {
  if (!widgets.length) {
    container.innerHTML = `<div class="warn">لا توجد عناصر لوحة تحكم معرّفة في هذا النموذج.</div>`;
    return;
  }

  container.innerHTML = widgets
    .map((w) => {
      const val = state[w.key];
      let body = '';
      if (w.type === 'gauge') {
        body = renderGaugeSvg(w, val);
      } else if (w.type === 'line_chart') {
        body = renderLineChartSvg(w, val, history[w.key] || []);
      } else if (w.type === 'status_badge') {
        body = renderStatusBadge(w, val);
      } else if (w.type === 'toggle_switch') {
        const checked = Boolean(val);
        body = `<button type="button" class="btn switch-btn ${
          checked ? '' : 'g'
        }" role="switch" aria-checked="${checked}" data-control-type="toggle" data-key="${esc(
          w.key
        )}">${checked ? '🟢 تشغيل (ON)' : '⚪ إيقاف (OFF)'}</button>`;
      } else if (w.type === 'slider') {
        const min = w.min ?? 0;
        const max = w.max ?? 100;
        const num = typeof val === 'number' ? val : min;
        body = `<div class="slider-wrap">
          <div style="font-weight:700;margin-bottom:4px" data-slider-val="${esc(w.key)}">${num}${
            w.unit ? ' ' + esc(w.unit) : ''
          }</div>
          <input type="range" min="${min}" max="${max}" value="${num}" data-control-type="slider" data-key="${esc(
            w.key
          )}" aria-label="${esc(w.label)}">
        </div>`;
      }

      return `<div class="widget-card" data-widget-type="${esc(w.type)}" data-widget="${esc(
        w.key
      )}">
        <div class="widget-title">${esc(w.label)}</div>
        <div class="widget-body">${body}</div>
      </div>`;
    })
    .join('');

  container
    .querySelectorAll<HTMLButtonElement>('[data-control-type="toggle"]')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (!key) return;
        const current = Boolean(state[key]);
        onControlChange(key, !current);
      });
    });

  container
    .querySelectorAll<HTMLInputElement>('[data-control-type="slider"]')
    .forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.key;
        if (!key) return;
        onControlChange(key, Number(inp.value));
      });
    });
}
