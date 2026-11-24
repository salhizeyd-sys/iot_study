import {
  FilterState,
  Idea,
  IdeaFocus,
  IdeaType,
  PlanHistoryEntry,
  PlanStep,
  FOCUS,
  TYPES,
} from '../../core';

export const norm = (j: any) => ({
  name: j.name || 'فكرة بلا اسم',
  domain: j.domain || 'عام',
  type: (TYPES[j.type as IdeaType] ? j.type : 'software') as IdeaType,
  problem: j.problem || '',
  solution: j.solution || '',
  focus: (FOCUS[j.focus as IdeaFocus] ? j.focus : 'partial') as IdeaFocus,
  focus_note: j.focus_note || '',
  skills: Array.isArray(j.skills_needed)
    ? j.skills_needed
    : Array.isArray(j.skills)
      ? j.skills
      : [],
  duration: j.duration || '',
  plan: (j.plan || []).map((p: any) => ({
    step: p.step || '',
    detail: p.detail || '',
    done: !!p.done,
  })),
  components: (j.components || []).map((c: any) => ({
    name: c.name || '',
    qty: Number(c.qty) || 1,
    note: c.note || '',
  })),
});

export function filterIdeas(ideas: Idea[], filt: FilterState): Idea[] {
  const q = filt.q.toLowerCase();
  return ideas.filter(
    (i) =>
      (!filt.type || i.type === filt.type) &&
      (!filt.domain || i.domain === filt.domain) &&
      (!q || (i.name + i.problem + i.solution + i.domain).toLowerCase().includes(q))
  );
}

export function mergeUpdatedPlan(
  existingPlan: PlanStep[],
  incomingSteps: Array<{ step?: string; detail?: string }>,
  now: number = Date.now()
): { nextPlan: PlanStep[]; historyEntry: PlanHistoryEntry } {
  const historyEntry: PlanHistoryEntry = {
    savedAt: now,
    plan: existingPlan.map((p) => ({ ...p })),
  };

  const completed = existingPlan.filter((p) => p.done).map((p) => ({ ...p }));
  const completedKeys = new Set(completed.map((p) => p.step.trim().toLowerCase()));

  const pending: PlanStep[] = [];
  for (const raw of incomingSteps) {
    const step = String(raw?.step ?? '').trim();
    if (!step) continue;
    if (completedKeys.has(step.toLowerCase())) continue;
    pending.push({
      step,
      detail: String(raw?.detail ?? '').trim(),
      done: false,
    });
  }

  return {
    nextPlan: [...completed, ...pending],
    historyEntry,
  };
}
