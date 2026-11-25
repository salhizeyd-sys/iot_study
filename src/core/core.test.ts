import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FEATURES,
  EventBus,
  ModuleRegistry,
  detectCapabilities,
  isFeatureEnabled,
  mergeSettings,
} from './index';

describe('core architecture', () => {
  it('enables vault, iot.prototype, iot.dashboard, iot.flash, and focus feature flags in current milestone', () => {
    const settings = mergeSettings();
    expect(settings.features).toEqual(DEFAULT_FEATURES);
    expect(isFeatureEnabled(settings, 'vault')).toBe(true);
    expect(isFeatureEnabled(settings, 'iot.prototype')).toBe(true);
    expect(isFeatureEnabled(settings, 'iot.dashboard')).toBe(true);
    expect(isFeatureEnabled(settings, 'iot.flash')).toBe(true);
    expect(isFeatureEnabled(settings, 'focus')).toBe(true);
    expect(isFeatureEnabled(settings, 'iot.telemetry')).toBe(false);
    expect(isFeatureEnabled(settings, 'iot.ota')).toBe(false);
  });

  it('delivers typed events via EventBus and dispatches only to enabled modules', () => {
    const bus = new EventBus();
    const reg = new ModuleRegistry();
    const vaultHandler = vi.fn();
    const iotHandler = vi.fn();

    reg.register({
      id: 'vault',
      enabled: (s) => isFeatureEnabled(s, 'vault'),
      onEvent: vaultHandler,
    });
    reg.register({
      id: 'iot.telemetry',
      enabled: (s) => isFeatureEnabled(s, 'iot.telemetry'),
      onEvent: iotHandler,
    });

    const settings = mergeSettings();
    const unbind = reg.bindToBus(bus, () => settings);

    bus.emit('idea:status-changed', {
      ideaId: '1',
      status: 'planned',
      lifecycle: 'planned',
    });

    expect(vaultHandler).toHaveBeenCalledTimes(1);
    expect(iotHandler).not.toHaveBeenCalled();

    unbind();
    bus.clear();
    reg.clear();
  });

  it('upgrades legacy settings missing settingsVersion to enable released focus & iot flags', () => {
    const legacy = {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      key: '',
      base: 'https://api.openai.com/v1',
      goals: 'Embedded',
      maxDoing: 2,
      features: {
        vault: true,
        'iot.prototype': false,
        'iot.dashboard': false,
        'iot.telemetry': false,
        'iot.flash': false,
        'iot.ota': false,
        focus: false,
      },
    };
    const upgraded = mergeSettings(legacy as any);
    expect(upgraded.settingsVersion).toBe(3);
    expect(upgraded.features.focus).toBe(true);
    expect(upgraded.features['iot.prototype']).toBe(true);
    expect(upgraded.features['iot.dashboard']).toBe(true);
    expect(upgraded.features['iot.flash']).toBe(true);
  });

  it('detects capabilities safely outside browser APIs', () => {
    const c = detectCapabilities();
    expect(typeof c.webSerial).toBe('boolean');
    expect(typeof c.speech).toBe('boolean');
    expect(typeof c.touch).toBe('boolean');
    expect(typeof c.standalone).toBe('boolean');
  });
});
