// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Idea, PrototypeV1, caps, mergeSettings } from '../../../core';
import { S, store } from '../../../store';
import { canStartFlash } from './logic';
import { formatProvisioningLine } from './serial';
import { renderFlashTab } from './ui';
// @ts-expect-error ESM helper module without .d.ts
import * as compileLib from '../../../../scripts/compile-local/lib.mjs';

const SAMPLE_IDEA: Idea = {
  id: 'flash-idea-1',
  schemaVersion: 5,
  created: 1000,
  updatedAt: 1000,
  name: 'محطة مراقبة ESP32',
  domain: 'IoT',
  type: 'both',
  status: 'doing',
  lifecycle: 'prototype_generated',
  memory: '',
  problem: 'مراقبة',
  solution: 'ESP32',
  focus: 'aligned',
  focus_note: '',
  skills: ['ESP32'],
  duration: 'أسبوع',
  plan: [],
  plan_history: [],
  components: [],
  notes: '',
};

const SAMPLE_PROTO: PrototypeV1 = {
  schema_version: 1,
  board: { fqbn: 'esp32:esp32:esp32', ota: true },
  wiring: [
    { part: 'DHT22', part_pin: 'DATA', mcu_pin: 'GPIO4' },
    { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO18' },
  ],
  firmware: {
    files: [{ name: 'main.ino', content: 'void setup(){} void loop(){}' }],
    libraries: [],
  },
  dashboard: [],
  simulation: { interval_ms: 1000, frames: [] },
  warnings: ['تحقق من التوصيل قبل التشغيل'],
};

describe('iot flash & compile-local (S12)', () => {
  beforeEach(() => {
    document.body.innerHTML = `<dialog id="dlg"></dialog><div id="toast"></div>`;
    S.ideas = [{ ...SAMPLE_IDEA }];
    S.settings = mergeSettings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('validates scripts/compile-local helpers (filenames, FQBN, bin offsets, PNA CORS)', () => {
    expect(compileLib.sanitizeSketchFilename('../secret.sh')).toBeNull();
    expect(compileLib.sanitizeSketchFilename('dir/main.ino')).toBe('main.ino');
    expect(compileLib.resolveMainSketchName([{ name: 'app.ino' }])).toBe('app');

    expect(compileLib.validateEsp32Fqbn('esp32:esp32:esp32')).toBe('esp32:esp32:esp32');
    expect(() => compileLib.validateEsp32Fqbn('arduino:avr:uno')).toThrow('ESP32');

    const bins = compileLib.mapBinArtifacts(
      ['out/app.ino.bootloader.bin', 'out/app.ino.partitions.bin', 'out/app.ino.bin'],
      (p: string) => ({ toString: () => btoa(p) })
    );
    expect(bins.map((b: any) => b.offset)).toEqual([0x1000, 0x8000, 0x10000]);

    const headers = compileLib.buildCorsHeaders();
    expect(headers['Access-Control-Allow-Private-Network']).toBe('true');
  });

  it('enforces mandatory review before flashing and formats NVS provisioning JSON', () => {
    expect(canStartFlash({ reviewConfirmed: false, binsCount: 3 }).allowed).toBe(false);
    expect(canStartFlash({ reviewConfirmed: true, binsCount: 0 }).allowed).toBe(false);
    expect(canStartFlash({ reviewConfirmed: true, binsCount: 3 }).allowed).toBe(true);

    expect(() =>
      formatProvisioningLine({ wifi_ssid: '  ', wifi_pass: '12345678' })
    ).toThrow('SSID');

    const line = formatProvisioningLine({
      wifi_ssid: 'LabWiFi',
      wifi_pass: 'secret123',
      device_token: 'tok-abc',
      ingest_url: 'https://demo.supabase.co/functions/v1/ingest-telemetry',
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({
      wifi_ssid: 'LabWiFi',
      wifi_pass: 'secret123',
      device_token: 'tok-abc',
      ingest_url: 'https://demo.supabase.co/functions/v1/ingest-telemetry',
    });
  });

  it('shows Handoff "جاهز للرفع" when webSerial is unsupported and updates lifecycle', () => {
    caps.webSerial = false;
    const tab = renderFlashTab(S.ideas[0]);
    const readyBtn = tab.querySelector<HTMLButtonElement>('[data-action="mark-ready"]');
    expect(readyBtn).not.toBeNull();
    readyBtn?.click();

    expect(S.ideas[0].lifecycle).toBe('ready_to_flash');
    expect(tab.querySelector('[data-role="ready-badge"]')).not.toBeNull();
  });

  it('renders desktop workbench with mandatory review and local compile gating', async () => {
    caps.webSerial = true;
    await store.savePrototypeRevision(SAMPLE_IDEA.id, SAMPLE_PROTO);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        fqbn: 'esp32:esp32:esp32',
        bins: [{ name: 'main.ino.bin', offset: 0x10000, dataBase64: 'AQID' }],
        logs: 'Compiled OK',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const tab = renderFlashTab(S.ideas[0]);
    document.getElementById('dlg')!.appendChild(tab);

    await vi.waitFor(() => {
      expect(tab.querySelector('[data-role="review-box"]')).not.toBeNull();
    });

    const flashBtn = tab.querySelector<HTMLButtonElement>('[data-action="flash-usb"]')!;
    const reviewCheck = tab.querySelector<HTMLInputElement>('[data-role="review-check"]')!;
    const compileBtn = tab.querySelector<HTMLButtonElement>('[data-action="compile-local"]')!;

    expect(flashBtn.disabled).toBe(true);
    expect(tab.textContent).toContain('تحقق من التوصيل قبل التشغيل');

    reviewCheck.checked = true;
    reviewCheck.dispatchEvent(new Event('change'));
    // Still disabled until compiled .bin artifacts exist
    expect(flashBtn.disabled).toBe(true);

    compileBtn.click();
    await vi.waitFor(() => {
      expect(flashBtn.disabled).toBe(false);
    });
  });
});
