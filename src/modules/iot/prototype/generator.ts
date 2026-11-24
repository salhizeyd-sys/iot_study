import {
  ChatMessage,
  Idea,
  PrototypeContextSummary,
  PrototypeRecord,
  PrototypeV1,
  bus,
} from '../../../core';
import { buildProjectContext, callLLM } from '../../../llm';
import { store } from '../../../store';
import { checkEsp32Pins, PinCheckResult } from './pinChecker';
import { parsePrototypeResponse } from './schema';
import { hasHardcodedSecrets, sysPrototype } from './template';

export interface PrototypeDiff {
  wiringChanges: string[];
  firmwareChanges: string[];
  dashboardChanges: string[];
  warningChanges: string[];
}

export function toContextSummary(record?: PrototypeRecord): PrototypeContextSummary | undefined {
  if (!record) return undefined;
  const d = record.data;
  return {
    revision: record.revision,
    boardFqbn: d.board.fqbn,
    wiringCount: d.wiring.length,
    wiringPreview: d.wiring.slice(0, 6).map((w) => `${w.part} (${w.part_pin}) -> ${w.mcu_pin}`),
    dashboardKeys: d.dashboard.map((w) => w.key),
  };
}

export function computePrototypeDiff(
  prev: PrototypeV1,
  next: PrototypeV1
): PrototypeDiff {
  const wiringChanges: string[] = [];
  const prevWiring = new Map(
    prev.wiring.map((w) => [`${w.part}:${w.part_pin}`, w.mcu_pin])
  );
  const nextWiring = new Map(
    next.wiring.map((w) => [`${w.part}:${w.part_pin}`, w.mcu_pin])
  );

  for (const [k, pin] of nextWiring) {
    if (!prevWiring.has(k)) wiringChanges.push(`+ توصيل جديد: ${k} → ${pin}`);
    else if (prevWiring.get(k) !== pin) {
      wiringChanges.push(`~ تغيير رجل ${k}: ${prevWiring.get(k)} → ${pin}`);
    }
  }
  for (const [k, pin] of prevWiring) {
    if (!nextWiring.has(k)) wiringChanges.push(`- إزالة توصيل: ${k} (${pin})`);
  }

  const firmwareChanges: string[] = [];
  const prevFiles = new Map(prev.firmware.files.map((f) => [f.name, f.content]));
  const nextFiles = new Map(next.firmware.files.map((f) => [f.name, f.content]));

  for (const [name, content] of nextFiles) {
    if (!prevFiles.has(name)) firmwareChanges.push(`+ ملف جديد: ${name}`);
    else if (prevFiles.get(name) !== content) {
      firmwareChanges.push(`~ تحديث ملف: ${name}`);
    }
  }
  for (const name of prevFiles.keys()) {
    if (!nextFiles.has(name)) firmwareChanges.push(`- حذف ملف: ${name}`);
  }

  const dashboardChanges: string[] = [];
  const prevWidgets = new Set(prev.dashboard.map((w) => `${w.key}:${w.type}`));
  const nextWidgets = new Set(next.dashboard.map((w) => `${w.key}:${w.type}`));
  for (const w of nextWidgets) {
    if (!prevWidgets.has(w)) dashboardChanges.push(`+ عنصر لوحة: ${w}`);
  }
  for (const w of prevWidgets) {
    if (!nextWidgets.has(w)) dashboardChanges.push(`- إزالة عنصر لوحة: ${w}`);
  }

  const warningChanges: string[] = [];
  const prevWarn = new Set(prev.warnings);
  const nextWarn = new Set(next.warnings);
  for (const w of nextWarn) {
    if (!prevWarn.has(w)) warningChanges.push(`+ تحذير: ${w}`);
  }
  for (const w of prevWarn) {
    if (!nextWarn.has(w)) warningChanges.push(`- زوال تحذير: ${w}`);
  }

  return {
    wiringChanges,
    firmwareChanges,
    dashboardChanges,
    warningChanges,
  };
}

export interface GeneratePrototypeResult {
  record: PrototypeRecord;
  pinCheck: PinCheckResult;
  retried: boolean;
}

export async function generatePrototype(
  idea: Idea,
  options: {
    revisionFeedback?: string;
    previous?: PrototypeRecord;
    tokenBudget?: number;
  } = {}
): Promise<GeneratePrototypeResult> {
  const ctx = buildProjectContext(idea, {
    tokenBudget: options.tokenBudget,
    prototype: toContextSummary(options.previous),
  });

  const system = sysPrototype(ctx, options.revisionFeedback);
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: options.revisionFeedback
        ? `عدّل النموذج الأولي حسب الملاحظة التالية وأخرج PrototypeV1 JSON فقط: ${options.revisionFeedback}`
        : 'ولّد النموذج الأولي الكامل (ESP32 + Preferences/NVS + إرسال كل 5 ثوانٍ) بصيغة JSON فقط.',
    },
  ];

  const firstRaw = await callLLM(messages, system);
  let parsed = parsePrototypeResponse(firstRaw);
  let retried = false;

  if (!parsed.ok) {
    retried = true;
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: firstRaw },
      {
        role: 'user',
        content: `استجابتك السابقة لم تطابق مخطط PrototypeV1 للسبب التالي: ${parsed.error}. أصلح البنية وأخرج JSON صالحاً فقط دون أي نص إضافي.`,
      },
    ];
    const secondRaw = await callLLM(retryMessages, system);
    parsed = parsePrototypeResponse(secondRaw);
    if (!parsed.ok) {
      throw new Error(`فشل التحقق من النموذج الأولي بعد إعادة المحاولة: ${parsed.error}`);
    }
  }

  const data = parsed.data;
  const pinCheck = checkEsp32Pins(data.wiring);

  const extraWarnings: string[] = [];
  for (const issue of pinCheck.issues) {
    if (!data.warnings.includes(issue.message)) {
      extraWarnings.push(issue.message);
    }
  }
  for (const file of data.firmware.files) {
    if (hasHardcodedSecrets(file.content)) {
      const secretWarn = `مراجعة أمان (${file.name}): يبدو أن الكود يحتوي نصاً ثابتاً يشبه كلمة مرور أو رمزاً؛ استبدله بالقراءة من Preferences/NVS.`;
      if (!data.warnings.includes(secretWarn)) {
        extraWarnings.push(secretWarn);
      }
    }
  }

  const finalData: PrototypeV1 = {
    ...data,
    warnings: [...data.warnings, ...extraWarnings],
  };

  const record = await store.savePrototypeRevision(
    idea.id,
    finalData,
    options.revisionFeedback || 'توليد أولي'
  );

  bus.emit('prototype:generated', {
    ideaId: idea.id,
    revision: record.revision,
  });

  return { record, pinCheck, retried };
}
