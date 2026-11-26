import { FirmwareFile } from './types';

export const DEFAULT_COMPILE_URL = 'http://127.0.0.1:8787';

export interface FlashBinaryPart {
  name: string;
  offset: number;
  dataBase64: string;
}

export interface LocalHealthResult {
  ok: boolean;
  arduinoCli: boolean;
  esp32Core: boolean;
  version?: string;
  error?: string;
}

export interface CompileLocalResult {
  ok: boolean;
  fqbn: string;
  bins: FlashBinaryPart[];
  logs: string;
}

export interface InstalledLibraryInfo {
  name: string;
  version: string;
  sentence?: string;
}

export interface LibrarySearchItem {
  name: string;
  version: string;
  author?: string;
  sentence?: string;
}

export interface InstallLibraryResult {
  ok: boolean;
  name: string;
  logs: string;
}

export interface CompileFailureError extends Error {
  logs?: string;
}

export async function checkLocalCompiler(
  baseUrl: string = DEFAULT_COMPILE_URL
): Promise<LocalHealthResult> {
  const url = baseUrl.replace(/\/$/, '') + '/health';
  try {
    const res = await fetch(url);
    const data = await res.json();
    return {
      ok: Boolean(res.ok && data?.ok),
      arduinoCli: Boolean(data?.arduinoCli),
      esp32Core: Boolean(data?.esp32Core),
      version: data?.version,
      error: data?.error,
    };
  } catch (err: any) {
    return {
      ok: false,
      arduinoCli: false,
      esp32Core: false,
      error:
        err?.message ||
        'تعذّر الاتصال بخادم الترجمة المحلي. شغّل npm run compile-local على حاسوبك.',
    };
  }
}

export async function compileSketchLocal(
  files: FirmwareFile[],
  fqbn: string,
  libraries: string[],
  baseUrl: string = DEFAULT_COMPILE_URL
): Promise<CompileLocalResult> {
  const url = baseUrl.replace(/\/$/, '') + '/compile';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fqbn, files, libraries }),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    const error = new Error(
      data?.error || 'فشلت الترجمة المحلية عبر arduino-cli'
    ) as CompileFailureError;
    error.logs = String(data?.logs || data?.error || error.message);
    throw error;
  }

  return {
    ok: true,
    fqbn: data.fqbn || fqbn,
    bins: Array.isArray(data.bins) ? data.bins : [],
    logs: String(data.logs || ''),
  };
}

export async function listInstalledLibraries(
  baseUrl: string = DEFAULT_COMPILE_URL
): Promise<InstalledLibraryInfo[]> {
  const url = baseUrl.replace(/\/$/, '') + '/libraries';
  const res = await fetch(url);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'تعذّر قراءة المكتبات المثبتة');
  }
  return Array.isArray(data.libraries) ? data.libraries : [];
}

export async function searchArduinoLibraries(
  query: string,
  baseUrl: string = DEFAULT_COMPILE_URL
): Promise<LibrarySearchItem[]> {
  const clean = query.trim();
  if (!clean) return [];
  const url = `${baseUrl.replace(/\/$/, '')}/libraries/search?q=${encodeURIComponent(clean)}`;
  const res = await fetch(url);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'تعذّر البحث عن المكتبات');
  }
  return Array.isArray(data.libraries) ? data.libraries : [];
}

export async function installArduinoLibrary(
  name: string,
  baseUrl: string = DEFAULT_COMPILE_URL
): Promise<InstallLibraryResult> {
  const clean = name.trim();
  if (!clean) {
    throw new Error('اسم المكتبة مطلوب');
  }
  const url = baseUrl.replace(/\/$/, '') + '/libraries/install';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `فشل تثبيت المكتبة: ${clean}`);
  }
  return {
    ok: true,
    name: String(data.name || clean),
    logs: String(data.logs || ''),
  };
}
