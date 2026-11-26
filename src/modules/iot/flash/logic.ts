import { Idea } from '../../../core';

export interface MissingHeaderMatch {
  header: string;
  query: string;
}

export function canStartFlash(options: {
  reviewConfirmed: boolean;
  binsCount: number;
}): { allowed: boolean; reason?: string } {
  if (!options.reviewConfirmed) {
    return { allowed: false, reason: 'يجب تأكيد المراجعة الإجبارية أولاً' };
  }
  if (options.binsCount <= 0) {
    return { allowed: false, reason: 'قم بالترجمة المحلية أولاً للحصول على ملفات .bin' };
  }
  return { allowed: true };
}

export function markIdeaReadyToFlash(idea: Idea): Idea {
  return {
    ...idea,
    lifecycle: 'ready_to_flash',
    updatedAt: Date.now(),
  };
}

export function markIdeaFlashed(idea: Idea): Idea {
  return {
    ...idea,
    lifecycle: 'flashed',
    updatedAt: Date.now(),
  };
}

export function extractMissingHeaderFromCompileError(
  errorText: string
): MissingHeaderMatch | null {
  const text = String(errorText || '');
  if (!text) return null;

  const patterns = [
    /fatal error:\s*([^\r\n:]+?\.(?:h|hpp))\s*:\s*No such file or directory/i,
    /([^\s:'"]+\.(?:h|hpp))\s*:\s*No such file or directory/i,
    /'([^'\r\n]+\.(?:h|hpp))'\s*file not found/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const header = m[1].trim();
      const base = header.split(/[\\/]/).pop() || header;
      const query = base.replace(/\.(?:h|hpp)$/i, '').trim();
      if (query) {
        return { header, query };
      }
    }
  }

  return null;
}

export function cleanFixedFirmwareCode(aiResponse: string): string {
  const raw = String(aiResponse || '').trim();
  if (!raw) return '';

  const fenced = raw.match(/```(?:cpp|c\+\+|c|ino|arduino)?\s*\r?\n([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return raw
    .replace(/^```(?:cpp|c\+\+|c|ino|arduino)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export function buildCompileFixPrompts(params: {
  mainInoContent: string;
  fqbn: string;
  libraries: string[];
  errorLogs: string;
}): { system: string; userMessage: string } {
  const system = `أنت مهندس ESP32 / Arduino C++ خبير. مهمتك إصلاح أخطاء الترجمة في ملف main.ino فقط مع الحفاظ التام على جميع إعدادات الأمان (NVS preferences namespace "iot_vault" لقراءة wifi_ssid وwifi_pass وdevice_token وingest_url، بدون أي أسرار مكتوبة في الكود) والحفاظ على منطق الحساسات والمشغّلات وOTA.
أعد كود main.ino المُصلح الكامل فقط بدون أي شرح أو مقدمات أو علامات Markdown (أو كود جاهز للتشغيل المباشر).`;

  const userMessage = `اللوحة: ${params.fqbn}
المكتبات المعلنة: ${params.libraries.length ? params.libraries.join(', ') : 'غير محددة'}

=== خطأ المترجم (stderr) ===
${params.errorLogs.slice(0, 3500)}

=== الكود الحالي (main.ino) ===
${params.mainInoContent}`;

  return { system, userMessage };
}
