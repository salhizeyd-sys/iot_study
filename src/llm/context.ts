import {
  DeviceContextSummary,
  Idea,
  PrototypeContextSummary,
  FOCUS,
  LIFECYCLE,
  STATUS,
  TYPES,
} from '../core';

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 1600;
const CHARS_PER_TOKEN = 4;

export interface ProjectContextOptions {
  tokenBudget?: number;
  prototype?: PrototypeContextSummary;
  device?: DeviceContextSummary;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function fitToBudget(sections: string[], tokenBudget: number): string {
  const budget = Math.max(40, Math.floor(tokenBudget));
  const maxChars = budget * CHARS_PER_TOKEN;
  const result: string[] = [];
  let usedChars = 0;

  for (const section of sections) {
    if (!section.trim()) continue;
    const separator = result.length > 0 ? '\n\n' : '';
    const needed = separator.length + section.length;

    if (usedChars + needed <= maxChars) {
      result.push(section);
      usedChars += needed;
      continue;
    }

    const remaining = maxChars - usedChars - separator.length;
    if (remaining > 16) {
      result.push(section.slice(0, remaining - 1).trimEnd() + '…');
    }
    break;
  }

  return result.join('\n\n');
}

export function buildProjectContext(
  idea: Idea,
  options: ProjectContextOptions = {}
): string {
  const tokenBudget = options.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
  const sections: string[] = [];

  // 1. بطاقة الفكرة
  const cardLines = [
    `## بطاقة الفكرة`,
    `- الاسم: ${idea.name}`,
    `- المجال: ${idea.domain}`,
    `- النوع: ${TYPES[idea.type] || idea.type}`,
    `- الحالة: ${STATUS[idea.status] || idea.status} (${LIFECYCLE[idea.lifecycle] || idea.lifecycle})`,
    `- التوافق: ${FOCUS[idea.focus]?.[0] || idea.focus}${idea.focus_note ? ' — ' + idea.focus_note : ''}`,
  ];
  if (idea.duration) cardLines.push(`- المدة: ${idea.duration}`);
  if (idea.problem) cardLines.push(`- المشكلة: ${idea.problem}`);
  if (idea.solution) cardLines.push(`- الحل: ${idea.solution}`);
  if (idea.skills?.length) cardLines.push(`- المهارات: ${idea.skills.join('، ')}`);
  sections.push(cardLines.join('\n'));

  // 2. الخطوات المنجزة والمتبقية
  if (idea.plan?.length) {
    const doneSteps = idea.plan.filter((p) => p.done);
    const pendingSteps = idea.plan.filter((p) => !p.done);
    const planLines = ['## خطة التنفيذ'];
    if (doneSteps.length) {
      planLines.push('### المنجز:');
      doneSteps.forEach((p) =>
        planLines.push(`- [x] ${p.step}${p.detail ? ': ' + p.detail : ''}`)
      );
    }
    if (pendingSteps.length) {
      planLines.push('### المتبقي:');
      pendingSteps.forEach((p) =>
        planLines.push(`- [ ] ${p.step}${p.detail ? ': ' + p.detail : ''}`)
      );
    }
    sections.push(planLines.join('\n'));
  }

  // 3. قائمة العناصر (BOM)
  if (idea.components?.length) {
    const bomLines = ['## قائمة العناصر (BOM)'];
    idea.components.forEach((c) => {
      bomLines.push(`- ${c.name} × ${c.qty || 1}${c.note ? ' (' + c.note + ')' : ''}`);
    });
    sections.push(bomLines.join('\n'));
  }

  // 4. ملخص آخر نموذج أولي (إن وجد)
  if (options.prototype) {
    const p = options.prototype;
    const protoLines = [
      `## ملخص النموذج الأولي (v${p.revision})`,
      `- اللوحة: ${p.boardFqbn}`,
      `- عدد التوصيلات: ${p.wiringCount}`,
    ];
    if (p.wiringPreview?.length) {
      protoLines.push(`- التوصيل: ${p.wiringPreview.join('؛ ')}`);
    }
    if (p.dashboardKeys?.length) {
      protoLines.push(`- مفاتيح اللوحة: ${p.dashboardKeys.join('، ')}`);
    }
    sections.push(protoLines.join('\n'));
  }

  // 5. حالة الجهاز (إن وجدت)
  if (options.device) {
    const d = options.device;
    const devLines = ['## حالة الجهاز'];
    if (d.lastSeenAt) {
      devLines.push(`- آخر ظهور: ${new Date(d.lastSeenAt).toISOString()}`);
    }
    if (d.lastTelemetryKeys?.length) {
      devLines.push(`- آخر القراءات: ${d.lastTelemetryKeys.join('، ')}`);
    }
    if (devLines.length > 1) sections.push(devLines.join('\n'));
  }

  // 6. ذاكرة المشروع (memory)
  if (idea.memory?.trim()) {
    sections.push(`## ذاكرة المشروع (قرارات سابقة)\n${idea.memory.trim()}`);
  }

  // 7. ملاحظاتي
  if (idea.notes?.trim()) {
    sections.push(`## ملاحظاتي\n${idea.notes.trim()}`);
  }

  return fitToBudget(sections, tokenBudget);
}
