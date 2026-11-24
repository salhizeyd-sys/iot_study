import { AppEvent, AppEventMap } from './types';

type TypedListener<K extends keyof AppEventMap> = (payload: AppEventMap[K]) => void;
type AnyListener = (event: AppEvent) => void;

export class EventBus {
  private listeners = new Map<keyof AppEventMap, Set<TypedListener<any>>>();
  private anyListeners = new Set<AnyListener>();

  on<K extends keyof AppEventMap>(type: K, listener: TypedListener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  onAny(listener: AnyListener): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  emit<K extends keyof AppEventMap>(type: K, payload: AppEventMap[K]): void {
    const set = this.listeners.get(type);
    if (set) {
      for (const listener of set) {
        listener(payload);
      }
    }
    const event = { type, payload } as AppEvent;
    for (const listener of this.anyListeners) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
  }
}

export const bus = new EventBus();
