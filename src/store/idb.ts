import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Idea, PrototypeRecord, PrototypeV1, Settings } from '../core';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrate';
import { MigrationCapableStore, PrototypeStore, Store } from './types';

interface IdeaVaultDB extends DBSchema {
  ideas: {
    key: string;
    value: Idea;
  };
  meta: {
    key: string;
    value: unknown;
  };
  idea_prototypes: {
    key: string;
    value: PrototypeRecord;
    indexes: { by_idea: string };
  };
}

const IDEAS_STORE = 'ideas';
const META_STORE = 'meta';
const PROTOTYPES_STORE = 'idea_prototypes';
const SETTINGS_KEY = 'settings';
const MIGRATED_KEY = 'localStorageMigrated';

export class IndexedDBStore
  implements Store<Idea>, MigrationCapableStore, PrototypeStore
{
  private dbPromise: Promise<IDBPDatabase<IdeaVaultDB>> | null = null;

  constructor(private readonly dbName: string = 'ideavault') {}

  private getDB(): Promise<IDBPDatabase<IdeaVaultDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<IdeaVaultDB>(this.dbName, 2, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(IDEAS_STORE)) {
            db.createObjectStore(IDEAS_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE);
          }
          if (!db.objectStoreNames.contains(PROTOTYPES_STORE)) {
            const protoStore = db.createObjectStore(PROTOTYPES_STORE, { keyPath: 'id' });
            protoStore.createIndex('by_idea', 'idea_id');
          }
        },
      });
    }
    return this.dbPromise;
  }

  async list(): Promise<Idea[]> {
    const db = await this.getDB();
    const rawItems = await db.getAll(IDEAS_STORE);
    const results: Idea[] = [];
    for (const item of rawItems) {
      if (item.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        const upgraded = migrate(item);
        await db.put(IDEAS_STORE, upgraded);
        results.push(upgraded);
      } else {
        results.push(item);
      }
    }
    return results.sort((a, b) => (b.created || 0) - (a.created || 0));
  }

  async get(id: string): Promise<Idea | undefined> {
    const db = await this.getDB();
    const item = await db.get(IDEAS_STORE, id);
    if (!item) return undefined;
    if (item.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      const upgraded = migrate(item);
      await db.put(IDEAS_STORE, upgraded);
      return upgraded;
    }
    return item;
  }

  async put(item: Idea): Promise<void> {
    const db = await this.getDB();
    const migrated =
      item.schemaVersion === CURRENT_SCHEMA_VERSION ? item : migrate(item);
    await db.put(IDEAS_STORE, migrated);
  }

  async remove(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(IDEAS_STORE, id);
  }

  async listPrototypes(ideaId: string): Promise<PrototypeRecord[]> {
    const db = await this.getDB();
    const items = await db.getAllFromIndex(PROTOTYPES_STORE, 'by_idea', ideaId);
    return items.sort((a, b) => b.revision - a.revision);
  }

  async getLatestPrototype(ideaId: string): Promise<PrototypeRecord | undefined> {
    const list = await this.listPrototypes(ideaId);
    return list[0];
  }

  async savePrototypeRevision(
    ideaId: string,
    data: PrototypeV1,
    changeSummary?: string
  ): Promise<PrototypeRecord> {
    const db = await this.getDB();
    const existing = await this.listPrototypes(ideaId);
    const maxRev = existing.reduce((max, item) => Math.max(max, item.revision), 0);
    const record: PrototypeRecord = {
      id:
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `proto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      idea_id: ideaId,
      revision: maxRev + 1,
      schema_version: 1,
      data,
      created_at: Date.now(),
      change_summary: changeSummary,
    };
    await db.put(PROTOTYPES_STORE, record);
    return record;
  }

  async getSettings(): Promise<Settings | undefined> {
    const db = await this.getDB();
    const value = await db.get(META_STORE, SETTINGS_KEY);
    return value as Settings | undefined;
  }

  async saveSettings(settings: Settings): Promise<void> {
    const db = await this.getDB();
    await db.put(META_STORE, settings, SETTINGS_KEY);
  }

  async isLocalStorageMigrated(): Promise<boolean> {
    const db = await this.getDB();
    const flag = await db.get(META_STORE, MIGRATED_KEY);
    return flag === true;
  }

  async markLocalStorageMigrated(): Promise<void> {
    const db = await this.getDB();
    await db.put(META_STORE, true, MIGRATED_KEY);
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }
}
