// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Idea, PrototypeV1, Widget } from '../../../core';
import { store } from '../../../store';
import { SimulationController } from './simulator';
import { renderDashboardTab } from './ui';
import { renderDashboardWidgets } from './widgets';

const WIDGETS: Widget[] = [
  { type: 'gauge', key: 'temp', label: 'درجة الحرارة', min: 0, max: 50, unit: '°C' },
  { type: 'line_chart', key: 'humidity', label: 'الرطوبة', min: 0, max: 100, unit: '%' },
  { type: 'status_badge', key: 'online', label: 'الحالة' },
  { type: 'toggle_switch', key: 'led', label: 'المصباح' },
  { type: 'slider', key: 'fan', label: 'سرعة المروحة', min: 0, max: 100, unit: '%' },
];

describe('iot dashboard & simulator (S7)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<dialog id="dlg"></dialog>`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders all 5 widget types from JSON in jsdom', () => {
    const host = document.createElement('div');
    const onControl = vi.fn();

    renderDashboardWidgets(
      host,
      WIDGETS,
      { temp: 26.5, humidity: 62, online: true, led: false, fan: 40 },
      { humidity: [58, 60, 62] },
      onControl
    );

    expect(host.querySelector('[data-widget-type="gauge"] svg')).not.toBeNull();
    expect(host.querySelector('[data-widget-type="gauge"]')?.textContent).toContain('26.5 °C');
    expect(host.querySelector('[data-widget-type="line_chart"] polyline')).not.toBeNull();
    expect(host.querySelector('[data-widget-type="status_badge"]')?.textContent).toContain('نشط');

    const switchBtn = host.querySelector<HTMLButtonElement>('[data-control-type="toggle"]');
    expect(switchBtn?.getAttribute('aria-checked')).toBe('false');
    switchBtn?.click();
    expect(onControl).toHaveBeenCalledWith('led', true);

    const slider = host.querySelector<HTMLInputElement>('[data-control-type="slider"]');
    expect(slider?.value).toBe('40');
    if (slider) {
      slider.value = '75';
      slider.dispatchEvent(new Event('input'));
    }
    expect(onControl).toHaveBeenCalledWith('fan', 75);
  });

  it('streams simulation frames at interval_ms and preserves local control overrides', () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const sim = new SimulationController(
      [
        { temp: 22, humidity: 50, led: false, fan: 10 },
        { temp: 25, humidity: 55, led: false, fan: 20 },
        { temp: 29, humidity: 60, led: false, fan: 30 },
      ],
      500,
      (_state, _history, idx) => ticks.push(idx)
    );

    sim.start();
    expect(sim.isRunning()).toBe(true);
    expect(sim.getState().temp).toBe(22);

    sim.setControlValue('led', true);
    sim.setControlValue('fan', 85);

    vi.advanceTimersByTime(500);
    expect(sim.getState().temp).toBe(25);
    expect(sim.getHistory().temp).toEqual([22, 25]);
    // Local control overrides remain sticky across simulation frames
    expect(sim.getState().led).toBe(true);
    expect(sim.getState().fan).toBe(85);

    vi.advanceTimersByTime(500);
    expect(sim.getState().temp).toBe(29);
    expect(sim.getHistory().temp).toEqual([22, 25, 29]);

    sim.stop();
    expect(sim.isRunning()).toBe(false);
    const tickCountAfterStop = ticks.length;
    vi.advanceTimersByTime(1500);
    expect(ticks.length).toBe(tickCountAfterStop);
  });

  it('mounts dashboard tab from stored prototype and responds to simulation and switches', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    const idea: Idea = {
      id: 'dash-idea-1',
      schemaVersion: 3,
      created: Date.now(),
      name: 'اختبار لوحة',
      domain: 'IoT',
      type: 'both',
      status: 'planned',
      lifecycle: 'prototype_generated',
      memory: '',
      problem: 'اختبار',
      solution: 'ESP32',
      focus: 'aligned',
      focus_note: '',
      skills: [],
      duration: '',
      plan: [],
      plan_history: [],
      components: [],
      notes: '',
    };

    const proto: PrototypeV1 = {
      schema_version: 1,
      board: { fqbn: 'esp32:esp32:esp32', ota: true },
      wiring: [{ part: 'DHT22', part_pin: 'DATA', mcu_pin: 'GPIO4' }],
      firmware: { files: [{ name: 'main.ino', content: 'void setup(){} void loop(){}' }], libraries: [] },
      dashboard: WIDGETS,
      simulation: {
        interval_ms: 400,
        frames: [
          { temp: 21, humidity: 45, online: true, led: false, fan: 20 },
          { temp: 28, humidity: 65, online: true, led: false, fan: 50 },
        ],
      },
      warnings: [],
    };

    await store.savePrototypeRevision(idea.id, proto);

    const tabEl = renderDashboardTab(idea);
    document.getElementById('dlg')!.appendChild(tabEl);

    // Wait for async IDB read inside loadAndRender
    await vi.waitFor(() => {
      expect(tabEl.querySelector('[data-action="toggle-sim"]')).not.toBeNull();
    });

    const simBtn = tabEl.querySelector<HTMLButtonElement>('[data-action="toggle-sim"]')!;
    simBtn.click();
    expect(tabEl.querySelector('[data-role="sim-status"]')?.textContent).toContain('حية');

    vi.advanceTimersByTime(400);
    expect(tabEl.querySelector('[data-widget-type="gauge"]')?.textContent).toContain('28 °C');

    tabEl.querySelector<HTMLButtonElement>('[data-control-type="toggle"]')?.click();
    expect(tabEl.querySelector('[data-role="sim-state-line"]')?.textContent).toContain('led=true');

    simBtn.click();
    expect(tabEl.querySelector('[data-role="sim-status"]')?.textContent).toContain('متوقفة');
  });
});
