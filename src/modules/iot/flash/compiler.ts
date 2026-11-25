import { FirmwareFile } from '../../../core';

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
    throw new Error(data?.error || 'فشلت الترجمة المحلية عبر arduino-cli');
  }

  return {
    ok: true,
    fqbn: data.fqbn || fqbn,
    bins: Array.isArray(data.bins) ? data.bins : [],
    logs: String(data.logs || ''),
  };
}
