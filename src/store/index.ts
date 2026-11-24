import { AppState } from '../types';
import { DEFAULTS } from '../config';

export const Store = {
  key: 'ideavault.v1',
  load(): Partial<AppState> {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },
  save(d: AppState, onFail?: (msg: string) => void) {
    try {
      localStorage.setItem(this.key, JSON.stringify(d));
    } catch {
      if (onFail) {
        onFail('تعذّر الحفظ في المتصفح');
      }
    }
  },
};

const loaded = Store.load();

export const S: AppState = {
  ideas: Array.isArray(loaded.ideas) ? loaded.ideas : [],
  settings: { ...DEFAULTS, ...(loaded.settings || {}) },
};

export const save = (onFail?: (msg: string) => void) => Store.save(S, onFail);
