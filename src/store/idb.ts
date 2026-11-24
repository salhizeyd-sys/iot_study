import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Idea, Settings } from '../types';
import { CURRENT_SCHEMA_VERSION, migrate } from './migrate';
import { MigrationCapableStore, Store } from './types';

interface IdeaVaultDB extends DBSchema {
  ideas: {
    key: string;
    value: Idea;
  };
  meta: {
    key: string;
    value: unknown;
  };
}

const IDEAS_STORE = 'ideas';
const META_STORE = 'meta';
const SETTINGS_KEY = 'settings';
const MIGRATED_KEY = 'localStorageMigrated';

export class IndexedDBStore implements Store<Idea>, MigrationCapableStore {
  private dbPromise: Promise<IDBPDatabase<IdeaVaultDB>> | null = null;

  constructor(private readonly dbName: string = 'ideavault') {}

  private getDB(): Promise<IDBPDatabase<IdeaVaultDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<IdeaVaultDB>(this.dbName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(IDEAS_STORE)) {
            db.createObjectStore(IDEAS_STORE, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE);
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
