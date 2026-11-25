import { describe, expect, it, vi } from 'vitest';
import { DeviceRecord, FirmwareReleaseRecord } from '../../../core';
import {
  computeBytesSha256Hex,
  pickAppBinaryPart,
  publishOtaRelease,
} from '../../../store';
import * as supaClientMod from '../../../store/supabaseClient';
import {
  canPublishOta,
  isNewerFirmwareVersion,
  isValidSha256Hex,
  suggestNextFirmwareVersion,
  verifyFirmwareIntegrity,
} from './logic';

describe('iot.ota module (S15)', () => {
  it('verifies firmware SHA-256 match and rejects tampering', async () => {
    const firmwareBytes = new Uint8Array([0xe9, 0x05, 0x02, 0x40, 0x10, 0x20, 0x30]);
    const digest = await computeBytesSha256Hex(firmwareBytes);

    expect(isValidSha256Hex(digest)).toBe(true);
    expect(await verifyFirmwareIntegrity(firmwareBytes, digest)).toBe(true);
    expect(await verifyFirmwareIntegrity(firmwareBytes, digest.toUpperCase())).toBe(true);

    const tampered = new Uint8Array(firmwareBytes);
    tampered[0] = 0x00;
    expect(await verifyFirmwareIntegrity(tampered, digest)).toBe(false);
    expect(await verifyFirmwareIntegrity(firmwareBytes, 'not-a-sha256')).toBe(false);
  });

  it('compares semantic firmware versions and suggests the next patch version', () => {
    expect(isNewerFirmwareVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerFirmwareVersion('v2.0.0', '1.9.9')).toBe(true);
    expect(isNewerFirmwareVersion('1.0.10', '1.0.9')).toBe(true);
    expect(isNewerFirmwareVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerFirmwareVersion('0.9.5', '1.0.0')).toBe(false);

    const releases: FirmwareReleaseRecord[] = [
      {
        id: 'r1',
        user_id: 'u1',
        idea_id: 'i1',
        version: '1.0.0',
        storage_path: 'u1/i1/1.0.0.bin',
        sha256: 'a'.repeat(64),
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'r2',
        user_id: 'u1',
        idea_id: 'i1',
        version: '1.2.4',
        storage_path: 'u1/i1/1.2.4.bin',
        sha256: 'b'.repeat(64),
        created_at: '2026-01-02T00:00:00Z',
      },
    ];
    expect(suggestNextFirmwareVersion(releases)).toBe('1.2.5');
    expect(suggestNextFirmwareVersion([])).toBe('1.0.1');
  });

  it('blocks OTA for unprovisioned or never-seen devices', () => {
    expect(canPublishOta([], true).ok).toBe(false);

    const unprovisioned: DeviceRecord = {
      id: 'dev-1',
      user_id: 'u1',
      idea_id: 'i1',
      name: 'ESP32',
      board: 'esp32:esp32:esp32',
      last_seen_at: null,
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(canPublishOta([unprovisioned], true).ok).toBe(false);

    const onlineCapable: DeviceRecord = {
      ...unprovisioned,
      last_seen_at: '2026-01-01T00:01:00Z',
    };
    expect(canPublishOta([onlineCapable], true).ok).toBe(true);
    expect(canPublishOta([onlineCapable], false).ok).toBe(false);
  });

  it('picks the app binary part at 0x10000 and uploads OTA release with sha256', async () => {
    const appPart = pickAppBinaryPart([
      { name: 'sketch.ino.bootloader.bin', offset: 0x1000, dataBase64: 'AAA=' },
      { name: 'sketch.ino.partitions.bin', offset: 0x8000, dataBase64: 'BBB=' },
      { name: 'sketch.ino.bin', offset: 0x10000, dataBase64: 'Q0ND' },
    ]);
    expect(appPart?.name).toBe('sketch.ino.bin');

    const uploadMock = vi.fn().mockResolvedValue({ error: null });
    const singleMock = vi.fn().mockImplementation(async () => ({
      data: {
        id: 'rel-1',
        user_id: 'user-1',
        idea_id: 'idea-1',
        version: '1.0.2',
        storage_path: 'user-1/idea-1/1.0.2-firmware.bin',
        sha256: await computeBytesSha256Hex(new Uint8Array([1, 2, 3, 4])),
        created_at: new Date().toISOString(),
      },
      error: null,
    }));

    vi.spyOn(supaClientMod, 'getCurrentSupabaseUser').mockResolvedValue({
      id: 'user-1',
      email: 'dev@sharara.app',
    } as any);
    vi.spyOn(supaClientMod, 'getSupabaseClient').mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          upload: uploadMock,
        }),
      },
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: singleMock,
          }),
        }),
      }),
    } as any);

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const rec = await publishOtaRelease({
      ideaId: 'idea-1',
      version: '1.0.2',
      binaryBytes: bytes,
      fileName: 'firmware.bin',
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(rec.version).toBe('1.0.2');
    expect(rec.sha256).toBe(await computeBytesSha256Hex(bytes));

    vi.restoreAllMocks();
  });
});
