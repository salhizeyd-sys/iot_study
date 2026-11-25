// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEATURES,
  DeviceRecord,
  Idea,
  bus,
  checkEsp32Pins,
  isFeatureEnabled,
  mergeSettings,
  registry,
} from '../core';
import {
  S,
  computeBytesSha256Hex,
  getCommandStatus,
  isDeviceOnline,
  migrateSettings,
  sha256Hex,
} from '../store';
import { vaultModule } from '../modules/vault';
import {
  hasHardcodedSecrets,
  iotPrototypeModule,
  parsePrototypeResponse,
} from '../modules/iot/prototype';
import { iotDashboardModule } from '../modules/iot/dashboard';
import { iotTelemetryModule } from '../modules/iot/telemetry';
import { iotFlashModule, markIdeaFlashed, markIdeaReadyToFlash } from '../modules/iot/flash';
import {
  canPublishOta,
  iotOtaModule,
  isNewerFirmwareVersion,
  verifyFirmwareIntegrity,
} from '../modules/iot/ota';

describe('M4 vertical lifecycle verification (S16)', () => {
  it('registers all 6 modules together, upgrades legacy settings, and validates ESP32 + DHT22 + LED flow', async () => {
    const upgraded = migrateSettings({
      provider: 'gemini',
      features: { ...DEFAULT_FEATURES, 'iot.ota': false, focus: false },
    });
    expect(upgraded.settingsVersion).toBe(5);
    expect(isFeatureEnabled(upgraded, 'vault')).toBe(true);
    expect(isFeatureEnabled(upgraded, 'iot.prototype')).toBe(true);
    expect(isFeatureEnabled(upgraded, 'iot.dashboard')).toBe(true);
    expect(isFeatureEnabled(upgraded, 'iot.telemetry')).toBe(true);
    expect(isFeatureEnabled(upgraded, 'iot.flash')).toBe(true);
    expect(isFeatureEnabled(upgraded, 'iot.ota')).toBe(true);
    expect(isFeatureEnabled(upgraded, 'focus')).toBe(true);

    S.settings = mergeSettings(upgraded);
    registry.clear();
    bus.clear();
    registry.register(vaultModule);
    registry.register(iotPrototypeModule);
    registry.register(iotDashboardModule);
    registry.register(iotTelemetryModule);
    registry.register(iotFlashModule);
    registry.register(iotOtaModule);

    let idea: Idea = {
      id: 'vertical-dht22-led',
      name: 'ESP32 DHT22 + LED',
      domain: 'IoT',
      type: 'both',
      status: 'planned',
      lifecycle: 'prototype_generated',
      memory: '',
      problem: 'Monitor room climate and control LED remotely',
      solution: 'ESP32 + DHT22 + LED over HTTPS + Realtime',
      focus: 'aligned',
      focus_note: 'Embedded IoT',
      skills: ['ESP32', 'DHT22'],
      duration: 'أسبوع',
      plan: [{ step: 'Wire DHT22 + LED', detail: 'GPIO4 & GPIO18', done: true }],
      components: [
        { name: 'ESP32 DevKit v1', qty: 1, note: '' },
        { name: 'DHT22', qty: 1, note: 'GPIO4' },
        { name: 'LED', qty: 1, note: 'GPIO18' },
      ],
      notes: '',
      chat: [],
      created: Date.now(),
      updatedAt: Date.now(),
    };

    expect(registry.getIdeaTabs(idea, S.settings).map((t) => t.id)).toEqual(
      expect.arrayContaining(['prototype', 'dashboard', 'telemetry', 'flash', 'ota'])
    );

    const protoResult = parsePrototypeResponse(
      JSON.stringify({
        schema_version: 1,
        board: { fqbn: 'esp32:esp32:esp32', ota: true },
        wiring: [
          { part: 'DHT22', part_pin: 'DATA', mcu_pin: 'GPIO4', note: '10k pull-up' },
          { part: 'LED', part_pin: 'Anode', mcu_pin: 'GPIO18', note: '220 ohm resistor' },
        ],
        firmware: {
          files: [
            {
              name: 'main.ino',
              content:
                '#include <Preferences.h>\n#define FIRMWARE_VERSION "1.0.0"\nvoid setup(){ Preferences p; p.begin("iot_vault", true); } void loop(){}',
            },
          ],
          libraries: ['DHT sensor library', 'ArduinoJson'],
        },
        dashboard: [
          { type: 'gauge', key: 'temp', label: 'الحرارة', min: 0, max: 50, unit: '°C' },
          { type: 'toggle_switch', key: 'led', label: 'LED' },
        ],
        simulation: { interval_ms: 1000, frames: [{ temp: 25.1, led: true }] },
        warnings: [],
      })
    );
    expect(protoResult.ok).toBe(true);
    if (!protoResult.ok) return;

    expect(hasHardcodedSecrets(protoResult.data.firmware.files[0].content)).toBe(false);
    expect(checkEsp32Pins(protoResult.data.wiring).issues).toEqual([]);

    idea = markIdeaReadyToFlash(idea);
    expect(idea.lifecycle).toBe('ready_to_flash');
    idea = markIdeaFlashed(idea);
    expect(idea.lifecycle).toBe('flashed');

    const tokenDigest = await sha256Hex('sharara-dev-token-123');
    expect(tokenDigest).toHaveLength(64);

    const device: DeviceRecord = {
      id: 'dev-vertical-1',
      user_id: 'u1',
      idea_id: idea.id,
      name: 'ESP32 Node',
      board: 'esp32:esp32:esp32',
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    expect(isDeviceOnline(device.last_seen_at, 5000)).toBe(true);
    expect(canPublishOta([device], true).ok).toBe(true);

    expect(
      getCommandStatus({
        executed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
    ).toBe('executed');

    const v2Bytes = new Uint8Array([0xe9, 0x01, 0x02, 0x03, 0x04]);
    const digest = await computeBytesSha256Hex(v2Bytes);
    expect(isNewerFirmwareVersion('1.0.1', '1.0.0')).toBe(true);
    expect(await verifyFirmwareIntegrity(v2Bytes, digest)).toBe(true);
  });
});
