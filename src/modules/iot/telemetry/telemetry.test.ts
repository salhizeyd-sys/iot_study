// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Idea } from '../../../core';
import * as supaClientMod from '../../../store/supabaseClient';
import { generateDeviceToken, isDeviceOnline, sha256Hex } from '../../../store';
import {
  computeTokenSha256Hex,
  extractBearerToken,
  filterTelemetryPayload,
} from './logic';
import { renderTelemetryTab } from './ui';

describe('iot telemetry module (S13)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates random device tokens and lowercase SHA-256 hex digests', async () => {
    const t1 = generateDeviceToken();
    const t2 = generateDeviceToken();
    expect(t1).toHaveLength(48);
    expect(t1).not.toBe(t2);

    const h1 = await sha256Hex('secret-device-token');
    const h2 = await computeTokenSha256Hex('secret-device-token');
    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(extractBearerToken('Bearer  ' + t1 + '  ')).toBe(t1);
    expect(extractBearerToken('bearer ' + t1)).toBe(t1);
  });

  it('displays exact unprefixed rawToken whose SHA-256 matches saved device_tokens.token_hash', async () => {
    document.body.innerHTML = `<dialog id="dlg"></dialog><div id="toast"></div>`;

    let savedHash = '';
    const fakeClient = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.com' } } }),
      },
      from: (table: string) => {
        if (table === 'devices') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'dev-1',
                    user_id: 'u1',
                    idea_id: 'idea-t1',
                    name: 'ESP32',
                    board: 'esp32:esp32:esp32',
                    last_seen_at: null,
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'device_tokens') {
          return {
            insert: async (row: any) => {
              savedHash = row.token_hash;
              return { error: null };
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

    vi.spyOn(supaClientMod, 'getSupabaseConfig').mockReturnValue({
      url: 'https://demo.supabase.co',
      anonKey: 'anon',
    });
    vi.spyOn(supaClientMod, 'getSupabaseClient').mockReturnValue(fakeClient as any);
    vi.spyOn(supaClientMod, 'getCurrentSupabaseUser').mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
    } as any);
    const { syncManager } = await import('../../../store');
    vi.spyOn(syncManager, 'getSnapshot').mockReturnValue({
      status: 'synced',
      pendingCount: 0,
      user: { id: 'u1', email: 'a@b.com' },
    });

    const idea: Idea = {
      id: 'idea-t1',
      schemaVersion: 5,
      created: 1000,
      updatedAt: 1000,
      name: 'اختبار التوكن',
      domain: 'IoT',
      type: 'hardware',
      status: 'doing',
      lifecycle: 'flashed',
      memory: '',
      problem: '',
      solution: '',
      focus: 'aligned',
      focus_note: '',
      skills: [],
      duration: '',
      plan: [],
      plan_history: [],
      components: [],
      notes: '',
    };

    const tab = renderTelemetryTab(idea);
    document.getElementById('dlg')!.appendChild(tab);

    await vi.waitFor(() => {
      expect(tab.querySelector('[data-action="register-device"]')).not.toBeNull();
    });

    tab.querySelector<HTMLButtonElement>('[data-action="register-device"]')?.click();

    await vi.waitFor(() => {
      expect(tab.querySelector('[data-role="token-value"]')).not.toBeNull();
    });

    const displayedToken =
      tab.querySelector('[data-role="token-value"]')?.textContent || '';
    expect(displayedToken).toHaveLength(48);
    expect(await computeTokenSha256Hex(displayedToken)).toBe(savedHash);
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
