import { DeviceRecord, IoTCommandRecord, TelemetryReading, bus } from '../core';
import { getCurrentSupabaseUser, getSupabaseClient } from './supabaseClient';

export const DEFAULT_COMMAND_TTL_MS = 10 * 60 * 1000;

// Transient session-only cache so Flash tab can prefill newly created token without ever persisting raw tokens
const transientIssuedTokens = new Map<string, string>();

export function getLastIssuedToken(ideaId: string): string {
  return transientIssuedTokens.get(ideaId) || '';
}

export async function sha256Hex(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw.trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}

export function generateDeviceToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isDeviceOnline(
  lastSeenAt?: number | string | null,
  intervalMs: number = 5000,
  now: number = Date.now()
): boolean {
  if (!lastSeenAt) return false;
  const ts = typeof lastSeenAt === 'number' ? lastSeenAt : Date.parse(lastSeenAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const threshold = 3 * Math.max(1000, intervalMs);
  return now - ts < threshold;
}

export async function registerDeviceForIdea(
  ideaId: string,
  name: string,
  board: string = 'esp32:esp32:esp32'
): Promise<{ device: DeviceRecord; rawToken: string }> {
  const client = getSupabaseClient();
  const user = await getCurrentSupabaseUser();
  if (!client || !user) {
    throw new Error('سجّل الدخول عبر Supabase أولاً لتسجيل جهاز');
  }

  const cleanName = name.trim() || 'ESP32 Device';
  const { data: device, error: devErr } = await client
    .from('devices')
    .insert({
      user_id: user.id,
      idea_id: ideaId,
      name: cleanName,
      board,
    })
    .select('*')
    .single();

  if (devErr || !device) {
    throw new Error(devErr?.message || 'تعذّر تسجيل الجهاز');
  }

  const rawToken = generateDeviceToken();
  const tokenHash = await sha256Hex(rawToken);

  const { error: tokErr } = await client.from('device_tokens').insert({
    user_id: user.id,
    device_id: device.id,
    token_hash: tokenHash,
    revoked: false,
  });

  if (tokErr) {
    throw new Error(tokErr.message);
  }

  transientIssuedTokens.set(ideaId, rawToken);
  bus.emit('device:registered', {
    deviceId: device.id,
    ideaId,
    rawToken,
  });

  return { device: device as DeviceRecord, rawToken };
}

export async function listDevicesForIdea(ideaId: string): Promise<DeviceRecord[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('devices')
    .select('*')
    .eq('idea_id', ideaId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data || []) as DeviceRecord[];
}

export async function listRecentTelemetry(
  deviceId: string,
  limit: number = 20
): Promise<TelemetryReading[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('iot_telemetry')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data || []) as TelemetryReading[]).reverse();
}

export function subscribeIdeaTelemetry(
  ideaId: string,
  deviceIds: string[],
  onReading: (reading: TelemetryReading) => void,
  onDeviceUpdate?: (device: DeviceRecord) => void
): () => void {
  const client = getSupabaseClient();
  if (!client || !deviceIds.length) return () => {};

  const deviceSet = new Set(deviceIds);
  const channel = client
    .channel(`sharara-telemetry-${ideaId}-${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'iot_telemetry',
      },
      (payload) => {
        const row = payload.new as TelemetryReading;
        if (row && deviceSet.has(row.device_id)) {
          onReading(row);
          bus.emit('telemetry:received', {
            deviceId: row.device_id,
            ideaId,
            payload: row.payload || {},
            createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
          });
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'devices',
        filter: `idea_id=eq.${ideaId}`,
      },
      (payload) => {
        const dev = payload.new as DeviceRecord;
        if (dev && deviceSet.has(dev.id)) {
          onDeviceUpdate?.(dev);
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

export function getCommandStatus(
  cmd: Pick<IoTCommandRecord, 'executed_at' | 'expires_at'>,
  now: number = Date.now()
): 'executed' | 'expired' | 'pending' {
  if (cmd.executed_at) return 'executed';
  const expMs = Date.parse(cmd.expires_at);
  if (Number.isFinite(expMs) && expMs <= now) return 'expired';
  return 'pending';
}

export async function sendDeviceCommand(
  deviceId: string,
  action: string,
  value: number | boolean | string,
  ttlMs: number = DEFAULT_COMMAND_TTL_MS
): Promise<IoTCommandRecord> {
  const client = getSupabaseClient();
  const user = await getCurrentSupabaseUser();
  if (!client || !user) {
    throw new Error('سجّل الدخول عبر Supabase لإرسال الأوامر للجهاز');
  }
  const expiresAt = new Date(Date.now() + Math.max(10_000, ttlMs)).toISOString();
  const { data, error } = await client
    .from('iot_commands')
    .insert({
      user_id: user.id,
      device_id: deviceId,
      action,
      value,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'تعذّر إرسال الأمر');
  }
  return data as IoTCommandRecord;
}

export async function listDeviceCommands(
  deviceId: string,
  limit: number = 10
): Promise<IoTCommandRecord[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client
    .from('iot_commands')
    .select('*')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []) as IoTCommandRecord[];
}

export function subscribeDeviceCommands(
  deviceId: string,
  onCommandChange: (cmd: IoTCommandRecord) => void
): () => void {
  const client = getSupabaseClient();
  if (!client || !deviceId) return () => {};

  const channel = client
    .channel(`sharara-commands-${deviceId}-${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'iot_commands',
        filter: `device_id=eq.${deviceId}`,
      },
      (payload) => {
        const row = payload.new as IoTCommandRecord;
        if (row?.id) onCommandChange(row);
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
