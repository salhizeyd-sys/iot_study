import { AppEvent, AppModule, Idea, IdeaTab, Route, Settings } from './types';
import { EventBus } from './events';

export class ModuleRegistry {
  private modules = new Map<string, AppModule>();

  register(mod: AppModule): void {
    this.modules.set(mod.id, mod);
  }

  unregister(id: string): void {
    this.modules.delete(id);
  }

  list(): AppModule[] {
    return Array.from(this.modules.values());
  }

  getEnabled(settings: Settings): AppModule[] {
    return this.list().filter((m) => m.enabled(settings));
  }

  getRoutes(settings: Settings): Route[] {
    return this.getEnabled(settings).flatMap((m) => m.routes || []);
  }

  getIdeaTabs(idea: Idea, settings: Settings): IdeaTab[] {
    void idea;
    return this.getEnabled(settings).flatMap((m) => m.ideaTabs || []);
  }

  dispatch(event: AppEvent, settings: Settings): void {
    for (const mod of this.getEnabled(settings)) {
      mod.onEvent?.(event);
    }
  }

  bindToBus(eventBus: EventBus, getSettings: () => Settings): () => void {
    return eventBus.onAny((event) => {
      this.dispatch(event, getSettings());
    });
  }

  clear(): void {
    this.modules.clear();
  }
}

export const registry = new ModuleRegistry();
