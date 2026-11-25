// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Idea, PrototypeV1, Widget } from '../../../core';
import * as supaClientMod from '../../../store/supabaseClient';
import { getCommandStatus, store } from '../../../store';
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

    // Switch to live Realtime mode cleanly and test sending iot_commands on toggle
    const insertedCommands: any[] = [];
    const fakeClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
      },
      from: (table: string) => {
        if (table === 'devices') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'dev-live-1',
                      user_id: 'u1',
                      idea_id: idea.id,
                      name: 'ESP32',
                      board: 'esp32:esp32:esp32',
                      last_seen_at: new Date().toISOString(),
                      created_at: new Date().toISOString(),
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'iot_telemetry') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'iot_commands') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
            insert: (row: any) => {
              const rec = {
                id: 'cmd-1',
                ...row,
                executed_at: null,
                created_at: new Date().toISOString(),
              };
              insertedCommands.push(rec);
              return {
                select: () => ({
                  single: async () => ({ data: rec, error: null }),
                }),
              };
            },
          };
        }
        return {};
      },
      channel: () => ({
        on: function () {
          return this;
        },
        subscribe: () => ({}),
      }),
      removeChannel: async () => {},
    };

    vi.spyOn(supaClientMod, 'getSupabaseClient').mockReturnValue(fakeClient as any);
    vi.spyOn(supaClientMod, 'getCurrentSupabaseUser').mockResolvedValue({ id: 'u1' } as any);

    tabEl.querySelector<HTMLButtonElement>('[data-mode="live"]')?.click();
    await vi.waitFor(() => {
      expect(tabEl.querySelector('[data-role="live-badge"]')).not.toBeNull();
      expect(tabEl.querySelector('[data-role="commands-box"]')).not.toBeNull();
    });

    tabEl.querySelector<HTMLButtonElement>('[data-control-type="toggle"]')?.click();
    await vi.waitFor(() => {
      expect(insertedCommands).toHaveLength(1);
      expect(insertedCommands[0].action).toBe('led');
      expect(insertedCommands[0].value).toBe(true);
      expect(tabEl.querySelector('[data-role="commands-box"]')?.textContent).toContain('قيد الانتظار');
    });

    const now = 1_700_000_000_000;
    expect(
      getCommandStatus({ executed_at: null, expires_at: new Date(now + 60_000).toISOString() }, now)
    ).toBe('pending');
    expect(
      getCommandStatus({ executed_at: null, expires_at: new Date(now - 1000).toISOString() }, now)
    ).toBe('expired');
    expect(
      getCommandStatus(
        { executed_at: new Date(now).toISOString(), expires_at: new Date(now - 1000).toISOString() },
        now
      )
    ).toBe('executed');

    vi.restoreAllMocks();
  });
});
