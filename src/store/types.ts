import { Idea, PrototypeRecord, PrototypeV1, Settings } from '../core';

export interface Store<T extends { id: string } = Idea> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PrototypeStore {
  listPrototypes(ideaId: string): Promise<PrototypeRecord[]>;
  getLatestPrototype(ideaId: string): Promise<PrototypeRecord | undefined>;
  savePrototypeRevision(
    ideaId: string,
    data: PrototypeV1,
    changeSummary?: string
  ): Promise<PrototypeRecord>;
}

export interface SettingsStore {
  getSettings(): Promise<Settings | undefined>;
  saveSettings(settings: Settings): Promise<void>;
}

export interface MigrationCapableStore extends SettingsStore {
  isLocalStorageMigrated(): Promise<boolean>;
  markLocalStorageMigrated(): Promise<void>;
}
