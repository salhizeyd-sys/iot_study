import { Idea, TYPES, STATUS, FOCUS } from '../core';

export const toMD = (i: Idea): string =>
  `# ${i.name}

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
${i.components && i.components.length ? '\n## العناصر المطلوبة\n' + i.components.map((c) => `- ${c.name} × ${c.qty || 1}${c.note ? ' (' + c.note + ')' : ''}`).join('\n') + '\n' : ''}${i.notes ? '\n## ملاحظات\n' + i.notes + '\n' : ''}`;

export const toPrompt = (i: Idea): string =>
  `أنت مهندس خبير يساعدني في تنفيذ مشروع. أنا طالب ماستر أنظمة مدمجة. هذه وثيقة المشروع، راجعها ثم ساعدني في الخطوة التالية غير المكتملة، وأخبرني إن رأيت خللاً في الخطة.\n\n${toMD(i)}`;

export const dl = (name: string, text: string, mime?: string): void => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([text], { type: (mime || 'text/markdown') + ';charset=utf-8' })
  );
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
