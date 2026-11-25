import { SupabaseClient } from '@supabase/supabase-js';
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
  PrototypeRecord,
  PrototypeV1,
} from '../core';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrate';
import { Store } from './types';

export interface IdeaRow {
  id: string;
  user_id: string;
  schema_version: number;
  name: string;
  domain: string;
  type: IdeaType;
  status: IdeaStatus;
  lifecycle: IdeaLifecycle;
  memory: string;
  problem: string;
  solution: string;
  focus: IdeaFocus;
  focus_note: string;
  duration: string;
  notes: string;
  skills: string[];
  plan: PlanStep[];
  components: HardwareComponent[];
  chat: ChatMessage[];
  plan_history: PlanHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface PrototypeRow {
  id: string;
  user_id: string;
  idea_id: string;
  revision: number;
  schema_version: number;
  data: PrototypeV1;
  change_summary: string;
  created_at: string;
}

export function ideaToRow(idea: Idea, userId: string): IdeaRow {
  const m = idea.schemaVersion === CURRENT_SCHEMA_VERSION ? idea : migrate(idea);
  const createdMs = m.created || Date.now();
  const updatedMs = m.updatedAt || createdMs;

  return {
    id: m.id,
    user_id: userId,
    schema_version: m.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    name: m.name,
    domain: m.domain,
    type: m.type,
    status: m.status,
    lifecycle: m.lifecycle,
    memory: m.memory || '',
    problem: m.problem || '',
    solution: m.solution || '',
    focus: m.focus,
    focus_note: m.focus_note || '',
    duration: m.duration || '',
    notes: m.notes || '',
    skills: m.skills || [],
    plan: m.plan || [],
    components: m.components || [],
    chat: m.chat || [],
    plan_history: m.plan_history || [],
    created_at: new Date(createdMs).toISOString(),
    updated_at: new Date(updatedMs).toISOString(),
  };
}

export function rowToIdea(row: Partial<IdeaRow> & { id: string }): Idea {
  const created = row.created_at ? Date.parse(row.created_at) : Date.now();
  const updatedAt = row.updated_at ? Date.parse(row.updated_at) : created;

  return migrate({
    id: row.id,
    schemaVersion: row.schema_version ?? CURRENT_SCHEMA_VERSION,
    created: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : created,
    name: row.name,
    domain: row.domain,
    type: row.type,
    status: row.status,
    lifecycle: row.lifecycle,
    memory: row.memory,
    problem: row.problem,
    solution: row.solution,
    focus: row.focus,
    focus_note: row.focus_note,
    duration: row.duration,
    notes: row.notes,
    skills: row.skills,
    plan: row.plan,
    components: row.components,
    chat: row.chat,
    plan_history: row.plan_history,
  });
}

export function prototypeToRow(
  record: PrototypeRecord,
  userId: string
): PrototypeRow {
  return {
    id: record.id,
    user_id: userId,
    idea_id: record.idea_id,
    revision: record.revision,
    schema_version: record.schema_version,
    data: record.data,
    change_summary: record.change_summary || '',
    created_at: new Date(record.created_at || Date.now()).toISOString(),
  };
}

export function rowToPrototype(row: PrototypeRow): PrototypeRecord {
  const createdAt = row.created_at ? Date.parse(row.created_at) : Date.now();
  return {
    id: row.id,
    idea_id: row.idea_id,
    revision: row.revision,
    schema_version: 1,
    data: row.data,
    created_at: Number.isFinite(createdAt) ? createdAt : Date.now(),
    change_summary: row.change_summary || undefined,
  };
}

/**
 * Conflict resolution rule (SUPABASE.md):
 * - Newest `updatedAt` wins scalar fields.
 * - `plan` merges `done` flags across devices by matching normalized `step` text
 *   so concurrent step completions on phone and desktop are never silently lost.
 */
export function mergeIdeaConflict(local: Idea, remote: Idea): Idea {
  const localTime = local.updatedAt ?? local.created ?? 0;
  const remoteTime = remote.updatedAt ?? remote.created ?? 0;
  const winner = remoteTime >= localTime ? remote : local;
  const other = winner === remote ? local : remote;

  const otherDoneByStep = new Map<string, boolean>();
  for (const s of other.plan || []) {
    const key = s.step.trim().toLowerCase();
    if (key) {
      otherDoneByStep.set(key, Boolean(otherDoneByStep.get(key) || s.done));
    }
  }

  const mergedPlan: PlanStep[] = (winner.plan || []).map((s) => {
    const key = s.step.trim().toLowerCase();
    const otherDone = key ? otherDoneByStep.get(key) : false;
    return {
      ...s,
      done: Boolean(s.done || otherDone),
    };
  });

  return {
    ...winner,
    plan: mergedPlan,
    updatedAt: Math.max(localTime, remoteTime),
  };
}

export interface RemoteSyncStore extends Store<Idea> {
  listAllPrototypes(): Promise<PrototypeRecord[]>;
  upsertPrototype(record: PrototypeRecord): Promise<void>;
}

export class SupabaseStore implements RemoteSyncStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly getUserId: () => string | null
  ) {}

  private requireUserId(): string {
    const uid = this.getUserId();
    if (!uid) throw new Error('المستخدم غير مسجل الدخول');
    return uid;
  }

  async list(): Promise<Idea[]> {
    this.requireUserId();
    const { data, error } = await this.client
      .from('ideas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((r) => rowToIdea(r as IdeaRow));
  }

  async get(id: string): Promise<Idea | undefined> {
    this.requireUserId();
    const { data, error } = await this.client
      .from('ideas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToIdea(data as IdeaRow) : undefined;
  }

  async put(item: Idea): Promise<void> {
    const uid = this.requireUserId();
    const row = ideaToRow(item, uid);
    const { error } = await this.client.from('ideas').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    this.requireUserId();
    const { error } = await this.client.from('ideas').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async listAllPrototypes(): Promise<PrototypeRecord[]> {
    this.requireUserId();
    const { data, error } = await this.client
      .from('idea_prototypes')
      .select('*')
      .order('revision', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((r) => rowToPrototype(r as PrototypeRow));
  }

  async upsertPrototype(record: PrototypeRecord): Promise<void> {
    const uid = this.requireUserId();
    const row = prototypeToRow(record, uid);
    const { error } = await this.client
      .from('idea_prototypes')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
}
