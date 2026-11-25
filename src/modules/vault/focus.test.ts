// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Idea, mergeSettings } from '../../core';
import { CURRENT_SCHEMA_VERSION, S, migrate } from '../../store';
import {
  COOLDOWN_MS,
  applyCooldown,
  bypassCooldown,
  computeFocusBreakdown,
  getCooldownRemaining,
  getDoingOverflow,
  isInCooldown,
} from './focus';
import {
  completeNextFocusStep,
  confirmBypassCooldown,
  focusView,
  openBypassCooldown,
  setupWindowGlobals,
  switchDoingProject,
  upd,
} from './ui';

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 'f-1',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    created: 1000,
    updatedAt: 1000,
    name: 'مشروع اختبار',
    domain: 'IoT',
    type: 'both',
    status: 'planned',
    lifecycle: 'planned',
    memory: '',
    problem: 'مشكلة',
    solution: 'حل',
    focus: 'aligned',
    focus_note: '',
    skills: [],
    duration: 'أسبوع',
    plan: [
      { step: 'الخطوة 1', detail: 'تفصيل 1', done: true },
      { step: 'الخطوة 2', detail: 'تفصيل 2', done: false },
    ],
    plan_history: [],
    components: [],
    notes: '',
    ...overrides,
  };
}

describe('Focus Mode, Cooldown, and maxDoing switcher (S11)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="app"></main>
      <nav class="bottom-nav">
        <button data-nav="home"></button>
        <button data-nav="focus"></button>
        <button data-nav="new"></button>
        <button data-nav="quick"></button>
        <button data-nav="settings"></button>
      </nav>
      <dialog id="dlg"></dialog>
      <dialog id="set"></dialog>
      <dialog id="quick"></dialog>
      <dialog id="focus-dlg"></dialog>
      <div id="toast"></div>
    `;
    S.ideas = [];
    S.settings = mergeSettings({ maxDoing: 1 });
    setupWindowGlobals();
  });

  it('handles 7-day cooldown and requires a reason to bypass', () => {
    const now = 1_700_000_000_000;
    const base = makeIdea({ lifecycle: 'idea' });
    const cooled = applyCooldown(base, now);

    expect(cooled.lifecycle).toBe('cooldown');
    expect(cooled.cooldown_until).toBe(now + COOLDOWN_MS);
    expect(isInCooldown(cooled, now + 1000)).toBe(true);
    expect(isInCooldown(cooled, now + COOLDOWN_MS + 1)).toBe(false);

    const rem = getCooldownRemaining(cooled, now + 60 * 60 * 1000);
    expect(rem.active).toBe(true);
    expect(rem.days).toBe(6);
    expect(rem.hours).toBe(23);

    expect(() => bypassCooldown(cooled, '  ')).toThrow('سبباً');
    const bypassed = bypassCooldown(cooled, 'ضروري لمشروع التخرج');
    expect(bypassed.lifecycle).toBe('planned');
    expect(bypassed.cooldown_until).toBe(0);
    expect(bypassed.cooldown_bypass_reason).toBe('ضروري لمشروع التخرج');
  });

  it('migrates cooldown_until and cooldown_bypass_reason cleanly', () => {
    const migrated = migrate({
      id: 'mig-cd-1',
      name: 'فكرة مبردة',
      lifecycle: 'cooldown',
      cooldown_until: 1_800_000_000_000,
      cooldown_bypass_reason: 'سبب سابق',
    });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.cooldown_until).toBe(1_800_000_000_000);
    expect(migrated.cooldown_bypass_reason).toBe('سبب سابق');
  });

  it('computes compatibility ratios accurately', () => {
    const ideas = [
      makeIdea({ id: '1', focus: 'aligned' }),
      makeIdea({ id: '2', focus: 'aligned' }),
      makeIdea({ id: '3', focus: 'partial' }),
      makeIdea({ id: '4', focus: 'distraction' }),
    ];

    const ratio = computeFocusBreakdown(ideas);
    expect(ratio.total).toBe(4);
    expect(ratio.aligned).toEqual({ count: 2, pct: 50 });
    expect(ratio.partial).toEqual({ count: 1, pct: 25 });
    expect(ratio.distraction).toEqual({ count: 1, pct: 25 });
  });

  it('prompts to pause an existing doing project when maxDoing is exceeded', () => {
    const active = makeIdea({ id: 'active-1', name: 'نشط حالي', status: 'doing' });
    const candidate = makeIdea({ id: 'cand-2', name: 'مشروع جديد', status: 'planned' });
    S.ideas = [active, candidate];
    S.settings.maxDoing = 1;

    expect(getDoingOverflow(S.ideas, 'cand-2', 1).map((i) => i.id)).toEqual(['active-1']);

    upd('cand-2', 'status', 'doing');
    // Should open #focus-dlg switcher instead of activating both
    expect(S.ideas[1].status).toBe('planned');
    const switchBtn = document.querySelector('#focus-dlg [data-pause-id="active-1"]');
    expect(switchBtn).not.toBeNull();

    switchDoingProject('active-1', 'cand-2');
    expect(S.ideas[0].status).toBe('paused');
    expect(S.ideas[1].status).toBe('doing');
  });

  it('renders Focus Mode view, completes next step, and bypasses cooldown in UI', () => {
    const active = makeIdea({
      id: 'active-1',
      name: 'عقدة قياس الطاقة',
      status: 'doing',
      focus: 'aligned',
    });
    const cooled = applyCooldown(
      makeIdea({
        id: 'cool-1',
        name: 'فكرة جانبية',
        status: 'idea',
        focus: 'distraction',
      }),
      Date.now()
    );
    S.ideas = [active, cooled];

    focusView();
    const appText = document.querySelector('#app')?.textContent || '';
    expect(appText).toContain('وضع التركيز');
    expect(appText).toContain('عقدة قياس الطاقة');
    expect(appText).toContain('الخطوة 2');
    expect(appText).toContain('1/2 (50%)');
    expect(appText).toContain('فكرة جانبية');

    completeNextFocusStep('active-1');
    expect(S.ideas[0].plan[1].done).toBe(true);
    expect(document.querySelector('#app')?.textContent).toContain('2/2 (100%)');

    openBypassCooldown('cool-1');
    document.querySelector<HTMLTextAreaElement>('#bypass-reason')!.value = 'مطلوب هذا الأسبوع';
    confirmBypassCooldown('cool-1');
    expect(isInCooldown(S.ideas[1])).toBe(false);
    expect(S.ideas[1].cooldown_bypass_reason).toBe('مطلوب هذا الأسبوع');
  });
});
