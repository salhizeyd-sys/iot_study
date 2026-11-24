import { describe, expect, it } from 'vitest';
import { Idea } from '../core';
import { buildProjectContext, estimateTokens } from './context';

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'idea-ctx-1',
    schemaVersion: 3,
    created: 1000,
    name: 'مراقب الدفيئة الذكي',
    domain: 'IoT',
    type: 'both',
    status: 'doing',
    lifecycle: 'planned',
    memory: 'تم اختيار حساس DHT22 على GPIO4 بدل DHT11 لدقته الأعلى.',
    problem: 'تذبذب الحرارة والرطوبة داخل الدفيئة.',
    solution: 'قياس دوري بـ ESP32 وتشغيل مروحة عبر مرحل.',
    focus: 'aligned',
    focus_note: 'ضمن مجال الأنظمة المدمجة',
    skills: ['ESP32', 'MQTT'],
    duration: 'أسبوعان',
    plan: [
      { step: 'تجهيز القطع', detail: 'شراء ESP32 وDHT22', done: true },
      { step: 'كتابة كود القراءة', detail: 'قراءة كل 5 ثوانٍ', done: false },
    ],
    plan_history: [],
    components: [
      { name: 'ESP32 DevKit', qty: 1, note: 'متحكم' },
      { name: 'DHT22', qty: 1, note: 'حرارة ورطوبة' },
    ],
    notes: 'استخدام مقاومة سحب 10k على خط البيانات.',
    ...overrides,
  };
}

describe('buildProjectContext', () => {
  it('orders sections according to ARCHITECTURE.md 8.1', () => {
    const ctx = buildProjectContext(makeIdea(), {
      prototype: {
        revision: 2,
        boardFqbn: 'esp32:esp32:esp32',
        wiringCount: 2,
        wiringPreview: ['DHT22 DATA -> GPIO4'],
        dashboardKeys: ['temp', 'humidity'],
      },
      device: {
        lastSeenAt: 1700000000000,
        lastTelemetryKeys: ['temp'],
      },
    });

    const cardIdx = ctx.indexOf('## بطاقة الفكرة');
    const planIdx = ctx.indexOf('## خطة التنفيذ');
    const doneIdx = ctx.indexOf('### المنجز:');
    const pendingIdx = ctx.indexOf('### المتبقي:');
    const bomIdx = ctx.indexOf('## قائمة العناصر (BOM)');
    const protoIdx = ctx.indexOf('## ملخص النموذج الأولي (v2)');
    const deviceIdx = ctx.indexOf('## حالة الجهاز');
    const memoryIdx = ctx.indexOf('## ذاكرة المشروع');
    const notesIdx = ctx.indexOf('## ملاحظاتي');

    expect(cardIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(cardIdx);
    expect(doneIdx).toBeGreaterThan(planIdx);
    expect(pendingIdx).toBeGreaterThan(doneIdx);
    expect(bomIdx).toBeGreaterThan(planIdx);
    expect(protoIdx).toBeGreaterThan(bomIdx);
    expect(deviceIdx).toBeGreaterThan(protoIdx);
    expect(memoryIdx).toBeGreaterThan(deviceIdx);
    expect(notesIdx).toBeGreaterThan(memoryIdx);
  });

  it('respects configurable token budget and truncates overflow cleanly', () => {
    const longNotes = 'ملاحظة طويلة جداً '.repeat(120);
    const idea = makeIdea({ notes: longNotes });

    const budget = 110;
    const ctx = buildProjectContext(idea, { tokenBudget: budget });

    expect(estimateTokens(ctx)).toBeLessThanOrEqual(budget);
    expect(ctx).toContain('## بطاقة الفكرة');
    expect(ctx.endsWith('…')).toBe(true);
  });

  it('omits optional sections cleanly when absent', () => {
    const minimalIdea = makeIdea({
      duration: '',
      skills: [],
      plan: [],
      components: [],
      memory: '',
      notes: '',
    });

    const ctx = buildProjectContext(minimalIdea);

    expect(ctx).toContain('## بطاقة الفكرة');
    expect(ctx).not.toContain('## خطة التنفيذ');
    expect(ctx).not.toContain('## قائمة العناصر (BOM)');
    expect(ctx).not.toContain('## ملخص النموذج الأولي');
    expect(ctx).not.toContain('## حالة الجهاز');
    expect(ctx).not.toContain('## ذاكرة المشروع');
    expect(ctx).not.toContain('## ملاحظاتي');
    expect(ctx).not.toContain('undefined');
  });
});
