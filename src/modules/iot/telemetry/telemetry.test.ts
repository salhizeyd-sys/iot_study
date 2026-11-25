// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { generateDeviceToken, isDeviceOnline, sha256Hex } from '../../../store';
import { filterTelemetryPayload } from './logic';

describe('iot telemetry module (S13)', () => {
  it('generates random device tokens and SHA-256 hex digests', async () => {
    const t1 = generateDeviceToken();
    const t2 = generateDeviceToken();
    expect(t1).toHaveLength(48);
    expect(t1).not.toBe(t2);

    const h1 = await sha256Hex('secret-device-token');
    const h2 = await sha256Hex('secret-device-token');
    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(h1).not.toBe('secret-device-token');
  });

  it('computes online/offline status using < 3x interval rule', () => {
    const now = 1_700_000_000_000;
    expect(isDeviceOnline(null, 5000, now)).toBe(false);
    expect(isDeviceOnline(now - 10_000, 5000, now)).toBe(true);
    expect(isDeviceOnline(now - 15_000, 5000, now)).toBe(false);
    expect(isDeviceOnline(new Date(now - 4000).toISOString(), 5000, now)).toBe(true);
  });

  it('enforces 4KB limit and accepts only dashboard keys in filterTelemetryPayload', () => {
    const allowed = new Set(['temp', 'humidity', 'led']);

    const ok = filterTelemetryPayload(
      { temp: 24.3, humidity: 58, rogue_secret: 'drop-me', nested: { a: 1 } },
      allowed
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.payload).toEqual({ temp: 24.3, humidity: 58 });
    }

    const noAllowed = filterTelemetryPayload({ unknown: 123 }, allowed);
    expect(noAllowed.ok).toBe(false);

    const huge = filterTelemetryPayload({ temp: 'x'.repeat(5000) }, allowed);
    expect(huge.ok).toBe(false);
  });
});
