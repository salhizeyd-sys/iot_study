import { FirmwareReleaseRecord, FlashBinaryPart } from '../core';
import { getCurrentSupabaseUser, getSupabaseClient } from './supabaseClient';

export const FIRMWARE_BUCKET = 'firmware-bins';

export async function computeBytesSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}

export function base64ToBytes(dataBase64: string): Uint8Array {
  const binStr = atob(dataBase64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i += 1) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

export function pickAppBinaryPart(bins: FlashBinaryPart[]): FlashBinaryPart | null {
  if (!bins.length) return null;
  const appAtStandardOffset = bins.find((b) => b.offset === 0x10000);
  if (appAtStandardOffset) return appAtStandardOffset;
  const namedApp = bins.find(
    (b) =>
      b.name.endsWith('.bin') &&
      !b.name.includes('bootloader') &&
      !b.name.includes('partitions') &&
      !b.name.includes('merged')
  );
  return namedApp || bins[bins.length - 1] || null;
}

export async function listFirmwareReleases(ideaId: string): Promise<FirmwareReleaseRecord[]> {
  const client = getSupabaseClient();
  const user = await getCurrentSupabaseUser();
  if (!client || !user) return [];

  const { data, error } = await client
    .from('firmware_releases')
    .select('*')
    .eq('idea_id', ideaId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []) as FirmwareReleaseRecord[];
}

export async function publishOtaRelease(params: {
  ideaId: string;
  version: string;
  binaryBytes: Uint8Array;
  fileName?: string;
}): Promise<FirmwareReleaseRecord> {
  const client = getSupabaseClient();
  const user = await getCurrentSupabaseUser();
  if (!client || !user) {
    throw new Error('سجّل الدخول بحساب Supabase أولاً لنشر تحديث OTA');
  }

  const cleanVersion = params.version.trim();
  if (!cleanVersion) {
    throw new Error('أدخل رقم إصدار صالحاً (مثال: 1.0.1)');
  }
  if (!params.binaryBytes || params.binaryBytes.byteLength === 0) {
    throw new Error('ملف .bin فارغ');
  }

  const sha256 = await computeBytesSha256Hex(params.binaryBytes);
  const safeVer = cleanVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeBase = (params.fileName || 'firmware.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${user.id}/${params.ideaId}/${safeVer}-${safeBase}`;

  const blob = new Blob([new Uint8Array(params.binaryBytes)], {
    type: 'application/octet-stream',
  });
  const { error: uploadErr } = await client.storage
    .from(FIRMWARE_BUCKET)
    .upload(storagePath, blob, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`فشل رفع ملف التحديث: ${uploadErr.message}`);
  }

  const { data, error: insertErr } = await client
    .from('firmware_releases')
    .insert({
      user_id: user.id,
      idea_id: params.ideaId,
      version: cleanVersion,
      storage_path: storagePath,
      sha256,
    })
    .select('*')
    .single();

  if (insertErr || !data) {
    throw new Error(insertErr?.message || 'فشل تسجيل إصدار OTA في قاعدة البيانات');
  }

  return data as FirmwareReleaseRecord;
}
