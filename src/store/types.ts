import { Idea, Settings } from '../core';

export interface Store<T extends { id: string } = Idea> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SettingsStore {
  getSettings(): Promise<Settings | undefined>;
  saveSettings(settings: Settings): Promise<void>;
}

export interface MigrationCapableStore extends SettingsStore {
  isLocalStorageMigrated(): Promise<boolean>;
  markLocalStorageMigrated(): Promise<void>;
}
