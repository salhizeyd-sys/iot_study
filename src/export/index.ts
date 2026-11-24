import { Idea, PrototypeRecord, PrototypeV1, TYPES, STATUS, FOCUS } from '../core';

function formatPrototypeMD(proto: PrototypeV1, revision?: number): string {
  const revLabel = revision ? ` (v${revision})` : '';
  const wiring = proto.wiring
    .map(
      (w) =>
        `- **${w.part}** (${w.part_pin}) → \`${w.mcu_pin}\`${w.note ? ' — ' + w.note : ''}`
    )
    .join('\n');

  const files = proto.firmware.files
    .map((f) => `### ملف: \`${f.name}\`\n\`\`\`cpp\n${f.content}\n\`\`\``)
    .join('\n\n');

  const warnings = proto.warnings.length
    ? `\n### تحذيرات المراجعة\n${proto.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}\n`
    : '';

  const libs = proto.firmware.libraries.length
    ? `- المكتبات: ${proto.firmware.libraries.join('، ')}\n`
    : '';

  return `\n## النموذج الأولي${revLabel}
- اللوحة: \`${proto.board.fqbn}\`${proto.board.ota ? ' (يدعم OTA)' : ''}
${libs}
### التوصيل
${wiring || '-'}

### الكود البرمجي
${files}
${warnings}`;
}

export const toMD = (i: Idea, prototype?: PrototypeV1 | PrototypeRecord): string => {
  const protoData =
    prototype && 'data' in prototype ? prototype.data : (prototype as PrototypeV1 | undefined);
  const protoRev =
    prototype && 'revision' in prototype ? prototype.revision : undefined;

  return `# ${i.name}

- المجال: ${i.domain}
- النوع: ${TYPES[i.type] || i.type}
- الحالة: ${STATUS[i.status] || i.status}
- التوافق مع أهدافي: ${FOCUS[i.focus] ? FOCUS[i.focus][0] : i.focus}${i.focus_note ? ' — ' + i.focus_note : ''}
${i.duration ? '- المدة المقدّرة: ' + i.duration + '\n' : ''}
## المشكلة
${i.problem}

## الحل
${i.solution}

## المهارات المطلوبة
${(i.skills || []).map((s) => '- ' + s).join('\n') || '-'}

## خطة التنفيذ
${(i.plan || []).map((p, n) => `${n + 1}. [${p.done ? 'x' : ' '}] **${p.step}** — ${p.detail}`).join('\n')}
${i.components && i.components.length ? '\n## العناصر المطلوبة\n' + i.components.map((c) => `- ${c.name} × ${c.qty || 1}${c.note ? ' (' + c.note + ')' : ''}`).join('\n') + '\n' : ''}${i.memory ? '\n## ذاكرة المشروع\n' + i.memory + '\n' : ''}${i.notes ? '\n## ملاحظات\n' + i.notes + '\n' : ''}${protoData ? formatPrototypeMD(protoData, protoRev) : ''}`;
};

export const toPrompt = (i: Idea, prototype?: PrototypeV1 | PrototypeRecord): string =>
  `أنت مهندس خبير يساعدني في تنفيذ مشروع. أنا طالب ماستر أنظمة مدمجة. هذه وثيقة المشروع، راجعها ثم ساعدني في الخطوة التالية غير المكتملة، وأخبرني إن رأيت خللاً في الخطة أو التوصيل أو الكود.\n\n${toMD(i, prototype)}`;

export const dl = (name: string, text: string, mime?: string): void => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([text], { type: (mime || 'text/markdown') + ';charset=utf-8' })
  );
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
