import { AppState, Idea, mergeSettings } from '../core';
import { IndexedDBStore } from './idb';
import { CURRENT_SCHEMA_VERSION, migrate, migrateFromLocalStorage } from './migrate';

export type { Store, SettingsStore, MigrationCapableStore } from './types';
export { IndexedDBStore } from './idb';
export {
  CURRENT_SCHEMA_VERSION,
  LEGACY_STORAGE_KEY,
  LEGACY_BACKUP_KEY,
  migrate,
  migrateFromLocalStorage,
  statusToLifecycle,
} from './migrate';

export const store = new IndexedDBStore();

export const S: AppState = {
  ideas: [],
  settings: mergeSettings(),
};

let writeQueue: Promise<void> = Promise.resolve();

export async function initStore(): Promise<void> {
  await migrateFromLocalStorage(store, store);
  const [ideas, settings] = await Promise.all([store.list(), store.getSettings()]);
  S.ideas = ideas;
  S.settings = mergeSettings(settings);
}

async function flushState(): Promise<void> {
  const existing = await store.list();
  const currentIds = new Set(S.ideas.map((i) => i.id));

  for (const old of existing) {
    if (!currentIds.has(old.id)) {
      await store.remove(old.id);
    }
  }

  for (let idx = 0; idx < S.ideas.length; idx++) {
    const item = S.ideas[idx];
    const normalized: Idea =
      item.schemaVersion === CURRENT_SCHEMA_VERSION ? item : migrate(item);
    S.ideas[idx] = normalized;
    await store.put(normalized);
  }

  await store.saveSettings(S.settings);
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
