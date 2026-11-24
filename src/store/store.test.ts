import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  IndexedDBStore,
  LEGACY_BACKUP_KEY,
  LEGACY_STORAGE_KEY,
  S,
  initStore,
  migrate,
  migrateFromLocalStorage,
  save,
  store as defaultStore,
} from './index';
import { Idea } from '../types';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

let dbCounter = 0;

describe('IndexedDBStore & migration', () => {
  let store: IndexedDBStore;

  beforeEach(() => {
    dbCounter += 1;
    store = new IndexedDBStore(`ideavault-test-${dbCounter}`);
  });

  afterEach(async () => {
    await store.close();
  });

  it('performs full CRUD operations and orders list by created desc', async () => {
    const older: Idea = {
      id: 'idea-1',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      created: 1000,
      name: 'مراقب حرارة',
      domain: 'IoT',
      type: 'hardware',
      status: 'idea',
      problem: 'ارتفاع الحرارة',
      solution: 'حساس DHT22',
      focus: 'aligned',
      focus_note: 'ضمن التخصص',
      skills: ['ESP32'],
      duration: 'أسبوع',
      plan: [{ step: 'توصيل الحساس', detail: 'GPIO4', done: false }],
      components: [{ name: 'ESP32', qty: 1, note: 'DevKit' }],
      notes: '',
    };

    const newer: Idea = {
      ...older,
      id: 'idea-2',
      created: 2000,
      name: 'لوحة تحكم',
      type: 'both',
    };

    await store.put(older);
    await store.put(newer);

    const listed = await store.list();
    expect(listed.map((i) => i.id)).toEqual(['idea-2', 'idea-1']);

    const fetched = await store.get('idea-1');
    expect(fetched?.name).toBe('مراقب حرارة');

    await store.put({ ...older, name: 'مراقب حرارة محدّث', status: 'doing' });
    const updated = await store.get('idea-1');
    expect(updated?.name).toBe('مراقب حرارة محدّث');
    expect(updated?.status).toBe('doing');

    await store.remove('idea-1');
    expect(await store.get('idea-1')).toBeUndefined();
    expect((await store.list()).map((i) => i.id)).toEqual(['idea-2']);
  });

  it('migrates legacy idea objects missing schemaVersion and new fields', () => {
    const legacyRaw = {
      id: 'legacy-1',
      name: 'فكرة قديمة',
      domain: 'أنظمة مدمجة',
      type: 'invalid-type',
      status: 'unknown-status',
      focus: 'unknown-focus',
      skills_needed: ['C++', 'FreeRTOS'],
      plan: [{ step: 'خطوة 1', detail: 'تفصيل' }],
      chat: [{ role: 'user', content: 'مرحباً' }],
    };

    const migrated = migrate(legacyRaw);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.id).toBe('legacy-1');
    expect(migrated.type).toBe('software');
    expect(migrated.status).toBe('idea');
    expect(migrated.focus).toBe('partial');
    expect(migrated.skills).toEqual(['C++', 'FreeRTOS']);
    expect(migrated.plan).toEqual([{ step: 'خطوة 1', detail: 'تفصيل', done: false }]);
    expect(migrated.components).toEqual([]);
    expect(migrated.notes).toBe('');
    expect(migrated.chat).toEqual([{ role: 'user', content: 'مرحباً' }]);
    expect(typeof migrated.created).toBe('number');
  });

  it('upgrades unversioned records stored in IndexedDB on read', async () => {
    const legacyRecord = {
      id: 'unversioned-1',
      created: 500,
      name: 'سجل قديم',
      domain: 'IoT',
      type: 'hardware',
      status: 'planned',
      problem: 'مشكلة',
      solution: 'حل',
      focus: 'aligned',
      focus_note: '',
      skills_needed: ['UART'],
      duration: 'يومين',
      plan: [],
      components: [],
    } as unknown as Idea;

    await store.put(legacyRecord);
    const items = await store.list();
    expect(items).toHaveLength(1);
    expect(items[0].schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(items[0].skills).toEqual(['UART']);
    expect(items[0].notes).toBe('');
  });

  it('migrates once from localStorage, preserves backup, and survives clearing localStorage', async () => {
    const legacyPayload = JSON.stringify({
      ideas: [
        {
          id: 'ls-1',
          created: 1500,
          name: 'عقدة استشعار',
          domain: 'IoT',
          type: 'hardware',
          status: 'doing',
          problem: 'قياس الرطوبة',
          solution: 'ESP32 + DHT22',
          focus: 'aligned',
          focus_note: 'مناسب',
          skills: ['ESP32'],
          duration: 'أسبوع',
          plan: [{ step: 'تجميع', detail: 'لوحة تجارب', done: true }],
          components: [{ name: 'DHT22', qty: 1 }],
          notes: 'ملاحظة قديمة',
        },
      ],
      settings: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxDoing: 3,
      },
    });

    const storage = createMemoryStorage({
      [LEGACY_STORAGE_KEY]: legacyPayload,
    });

    const firstRun = await migrateFromLocalStorage(store, store, storage);
    expect(firstRun).toEqual({ migrated: true, ideasCount: 1, hasBackup: true });
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(legacyPayload);
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe(legacyPayload);

    const migratedIdeas = await store.list();
    expect(migratedIdeas).toHaveLength(1);
    expect(migratedIdeas[0].schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migratedIdeas[0].name).toBe('عقدة استشعار');

    const migratedSettings = await store.getSettings();
    expect(migratedSettings?.provider).toBe('openai');
    expect(migratedSettings?.maxDoing).toBe(3);

    // Modify IndexedDB after migration and ensure re-running does not overwrite
    await store.put({ ...migratedIdeas[0], name: 'عقدة استشعار محدّثة' });
    const secondRun = await migrateFromLocalStorage(store, store, storage);
    expect(secondRun.migrated).toBe(false);
    expect((await store.get('ls-1'))?.name).toBe('عقدة استشعار محدّثة');

    // Clear localStorage completely; IndexedDB data remains intact
    storage.clear();
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    const thirdRun = await migrateFromLocalStorage(store, store, storage);
    expect(thirdRun.migrated).toBe(false);
    expect((await store.list()).map((i) => i.name)).toEqual(['عقدة استشعار محدّثة']);
    expect((await store.getSettings())?.provider).toBe('openai');
  });

  it('does not mark migrated when localStorage contains malformed JSON', async () => {
    const storage = createMemoryStorage({
      [LEGACY_STORAGE_KEY]: '{invalid-json',
    });

    const res = await migrateFromLocalStorage(store, store, storage);
    expect(res.migrated).toBe(false);
    expect(await store.isLocalStorageMigrated()).toBe(false);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe('{invalid-json');
  });

  it('persists app state across initStore reloads and after clearing localStorage', async () => {
    const mockStorage = createMemoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify({
        ideas: [
          {
            id: 'reload-1',
            created: 3000,
            name: 'فكرة مستمرة',
            domain: 'IoT',
            type: 'both',
            status: 'idea',
          },
        ],
        settings: { goals: 'أنظمة مدمجة و Edge AI' },
      }),
    });
    (globalThis as any).localStorage = mockStorage;

    await initStore();
    expect(S.ideas.map((i) => i.id)).toEqual(['reload-1']);
    expect(S.settings.goals).toBe('أنظمة مدمجة و Edge AI');

    S.ideas[0].notes = 'ملاحظة محفوظة';
    await save();

    // Simulate clearing localStorage and reloading the app
    mockStorage.clear();
    S.ideas = [];
    S.settings.goals = '';

    await initStore();
    expect(S.ideas).toHaveLength(1);
    expect(S.ideas[0].notes).toBe('ملاحظة محفوظة');
    expect(S.ideas[0].schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(S.settings.goals).toBe('أنظمة مدمجة و Edge AI');

    await defaultStore.close();
  });
});
