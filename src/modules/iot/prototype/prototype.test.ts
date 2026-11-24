import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Idea, PrototypeV1, mergeSettings } from '../../../core';
import { toMD, toPrompt } from '../../../export';
import { S, store } from '../../../store';
import { checkEsp32Pins } from './pinChecker';
import { parsePrototypeResponse } from './schema';
import { computePrototypeDiff, generatePrototype } from './generator';

const VALID_PROTO: PrototypeV1 = {
  schema_version: 1,
  board: { fqbn: 'esp32:esp32:esp32', ota: true },
  wiring: [
    { part: 'DHT22', part_pin: 'VCC', mcu_pin: '3V3', note: 'تغذية' },
    { part: 'DHT22', part_pin: 'GND', mcu_pin: 'GND' },
    { part: 'DHT22', part_pin: 'DATA', mcu_pin: 'GPIO4', note: 'مع مقاومة 10k' },
    { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO18', note: 'مقاومة 220 أوم' },
  ],
  firmware: {
    files: [
      {
        name: 'main.ino',
        content:
          '#include <Preferences.h>\nPreferences prefs;\nvoid setup(){ prefs.begin("iot_vault", true); }\nvoid loop(){}',
      },
    ],
    libraries: ['DHT sensor library'],
  },
  dashboard: [
    { type: 'gauge', key: 'temp', label: 'الحرارة', min: 0, max: 50, unit: '°C' },
    { type: 'toggle_switch', key: 'led', label: 'المصباح' },
  ],
  simulation: {
    interval_ms: 1000,
    frames: [{ temp: 24.5, led: false }, { temp: 25.1, led: true }],
  },
  warnings: ['تحقق من مقاومة السحب على DHT22'],
};

const SAMPLE_IDEA: Idea = {
  id: 'iot-proto-1',
  schemaVersion: 3,
  created: 1000,
  name: 'مراقب حرارة DHT22 + LED',
  domain: 'IoT',
  type: 'hardware',
  status: 'planned',
  lifecycle: 'planned',
  memory: '',
  problem: 'مراقبة الحرارة وتشغيل تنبيه LED',
  solution: 'ESP32 + DHT22 + LED',
  focus: 'aligned',
  focus_note: '',
  skills: ['ESP32'],
  duration: 'أسبوع',
  plan: [{ step: 'التوصيل', detail: 'ربط الحساس', done: false }],
  plan_history: [],
  components: [
    { name: 'ESP32', qty: 1 },
    { name: 'DHT22', qty: 1 },
    { name: 'LED', qty: 1 },
  ],
  notes: '',
};

describe('iot prototype module (S6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses valid PrototypeV1 JSON', () => {
    const res = parsePrototypeResponse(JSON.stringify(VALID_PROTO));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.board.fqbn).toBe('esp32:esp32:esp32');
      expect(res.data.wiring).toHaveLength(4);
    }
  });

  it('rejects incomplete or invalid PrototypeV1 JSON', () => {
    const incomplete = JSON.stringify({
      schema_version: 1,
      board: { fqbn: 'arduino:avr:uno', ota: false },
      wiring: [],
    });
    const res = parsePrototypeResponse(incomplete);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('ESP32');
    }
  });

  it('tolerates extra prose and markdown fences around JSON', () => {
    const wrapped = `إليك النموذج المطلوب:\n\`\`\`json\n${JSON.stringify(VALID_PROTO)}\n\`\`\`\nملاحظة: راجع الأسلاك قبل التشغيل {هذا قوس توضيحي}.`;
    const res = parsePrototypeResponse(wrapped);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.firmware.files[0].name).toBe('main.ino');
    }
  });

  it('checks ESP32 pins deterministically (valid and failing cases)', () => {
    const ok = checkEsp32Pins(VALID_PROTO.wiring);
    expect(ok.valid).toBe(true);
    expect(ok.issues).toHaveLength(0);

    const bad = checkEsp32Pins([
      { part: 'DHT22', part_pin: 'DATA', mcu_pin: 'GPIO4' },
      { part: 'Relay', part_pin: 'IN', mcu_pin: 'D4' }, // duplicate GPIO4
      { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO34' }, // input-only output error
      { part: 'Button', part_pin: 'OUT', mcu_pin: 'GPIO0' }, // boot pin warning
      { part: 'Sensor', part_pin: 'SDA', mcu_pin: 'GPIO6' }, // flash SPI error
      { part: 'LDR', part_pin: 'AO', mcu_pin: 'GPIO35' }, // input-only warning
    ]);

    expect(bad.valid).toBe(false);
    const codes = bad.issues.map((i) => i.code);
    expect(codes).toContain('duplicate');
    expect(codes).toContain('input_only');
    expect(codes).toContain('boot_pin');
    expect(codes).toContain('flash_pin');
  });

  it('retries once on invalid LLM JSON and stores revisions in IndexedDB', async () => {
    S.settings = mergeSettings({ provider: 'openai', key: 'test-key' });

    const modifiedProto: PrototypeV1 = {
      ...VALID_PROTO,
      wiring: [
        ...VALID_PROTO.wiring.slice(0, 3),
        { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO19', note: 'مقاومة 220 أوم' },
      ],
    };

    const fetchMock = vi.fn()
      // 1st attempt: incomplete JSON triggers 1 retry
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"schema_version":1}' } }] }),
      })
      // Retry succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(VALID_PROTO) } }] }),
      })
      // Second call for revision 2
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(modifiedProto) } }] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const first = await generatePrototype(SAMPLE_IDEA);
    expect(first.retried).toBe(true);
    expect(first.record.revision).toBe(1);

    const second = await generatePrototype(SAMPLE_IDEA, {
      revisionFeedback: 'انقل LED إلى GPIO19',
      previous: first.record,
    });
    expect(second.retried).toBe(false);
    expect(second.record.revision).toBe(2);

    const allRevs = await store.listPrototypes(SAMPLE_IDEA.id);
    expect(allRevs.map((r) => r.revision)).toEqual([2, 1]);

    const diff = computePrototypeDiff(first.record.data, second.record.data);
    expect(diff.wiringChanges.some((c) => c.includes('GPIO18 → GPIO19'))).toBe(true);
  });

  it('includes prototype wiring, code, and warnings in MD and prompt exports', () => {
    const md = toMD(SAMPLE_IDEA, VALID_PROTO);
    expect(md).toContain('## النموذج الأولي');
    expect(md).toContain('GPIO4');
    expect(md).toContain('main.ino');
    expect(md).toContain('Preferences.h');
    expect(md).toContain('تحقق من مقاومة السحب على DHT22');

    const prompt = toPrompt(SAMPLE_IDEA, VALID_PROTO);
    expect(prompt).toContain('## النموذج الأولي');
    expect(prompt).toContain('DHT22');
    expect(prompt).toContain('main.ino');
  });
});
