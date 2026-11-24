// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, caps, mergeSettings, registry } from '../core';
import { toMD } from '../export';
import { S, store } from '../store';
import {
  discussIdea,
  finalize,
  openIdea,
  openQuickCapture,
  saveQuickDraft,
  send,
  setupWindowGlobals,
  vaultModule,
} from '../modules/vault';
import { generatePrototype, iotPrototypeModule } from '../modules/iot/prototype';
import { iotDashboardModule } from '../modules/iot/dashboard';

describe('M1 end-to-end mobile flow (S8 automated verification)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="app"></main>
      <nav class="bottom-nav">
        <button data-nav="home"></button>
        <button data-nav="new"></button>
        <button data-nav="quick"></button>
        <button data-nav="settings"></button>
      </nav>
      <dialog id="dlg"></dialog>
      <dialog id="set"></dialog>
      <dialog id="quick"></dialog>
      <div id="toast"></div>
    `;
    S.ideas = [];
    S.settings = mergeSettings({ provider: 'openai', key: 'm1-test-key' });
    caps.touch = true;
    caps.speech = true;

    registry.clear();
    bus.clear();
    registry.register(vaultModule);
    registry.register(iotPrototypeModule);
    registry.register(iotDashboardModule);
    registry.bindToBus(bus, () => S.settings);
    setupWindowGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('completes capture -> discuss -> plan -> prototype v1 -> dashboard sim -> revision v2 -> md export', async () => {
    const protoV1 = {
      schema_version: 1,
      board: { fqbn: 'esp32:esp32:esp32', ota: true },
      wiring: [
        { part: 'DHT22', part_pin: 'DATA', mcu_pin: 'GPIO4', note: 'pull-up 10k' },
        { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO18', note: '220 ohm' },
      ],
      firmware: {
        files: [
          {
            name: 'main.ino',
            content:
              '#include <Preferences.h>\nPreferences prefs;\nvoid setup(){prefs.begin("iot_vault",true);}\nvoid loop(){}',
          },
        ],
        libraries: ['DHT sensor library'],
      },
      dashboard: [
        { type: 'gauge', key: 'temp', label: 'الحرارة', min: 0, max: 50, unit: '°C' },
        { type: 'line_chart', key: 'temp', label: 'سجل الحرارة', min: 0, max: 50, unit: '°C' },
        { type: 'toggle_switch', key: 'led', label: 'المصباح' },
      ],
      simulation: {
        interval_ms: 500,
        frames: [
          { temp: 23.0, led: false },
          { temp: 27.5, led: true },
        ],
      },
      warnings: ['راجع جهد تغذية DHT22 (3.3V)'],
    };

    const protoV2 = {
      ...protoV1,
      wiring: [
        protoV1.wiring[0],
        { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO25', note: '220 ohm' },
      ],
    };

    const planJson = {
      name: 'مراقب الغرفة DHT22 + LED',
      domain: 'IoT',
      type: 'both',
      problem: 'ارتفاع حرارة الغرفة دون تنبيه',
      solution: 'ESP32 + DHT22 + LED مع لوحة مراقبة',
      focus: 'aligned',
      focus_note: 'ضمن أهداف الأنظمة المدمجة',
      skills_needed: ['ESP32', 'Preferences'],
      duration: 'أسبوع',
      plan: [{ step: 'توصيل الحساس والمصباح', detail: 'GPIO4 و GPIO18' }],
      components: [
        { name: 'ESP32', qty: 1 },
        { name: 'DHT22', qty: 1 },
        { name: 'LED', qty: 1 },
      ],
    };

    const fetchMock = vi
      .fn()
      // 1. Discuss reply
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'فكرة ممتازة، هل ستستخدم ESP32؟' } }],
        }),
      })
      // 2. Finalize plan JSON
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(planJson) } }],
        }),
      })
      // 3. Prototype v1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(protoV1) } }],
        }),
      })
      // 4. Prototype v2 revision
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(protoV2) } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    // 1. Quick capture draft
    openQuickCapture();
    expect(document.querySelector('#mic-btn')).not.toBeNull();
    document.querySelector<HTMLTextAreaElement>('#quick-text')!.value =
      'مراقبة حرارة الغرفة عبر ESP32 وDHT22 وتشغيل LED';
    saveQuickDraft();
    expect(S.ideas).toHaveLength(1);

    // 2. Discuss and convert to plan
    discussIdea(S.ideas[0].id);
    document.querySelector<HTMLTextAreaElement>('#inp')!.value = 'نعم سأستخدم ESP32';
    await send();
    await finalize();

    const idea = S.ideas[0];
    expect(idea.name).toBe('مراقب الغرفة DHT22 + LED');
    expect(idea.plan).toHaveLength(1);

    // 3. Generate prototype v1
    const gen1 = await generatePrototype(idea);
    expect(gen1.record.revision).toBe(1);
    expect(gen1.pinCheck.valid).toBe(true);
    expect(idea.lifecycle).toBe('prototype_generated');

    // 4. Open idea modal and verify 3 tabs + sticky header + FAB hidden state
    openIdea(idea.id);
    expect(document.body.classList.contains('idea-modal-open')).toBe(true);
    expect(document.querySelector('#dlg [data-head-action="discuss"]')).not.toBeNull();
    expect(document.querySelector('#dlg [data-head-action="export-md"]')).not.toBeNull();

    const planTab = document.querySelector<HTMLButtonElement>('[data-tab-id="plan"]')!;
    const protoTab = document.querySelector<HTMLButtonElement>('[data-tab-id="prototype"]')!;
    const dashTab = document.querySelector<HTMLButtonElement>('[data-tab-id="dashboard"]')!;
    expect(planTab.getAttribute('aria-selected')).toBe('true');

    protoTab.click();
    await vi.waitFor(() => {
      const protoPanel = document.querySelector<HTMLElement>('[data-panel-id="prototype"]')!;
      expect(protoPanel.hidden).toBe(false);
      expect(protoPanel.textContent).toContain('GPIO18');
      expect(protoPanel.textContent).toContain('Preferences.h');
    });
    // Touch device uses <pre> with copy button rather than Monaco
    expect(document.querySelector('#dlg pre')).not.toBeNull();

    dashTab.click();
    await vi.waitFor(() => {
      const dashPanel = document.querySelector<HTMLElement>('[data-panel-id="dashboard"]')!;
      expect(dashPanel.hidden).toBe(false);
      expect(dashPanel.textContent).toContain('تشغيل المحاكاة');
    });

    // 5. Revise prototype -> revision v2
    const gen2 = await generatePrototype(idea, {
      revisionFeedback: 'انقل LED إلى GPIO25',
      previous: gen1.record,
    });
    expect(gen2.record.revision).toBe(2);

    // 6. Export MD includes plan, wiring, code, and warnings
    const latest = await store.getLatestPrototype(idea.id);
    const md = toMD(idea, latest);
    expect(md).toContain('# مراقب الغرفة DHT22 + LED');
    expect(md).toContain('## النموذج الأولي (v2)');
    expect(md).toContain('GPIO25');
    expect(md).toContain('main.ino');
    expect(md).toContain('راجع جهد تغذية DHT22 (3.3V)');
  });
});
