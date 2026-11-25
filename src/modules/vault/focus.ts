import { Idea, PlanStep } from '../../core';

export const COOLDOWN_DAYS = 7;
export const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export function isInCooldown(idea: Idea, now: number = Date.now()): boolean {
  if (idea.lifecycle !== 'cooldown') return false;
  if (typeof idea.cooldown_until !== 'number') return false;
  return idea.cooldown_until > now;
}

export interface CooldownRemaining {
  active: boolean;
  days: number;
  hours: number;
  minutes: number;
  formatted: string;
}

export function getCooldownRemaining(
  idea: Idea,
  now: number = Date.now()
): CooldownRemaining {
  const until = idea.cooldown_until ?? 0;
  const diff = Math.max(0, until - now);
  if (idea.lifecycle !== 'cooldown' || diff <= 0) {
    return { active: false, days: 0, hours: 0, minutes: 0, formatted: 'انتهت فترة التبريد' };
  }

  const totalMinutes = Math.ceil(diff / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  let formatted = '';
  if (days > 0) {
    formatted = `${days} يوم و ${hours} ساعة`;
  } else if (hours > 0) {
    formatted = `${hours} ساعة و ${minutes} دقيقة`;
  } else {
    formatted = `${minutes} دقيقة`;
  }

  return { active: true, days, hours, minutes, formatted };
}

export function applyCooldown(idea: Idea, now: number = Date.now()): Idea {
  return {
    ...idea,
    lifecycle: 'cooldown',
    cooldown_until: now + COOLDOWN_MS,
    cooldown_bypass_reason: undefined,
  };
}

export function bypassCooldown(idea: Idea, reason: string): Idea {
  const clean = reason.trim();
  if (clean.length < 3) {
    throw new Error('اكتب سبباً واضحاً لتجاوز فترة التبريد (3 أحرف على الأقل)');
  }
  return {
    ...idea,
    lifecycle: idea.plan?.length ? 'planned' : 'idea',
    cooldown_until: 0,
    cooldown_bypass_reason: clean,
  };
}

export function getNextUncompletedStep(idea: Idea): {
  step: PlanStep | null;
  stepIndex: number;
  doneCount: number;
  totalCount: number;
  percent: number;
} {
  const plan = idea.plan || [];
  const totalCount = plan.length;
  const doneCount = plan.filter((p) => p.done).length;
  const stepIndex = plan.findIndex((p) => !p.done);
  const step = stepIndex >= 0 ? plan[stepIndex] : null;
  const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  return { step, stepIndex, doneCount, totalCount, percent };
}

export interface FocusBreakdown {
  total: number;
  aligned: { count: number; pct: number };
  partial: { count: number; pct: number };
  distraction: { count: number; pct: number };
}

export function computeFocusBreakdown(ideas: Idea[]): FocusBreakdown {
  const total = ideas.length;
  const alignedCount = ideas.filter((i) => i.focus === 'aligned').length;
  const partialCount = ideas.filter((i) => i.focus === 'partial').length;
  const distractionCount = ideas.filter((i) => i.focus === 'distraction').length;

  const pct = (count: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

  return {
    total,
    aligned: { count: alignedCount, pct: pct(alignedCount) },
    partial: { count: partialCount, pct: pct(partialCount) },
    distraction: { count: distractionCount, pct: pct(distractionCount) },
  };
}

export function getDoingOverflow(
  ideas: Idea[],
  targetIdeaId: string,
  maxDoing: number
): Idea[] {
  const limit = Math.max(1, Math.floor(maxDoing || 1));
  const otherDoing = ideas.filter(
    (i) => i.status === 'doing' && i.id !== targetIdeaId
  );
  if (otherDoing.length + 1 > limit) {
    return otherDoing;
  }
  return [];
}
