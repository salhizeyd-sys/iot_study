import { DeviceRecord, FirmwareReleaseRecord } from '../../../core';
import { computeBytesSha256Hex } from '../../../store';

export function parseVersionTuple(version: string): number[] {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .map((num) => (Number.isFinite(num) ? num : 0));
}

export function isNewerFirmwareVersion(candidate: string, current: string): boolean {
  const cand = parseVersionTuple(candidate);
  const curr = parseVersionTuple(current);
  if (!cand.length) return false;
  if (!curr.length) return true;
  const maxLen = Math.max(cand.length, curr.length);
  for (let i = 0; i < maxLen; i += 1) {
    const a = cand[i] ?? 0;
    const b = curr[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

export function suggestNextFirmwareVersion(releases: FirmwareReleaseRecord[]): string {
  if (!releases.length) return '1.0.1';
  const sorted = [...releases].sort((a, b) =>
    isNewerFirmwareVersion(a.version, b.version) ? -1 : 1
  );
  const tuple = parseVersionTuple(sorted[0]?.version || '1.0.0');
  const major = tuple[0] ?? 1;
  const minor = tuple[1] ?? 0;
  const patch = (tuple[2] ?? 0) + 1;
  return `${major}.${minor}.${patch}`;
}

export function isValidSha256Hex(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(String(hash || '').trim());
}

export async function verifyFirmwareIntegrity(
  bytes: Uint8Array,
  expectedSha256: string
): Promise<boolean> {
  if (!isValidSha256Hex(expectedSha256)) return false;
  const actual = await computeBytesSha256Hex(bytes);
  return actual.toLowerCase() === expectedSha256.trim().toLowerCase();
}

export function canPublishOta(
  devices: DeviceRecord[],
  hasPrototype: boolean
): { ok: boolean; reason?: string } {
  if (!hasPrototype) {
    return { ok: false, reason: 'ولّد النموذج الأولي أولاً قبل نشر تحديث OTA.' };
  }
  if (!devices.length) {
    return {
      ok: false,
      reason: 'بلا OTA لأجهزة غير مهيأة: سجّل جهازاً وهيّئه عبر USB أولاً.',
    };
  }
  const hasProvisionedOnlineHistory = devices.some((d) => Boolean(d.last_seen_at));
  if (!hasProvisionedOnlineHistory) {
    return {
      ok: false,
      reason:
        'بلا OTA لأجهزة بلا إعدادات تهيئة: يجب أن يتصل الجهاز مرة واحدة على الأقل بعد التهيئة (NVS) قبل إرسال التحديث اللاسلكي.',
    };
  }
  return { ok: true };
}
