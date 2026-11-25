import {
  ChatMessage,
  HardwareComponent,
  Idea,
  IdeaFocus,
  IdeaLifecycle,
  IdeaStatus,
  IdeaType,
  PlanHistoryEntry,
  PlanStep,
  Settings,
  FOCUS,
  LIFECYCLE,
  STATUS,
  TYPES,
  mergeSettings,
} from '../core';
import { MigrationCapableStore, Store } from './types';

export const CURRENT_SCHEMA_VERSION = 5;
export const LEGACY_STORAGE_KEY = 'ideavault.v1';
export const LEGACY_BACKUP_KEY = 'ideavault.v1.backup';

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `idea-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function statusToLifecycle(status: IdeaStatus): IdeaLifecycle {
  if (status === 'done') return 'done';
  if (status === 'planned' || status === 'doing') return 'planned';
  return 'idea';
}

export function migrate(raw: unknown): Idea {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;

  const type: IdeaType = TYPES[r.type as IdeaType] ? (r.type as IdeaType) : 'software';
  const status: IdeaStatus = STATUS[r.status as IdeaStatus] ? (r.status as IdeaStatus) : 'idea';
  const focus: IdeaFocus = FOCUS[r.focus as IdeaFocus] ? (r.focus as IdeaFocus) : 'partial';
  const lifecycle: IdeaLifecycle = LIFECYCLE[r.lifecycle as IdeaLifecycle]
    ? (r.lifecycle as IdeaLifecycle)
    : statusToLifecycle(status);

  const rawSkills = Array.isArray(r.skills)
    ? r.skills
    : Array.isArray(r.skills_needed)
      ? r.skills_needed
      : [];

  const plan: PlanStep[] = Array.isArray(r.plan)
    ? r.plan.map((p: any) => ({
        step: typeof p?.step === 'string' ? p.step : String(p?.step ?? ''),
        detail: typeof p?.detail === 'string' ? p.detail : String(p?.detail ?? ''),
        done: Boolean(p?.done),
      }))
    : [];

  const planHistory: PlanHistoryEntry[] = Array.isArray(r.plan_history)
    ? r.plan_history
        .filter((entry: any) => entry && Array.isArray(entry.plan))
        .map((entry: any) => ({
          savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : Date.now(),
          plan: entry.plan.map((p: any) => ({
            step: typeof p?.step === 'string' ? p.step : String(p?.step ?? ''),
            detail: typeof p?.detail === 'string' ? p.detail : String(p?.detail ?? ''),
            done: Boolean(p?.done),
          })),
        }))
    : [];

  const components: HardwareComponent[] = Array.isArray(r.components)
    ? r.components.map((c: any) => ({
        name: typeof c?.name === 'string' ? c.name : String(c?.name ?? ''),
        qty: Number(c?.qty) || 1,
        note: typeof c?.note === 'string' ? c.note : '',
      }))
    : [];

  const created =
    typeof r.created === 'number' && Number.isFinite(r.created) ? r.created : Date.now();
  const updatedAt =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : created;

  const migrated: Idea = {
    id: typeof r.id === 'string' && r.id.trim() ? r.id : randomId(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    created,
    updatedAt,
    name: typeof r.name === 'string' && r.name.trim() ? r.name : 'فكرة بلا اسم',
    domain: typeof r.domain === 'string' && r.domain.trim() ? r.domain : 'عام',
    type,
    status,
    lifecycle,
    memory: typeof r.memory === 'string' ? r.memory : '',
    problem: typeof r.problem === 'string' ? r.problem : '',
    solution: typeof r.solution === 'string' ? r.solution : '',
    focus,
    focus_note: typeof r.focus_note === 'string' ? r.focus_note : '',
    skills: rawSkills.map((s: any) => String(s ?? '')).filter(Boolean),
    duration: typeof r.duration === 'string' ? r.duration : '',
    plan,
    plan_history: planHistory,
    components,
    notes: typeof r.notes === 'string' ? r.notes : '',
  };

  if (Array.isArray(r.chat)) {
    const validChat: ChatMessage[] = r.chat
      .filter(
        (m: any) =>
          m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
      .map((m: any) => ({ role: m.role, content: m.content }));
    migrated.chat = validChat;
  }

  if (typeof r.cooldown_until === 'number' && Number.isFinite(r.cooldown_until) && r.cooldown_until > 0) {
    migrated.cooldown_until = r.cooldown_until;
  }
  if (typeof r.cooldown_bypass_reason === 'string' && r.cooldown_bypass_reason.trim()) {
    migrated.cooldown_bypass_reason = r.cooldown_bypass_reason.trim();
  }

  return migrated;
}

export interface LocalMigrationResult {
  migrated: boolean;
  ideasCount: number;
  hasBackup: boolean;
}

export async function migrateFromLocalStorage(
  ideaStore: Store<Idea>,
  metaStore: MigrationCapableStore,
  storage: Storage | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined
): Promise<LocalMigrationResult> {
  if (await metaStore.isLocalStorageMigrated()) {
    return { migrated: false, ideasCount: 0, hasBackup: false };
  }

  if (!storage) {
    return { migrated: false, ideasCount: 0, hasBackup: false };
  }

  const raw = storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) {
    await metaStore.markLocalStorageMigrated();
    return { migrated: false, ideasCount: 0, hasBackup: false };
  }

  let parsed: { ideas?: unknown[]; settings?: Partial<Settings> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { migrated: false, ideasCount: 0, hasBackup: false };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { migrated: false, ideasCount: 0, hasBackup: false };
  }

  storage.setItem(LEGACY_BACKUP_KEY, raw);

  const rawIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
  let ideasCount = 0;
  for (const item of rawIdeas) {
    const idea = migrate(item);
    await ideaStore.put(idea);
    ideasCount += 1;
  }

  if (parsed.settings && typeof parsed.settings === 'object') {
    await metaStore.saveSettings(mergeSettings(parsed.settings));
  }

  await metaStore.markLocalStorageMigrated();
  return { migrated: true, ideasCount, hasBackup: true };
}
