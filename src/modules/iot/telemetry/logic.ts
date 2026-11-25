export const MAX_TELEMETRY_BYTES = 4096;
export const TELEMETRY_RATE_LIMIT_MS = 2000;

export function filterTelemetryPayload(
  raw: unknown,
  allowedKeys: Set<string>
): { ok: true; payload: Record<string, number | boolean | string> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'الحمولة ليست كائن JSON صالحاً' };
  }

  const bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
  if (bytes > MAX_TELEMETRY_BYTES) {
    return { ok: false, error: 'حجم القراءة يتجاوز 4KB' };
  }

  const payload: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedKeys.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      payload[k] = v;
    }
  }

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: 'لا توجد مفاتيح مطابقة للوحة التحكم (dashboard)' };
  }

  return { ok: true, payload };
}
