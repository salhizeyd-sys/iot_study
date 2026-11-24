import { Idea, bus } from '../../../core';
import { store } from '../../../store';
import { esc } from '../../../ui';
import { SimulationController } from './simulator';
import { renderDashboardWidgets, TelemetryHistory, TelemetryState } from './widgets';

export function renderDashboardTab(idea: Idea): HTMLElement {
  const root = document.createElement('div');
  root.className = 'dash-tab';
  root.innerHTML = `<p style="color:var(--mu)">جارٍ تحميل لوحة التحكم…</p>`;

  let controller: SimulationController | null = null;
  let unsubscribeBus: (() => void) | null = null;

  function cleanup() {
    if (controller?.isRunning()) {
      controller.stop();
    }
    controller = null;
    unsubscribeBus?.();
    unsubscribeBus = null;
  }

  // Stop background simulation timer when parent dialog closes
  const dlg = document.getElementById('dlg');
  if (dlg) {
    dlg.addEventListener('close', cleanup, { once: true });
  }

  async function loadAndRender() {
    if (controller?.isRunning()) {
      controller.stop();
    }
    const latest = await store.getLatestPrototype(idea.id);
    if (!latest) {
      root.innerHTML = `<div class="warn">ولّد نموذجاً أولياً أولاً لتظهر لوحة التحكم والمحاكاة.</div>`;
      return;
    }

    const { dashboard, simulation } = latest.data;

    root.innerHTML = `
      <div class="bar" style="justify-content:space-between">
        <div>
          <span class="tag" data-role="sim-status">المحاكاة متوقفة</span>
          <span class="tag">الفاصل: ${simulation.interval_ms}ms</span>
          <span class="tag" data-role="frame-badge">الإطارات: ${simulation.frames.length}</span>
        </div>
        <button type="button" class="btn" data-action="toggle-sim">▶ تشغيل المحاكاة</button>
      </div>
      <div class="dash-grid" data-role="widgets-host"></div>
      <div class="warn" style="font-size:13px" data-role="sim-state-line">الحالة المحلية: جاهزة</div>
    `;

    const widgetsHost = root.querySelector<HTMLElement>('[data-role="widgets-host"]')!;
    const statusBadge = root.querySelector<HTMLElement>('[data-role="sim-status"]')!;
    const frameBadge = root.querySelector<HTMLElement>('[data-role="frame-badge"]')!;
    const stateLine = root.querySelector<HTMLElement>('[data-role="sim-state-line"]')!;
    const simBtn = root.querySelector<HTMLButtonElement>('[data-action="toggle-sim"]')!;

    const paintWidgets = (
      state: TelemetryState,
      history: TelemetryHistory,
      frameIdx: number
    ) => {
      const running = Boolean(controller?.isRunning());
      statusBadge.textContent = running ? 'قيد المحاكاة (حية)' : 'المحاكاة متوقفة';
      statusBadge.className = `tag ${running ? 'ok' : ''}`;
      simBtn.textContent = running ? '⏹ إيقاف المحاكاة' : '▶ تشغيل المحاكاة';
      frameBadge.textContent = simulation.frames.length
        ? `إطار ${frameIdx + 1}/${simulation.frames.length}`
        : 'لا إطارات';

      const pairs = Object.entries(state)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' · ');
      stateLine.textContent = `الحالة المحلية: ${pairs || '—'}`;

      renderDashboardWidgets(widgetsHost, dashboard, state, history, (key, value) => {
        controller?.setControlValue(key, value);
      });
    };

    controller = new SimulationController(
      simulation.frames,
      simulation.interval_ms,
      paintWidgets
    );

    paintWidgets(controller.getState(), controller.getHistory(), controller.getFrameIndex());

    simBtn.addEventListener('click', () => {
      if (!controller) return;
      if (controller.isRunning()) {
        controller.stop();
      } else {
        controller.start();
      }
    });
  }

  unsubscribeBus = bus.on('prototype:generated', (payload) => {
    if (payload.ideaId === idea.id) {
      void loadAndRender();
    }
  });

  // Expose minor metadata for accessibility/diagnostics
  root.dataset.ideaId = esc(idea.id);
  void loadAndRender();
  return root;
}
