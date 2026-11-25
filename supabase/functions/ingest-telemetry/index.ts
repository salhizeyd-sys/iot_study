// Supabase Edge Function: ingest-telemetry
// Deploy with --no-verify-jwt (authenticates ESP32 via SHA-256 device token hash).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-device-token, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_PAYLOAD_BYTES = 4096;
const MIN_INTERVAL_MS = 2000;

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extra,
    },
  });
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}

function parseVersionTuple(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => Number.parseInt(n, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

function isNewerVersion(candidate: string, current: string): boolean {
  const c = parseVersionTuple(candidate);
  const cur = parseVersionTuple(current);
  const len = Math.max(c.length, cur.length);
  for (let i = 0; i < len; i += 1) {
    const cv = c[i] ?? 0;
    const rv = cur[i] ?? 0;
    if (cv > rv) return true;
    if (cv < rv) return false;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server environment not configured' }, 500);
  }

  const authRaw = req.headers.get('authorization');
  const bearerToken = authRaw
    ? authRaw.replace(/^Bearer\s+/i, '').trim()
    : '';
  const headerToken = (req.headers.get('x-device-token') || '').trim();
  const rawToken = (bearerToken || headerToken).replace(/^["']|["']$/g, '').trim();
  if (!rawToken) {
    return jsonResponse({ error: 'Missing device token' }, 401);
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ error: 'Payload exceeds 4KB limit' }, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return jsonResponse({ error: 'Payload must be a JSON object' }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  });

  const tokenHash = await sha256Hex(rawToken);
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('device_tokens')
    .select('id, user_id, device_id, revoked, last_used_at')
    .eq('token_hash', tokenHash)
    .eq('revoked', false)
    .maybeSingle();

  if (tokenErr) {
    console.error('device_tokens lookup failed:', tokenErr.message);
    return jsonResponse({ error: `Token lookup failed: ${tokenErr.message}` }, 500);
  }

  if (!tokenRow) {
    return jsonResponse({ error: 'Invalid or revoked device token' }, 401);
  }

  const lastUsedMs = tokenRow.last_used_at ? Date.parse(tokenRow.last_used_at) : 0;
  const nowMs = Date.now();
  if (lastUsedMs && nowMs - lastUsedMs < MIN_INTERVAL_MS) {
    return jsonResponse(
      { error: 'Rate limit exceeded (min 2s between requests)' },
      429,
      { 'Retry-After': '2' }
    );
  }

  const { data: deviceRow, error: deviceErr } = await supabase
    .from('devices')
    .select('id, user_id, idea_id')
    .eq('id', tokenRow.device_id)
    .maybeSingle();

  if (deviceErr || !deviceRow) {
    return jsonResponse({ error: 'Device not found' }, 404);
  }

  const bodyObj = parsedBody as Record<string, unknown>;
  const nowIso = new Date(nowMs).toISOString();

  // 1. Mark acknowledged commands from previous round-trip as executed
  const ackIds = Array.isArray(bodyObj.ack_commands)
    ? bodyObj.ack_commands.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (ackIds.length > 0) {
    await supabase
      .from('iot_commands')
      .update({ executed_at: nowIso })
      .eq('device_id', deviceRow.id)
      .in('id', ackIds)
      .is('executed_at', null);
  }

  // 2. Allow only telemetry keys declared in the idea's latest prototype dashboard
  const { data: protoRow } = await supabase
    .from('idea_prototypes')
    .select('data')
    .eq('idea_id', deviceRow.idea_id)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  const widgets = Array.isArray((protoRow?.data as any)?.dashboard)
    ? (protoRow!.data as any).dashboard
    : [];
  const allowedKeys = new Set<string>(
    widgets.map((w: any) => String(w?.key || '')).filter(Boolean)
  );

  const filteredPayload: Record<string, number | boolean | string> = {};
  for (const [k, v] of Object.entries(bodyObj)) {
    if (k === 'ack_commands' || k === 'firmware_version') continue;
    if (!allowedKeys.has(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      filteredPayload[k] = v;
    }
  }

  const reportedFirmwareVersion =
    typeof bodyObj.firmware_version === 'string' ? bodyObj.firmware_version.trim() : '';

  if (
    Object.keys(filteredPayload).length === 0 &&
    ackIds.length === 0 &&
    !reportedFirmwareVersion
  ) {
    return jsonResponse(
      { error: 'No allowed dashboard telemetry keys found in payload' },
      400
    );
  }

  if (Object.keys(filteredPayload).length > 0) {
    const { error: insertErr } = await supabase.from('iot_telemetry').insert({
      user_id: deviceRow.user_id,
      device_id: deviceRow.id,
      payload: filteredPayload,
    });
    if (insertErr) {
      return jsonResponse({ error: insertErr.message }, 500);
    }
  }

  await Promise.all([
    supabase.from('devices').update({ last_seen_at: nowIso }).eq('id', deviceRow.id),
    supabase.from('device_tokens').update({ last_used_at: nowIso }).eq('id', tokenRow.id),
  ]);

  // 3. Return unexecuted, unexpired commands for the ESP32 to act on
  const { data: pendingCmds } = await supabase
    .from('iot_commands')
    .select('id, action, value, expires_at')
    .eq('device_id', deviceRow.id)
    .is('executed_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(10);

  // 4. Check for newer OTA firmware release for this idea
  let firmwarePayload: { version: string; url: string; sha256: string } | null = null;
  if (reportedFirmwareVersion) {
    const { data: latestRelease } = await supabase
      .from('firmware_releases')
      .select('version, storage_path, sha256')
      .eq('idea_id', deviceRow.idea_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      latestRelease &&
      isNewerVersion(latestRelease.version, reportedFirmwareVersion)
    ) {
      const { data: signedData } = await supabase.storage
        .from('firmware-bins')
        .createSignedUrl(latestRelease.storage_path, 300);

      if (signedData?.signedUrl) {
        firmwarePayload = {
          version: latestRelease.version,
          url: signedData.signedUrl,
          sha256: latestRelease.sha256,
        };
      }
    }
  }

  return jsonResponse({
    ok: true,
    commands: (pendingCmds || []).map((c) => ({
      id: c.id,
      action: c.action,
      value: c.value,
    })),
    firmware: firmwarePayload,
  });
});
