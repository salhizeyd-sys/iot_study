// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Idea, PrototypeV1, caps, mergeSettings } from '../../../core';
import { S, store } from '../../../store';
import {
  canStartFlash,
  cleanFixedFirmwareCode,
  extractMissingHeaderFromCompileError,
} from './logic';
import {
  installArduinoLibrary,
  listInstalledLibraries,
  searchArduinoLibraries,
} from './compiler';
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

  it('validates Arduino library manager helpers (names, list, top-15 search cap, missing diff)', () => {
    expect(compileLib.validateLibraryName('DHT sensor library')).toBe('DHT sensor library');
    expect(() => compileLib.validateLibraryName('   ')).toThrow();
    expect(() => compileLib.validateLibraryName('--malicious-flag')).toThrow();

    const installed = compileLib.parseInstalledLibrariesOutput(
      JSON.stringify({
        installed_libraries: [
          { library: { name: 'ArduinoJson', version: '7.1.0', sentence: 'JSON library' } },
          { library: { name: 'DHT sensor library', version: '1.4.6' } },
        ],
      })
    );
    expect(installed).toEqual([
      { name: 'ArduinoJson', version: '7.1.0', sentence: 'JSON library' },
      { name: 'DHT sensor library', version: '1.4.6', sentence: '' },
    ]);

    const manyResults = Array.from({ length: 22 }, (_, i) => ({
      name: `SensorLib_${i}`,
      latest: { version: '1.0.0', author: 'Dev', sentence: `Desc ${i}` },
    }));
    const capped = compileLib.parseLibrarySearchOutput(JSON.stringify({ libraries: manyResults }));
    expect(capped).toHaveLength(15);
    expect(capped[0]).toEqual({
      name: 'SensorLib_0',
      version: '1.0.0',
      author: 'Dev',
      sentence: 'Desc 0',
    });

    const missing = compileLib.findMissingLibraries(
      ['arduinojson', 'LiquidCrystal_I2C', 'DHT sensor library', 'LiquidCrystal_I2C'],
      installed
    );
    expect(missing).toEqual(['LiquidCrystal_I2C']);
  });

  it('calls compiler library HTTP endpoints and preserves stderr logs on compile errors', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/libraries')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            libraries: [{ name: 'ArduinoJson', version: '7.1.0' }],
          }),
        };
      }
      if (url.includes('/libraries/search?q=LiquidCrystal_I2C')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            libraries: [{ name: 'LiquidCrystal I2C', version: '1.1.2' }],
          }),
        };
      }
      if (url.endsWith('/libraries/install') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ok: true, name: 'LiquidCrystal I2C', logs: 'Installed' }),
        };
      }
      return { ok: false, json: async () => ({ ok: false, error: 'unexpected' }) };
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const libs = await listInstalledLibraries();
    expect(libs).toHaveLength(1);

    const found = await searchArduinoLibraries('LiquidCrystal_I2C');
    expect(found[0].name).toBe('LiquidCrystal I2C');

    const inst = await installArduinoLibrary('LiquidCrystal I2C');
    expect(inst.ok).toBe(true);
  });

  it('parses missing header errors, cleans AI code fences, and runs AI auto-fix + missing-lib workflow in UI', async () => {
    expect(
      extractMissingHeaderFromCompileError(
        'main.ino:2:10: fatal error: LiquidCrystal_I2C.h: No such file or directory'
      )
    ).toEqual({ header: 'LiquidCrystal_I2C.h', query: 'LiquidCrystal_I2C' });

    expect(
      extractMissingHeaderFromCompileError(
        "src/app.ino:4:10: 'Adafruit_BME280/Adafruit_BME280.h' file not found"
      )
    ).toEqual({
      header: 'Adafruit_BME280/Adafruit_BME280.h',
      query: 'Adafruit_BME280',
    });

    expect(extractMissingHeaderFromCompileError("error: expected ';' before '}' token")).toBeNull();

    expect(cleanFixedFirmwareCode('```cpp\nvoid setup(){}\nvoid loop(){}\n```')).toBe(
      'void setup(){}\nvoid loop(){}'
    );

    caps.webSerial = true;
    S.settings = mergeSettings({ provider: 'openai', key: 'test-ai-fix-key', base: 'https://api.openai.com/v1' });

    await store.savePrototypeRevision(SAMPLE_IDEA.id, {
      ...SAMPLE_PROTO,
      firmware: {
        files: [{ name: 'main.ino', content: '#include <MissingHeader.h>\nvoid setup(){} void loop(){}' }],
        libraries: ['DHT sensor library'],
      },
    });

    let compileAttempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/libraries')) {
        return {
          ok: true,
          json: async () => ({ ok: true, libraries: [] }),
        };
      }
      if (url.includes('/libraries/search?q=MissingHeader')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            libraries: [{ name: 'MissingHeaderLib', version: '1.0.0', author: 'Test' }],
          }),
        };
      }
      if (url.endsWith('/libraries/install')) {
        return {
          ok: true,
          json: async () => ({ ok: true, name: 'MissingHeaderLib', logs: 'Installed OK' }),
        };
      }
      if (url.endsWith('/compile')) {
        compileAttempts += 1;
        if (compileAttempts === 1) {
          return {
            ok: false,
            json: async () => ({
              ok: false,
              error: 'compilation failed',
              logs: 'main.ino:1:10: fatal error: MissingHeader.h: No such file or directory',
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            ok: true,
            fqbn: 'esp32:esp32:esp32',
            bins: [{ name: 'main.ino.bin', offset: 0x10000, dataBase64: 'AQID' }],
            logs: 'Compiled OK',
          }),
        };
      }
      if (url.includes('/chat/completions')) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '```cpp\n#include <Arduino.h>\nvoid setup(){}\nvoid loop(){}\n```',
                },
              },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({ error: 'unhandled url ' + url }) };
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const tab = renderFlashTab(S.ideas[0]);
    document.getElementById('dlg')!.appendChild(tab);

    await vi.waitFor(() => {
      expect(tab.querySelector('[data-role="lib-manager"]')).not.toBeNull();
    });

    const reviewCheck = tab.querySelector<HTMLInputElement>('[data-role="review-check"]')!;
    reviewCheck.checked = true;
    reviewCheck.dispatchEvent(new Event('change'));

    tab.querySelector<HTMLButtonElement>('[data-action="compile-local"]')!.click();

    await vi.waitFor(() => {
      expect(tab.querySelector('[data-role="compile-diagnostics"]')).not.toBeNull();
      expect(tab.querySelector('[data-action="search-missing-lib"]')).not.toBeNull();
    });

    tab.querySelector<HTMLButtonElement>('[data-action="search-missing-lib"]')!.click();
    await vi.waitFor(() => {
      expect(tab.querySelector('[data-search-lib="MissingHeaderLib"]')).not.toBeNull();
    });

    tab.querySelector<HTMLButtonElement>('[data-action="ai-auto-fix"]')!.click();
    await vi.waitFor(() => {
      expect(tab.querySelector('[data-action="recompile-after-fix"]')).not.toBeNull();
    });

    const updatedProto = await store.getLatestPrototype(SAMPLE_IDEA.id);
    expect(updatedProto?.data.firmware.files[0].content).toBe(
      '#include <Arduino.h>\nvoid setup(){}\nvoid loop(){}'
    );

    tab.querySelector<HTMLButtonElement>('[data-action="recompile-after-fix"]')!.click();
    await vi.waitFor(() => {
      expect(tab.querySelector<HTMLButtonElement>('[data-action="flash-usb"]')?.disabled).toBe(
        false
      );
    });
  });
});
