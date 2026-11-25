import { AppState, Idea, PrototypeRecord, PrototypeV1, bus, mergeSettings } from '../core';
import { IndexedDBStore } from './idb';
import { CURRENT_SCHEMA_VERSION, CURRENT_SETTINGS_VERSION, migrate, migrateFromLocalStorage, migrateSettings } from './migrate';
import { getCurrentSupabaseUser, getSupabaseClient } from './supabaseClient';
import { createDefaultSyncManager } from './sync';

export type { Store, SettingsStore, MigrationCapableStore, PrototypeStore } from './types';
export { IndexedDBStore } from './idb';
export {
  CURRENT_SCHEMA_VERSION,
  CURRENT_SETTINGS_VERSION,
  LEGACY_STORAGE_KEY,
  LEGACY_BACKUP_KEY,
  migrate,
  migrateSettings,
  migrateFromLocalStorage,
  statusToLifecycle,
} from './migrate';
export {
  getSupabaseConfig,
  isSupabaseConfigured,
  getSupabaseClient,
  signInWithMagicLink,
  signOutSupabase,
  getCurrentSupabaseUser,
} from './supabaseClient';
export {
  SupabaseStore,
  ideaToRow,
  rowToIdea,
  prototypeToRow,
  rowToPrototype,
  mergeIdeaConflict,
  type IdeaRow,
  type PrototypeRow,
  type RemoteSyncStore,
} from './supabase';
export { SyncManager, type SyncStateSnapshot } from './sync';

export const store = new IndexedDBStore();

export const S: AppState = {
  ideas: [],
  settings: mergeSettings(),
};

export const syncManager = createDefaultSyncManager(
  store,
  (freshIdeas) => {
    S.ideas = freshIdeas;
    bus.emit('idea:updated', { ideaId: freshIdeas[0]?.id || '' });
  },
  (ideaId, revision) => {
    bus.emit('prototype:generated', { ideaId, revision });
  }
);

let writeQueue: Promise<void> = Promise.resolve();
let onlineListenersBound = false;

export async function initStore(): Promise<void> {
  await migrateFromLocalStorage(store, store);
  const [ideas, rawSettings] = await Promise.all([store.list(), store.getSettings()]);
  S.ideas = ideas;
  const migratedSettings = migrateSettings(rawSettings);
  S.settings = migratedSettings;
  if (!rawSettings || (rawSettings.settingsVersion ?? 1) < CURRENT_SETTINGS_VERSION) {
    await store.saveSettings(migratedSettings);
  }

  const client = getSupabaseClient();
  if (client) {
    const user = await getCurrentSupabaseUser().catch(() => null);
    if (user && S.settings.key) {
      S.settings.key = '';
      await store.saveSettings(S.settings);
    }
    await syncManager.setUser(user ? { id: user.id, email: user.email } : null);

    if (!onlineListenersBound && typeof window !== 'undefined') {
      onlineListenersBound = true;
      client.auth.onAuthStateChange((_event, session) => {
        const u = session?.user;
        if (u && S.settings.key) {
          S.settings.key = '';
          void store.saveSettings(S.settings);
        }
        void syncManager.setUser(u ? { id: u.id, email: u.email } : null);
      });
      window.addEventListener('online', () => {
        void syncManager.refreshStatusFromOutbox().then(() => syncManager.flushOutbox());
      });
      window.addEventListener('offline', () => {
        void syncManager.refreshStatusFromOutbox();
      });
    }
  } else {
    await syncManager.refreshStatusFromOutbox();
  }
}

function ideaSignature(idea: Idea): string {
  return JSON.stringify({
    name: idea.name,
    domain: idea.domain,
    type: idea.type,
    status: idea.status,
    lifecycle: idea.lifecycle,
    memory: idea.memory,
    problem: idea.problem,
    solution: idea.solution,
    focus: idea.focus,
    focus_note: idea.focus_note,
    skills: idea.skills,
    duration: idea.duration,
    plan: idea.plan,
    plan_history: idea.plan_history,
    components: idea.components,
    notes: idea.notes,
    chat: idea.chat,
  });
}

async function flushState(): Promise<void> {
  const existing = await store.list();
  const existingMap = new Map(existing.map((i) => [i.id, i]));
  const currentIds = new Set(S.ideas.map((i) => i.id));

  for (const old of existing) {
    if (!currentIds.has(old.id)) {
      await store.remove(old.id);
      await syncManager.enqueueIdeaDelete(old.id);
    }
  }

  for (let idx = 0; idx < S.ideas.length; idx++) {
    const item = S.ideas[idx];
    const normalized: Idea =
      item.schemaVersion === CURRENT_SCHEMA_VERSION ? item : migrate(item);
    const prev = existingMap.get(normalized.id);
    const changed = !prev || ideaSignature(prev) !== ideaSignature(normalized);

    if (changed) {
      normalized.updatedAt = Date.now();
      S.ideas[idx] = normalized;
      await store.put(normalized);
      await syncManager.enqueueIdeaUpsert(normalized);
    } else if (prev.schemaVersion !== item.schemaVersion) {
      S.ideas[idx] = normalized;
      await store.put(normalized);
    }
  }

  await store.saveSettings(S.settings);
}

export async function savePrototypeRevisionSynced(
  ideaId: string,
  data: PrototypeV1,
  changeSummary?: string
): Promise<PrototypeRecord> {
  const record = await store.savePrototypeRevision(ideaId, data, changeSummary);
  await syncManager.enqueuePrototypeUpsert(record);
  return record;
}

export const save = (onFail?: (msg: string) => void): Promise<void> => {
  writeQueue = writeQueue
    .then(() => flushState())
    .catch(() => {
      if (onFail) {
        onFail('تعذّر الحفظ في المتصفح');
      }
    });
  return writeQueue;
};
