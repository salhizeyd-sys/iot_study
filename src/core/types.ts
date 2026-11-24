export type IdeaType = 'software' | 'hardware' | 'both';

export type IdeaStatus = 'idea' | 'planned' | 'doing' | 'paused' | 'done' | 'dropped';

export type IdeaFocus = 'aligned' | 'partial' | 'distraction';

export type IdeaLifecycle =
  | 'idea'
  | 'cooldown'
  | 'planned'
  | 'prototype_generated'
  | 'reviewed'
  | 'ready_to_flash'
  | 'flashed'
  | 'online'
  | 'done';

export interface PlanStep {
  step: string;
  detail: string;
  done: boolean;
}

export interface HardwareComponent {
  name: string;
  qty: number;
  note?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Idea {
  id: string;
  schemaVersion?: number;
  created: number;
  name: string;
  domain: string;
  type: IdeaType;
  status: IdeaStatus;
  lifecycle: IdeaLifecycle;
  memory: string;
  problem: string;
  solution: string;
  focus: IdeaFocus;
  focus_note: string;
  skills: string[];
  duration: string;
  plan: PlanStep[];
  components: HardwareComponent[];
  notes: string;
  chat?: ChatMessage[];
}

export type FeatureFlagKey =
  | 'vault'
  | 'iot.prototype'
  | 'iot.dashboard'
  | 'iot.telemetry'
  | 'iot.flash'
  | 'iot.ota'
  | 'focus';

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export interface Settings {
  provider: 'gemini' | 'openai' | 'anthropic' | string;
  model: string;
  key: string;
  base: string;
  goals: string;
  maxDoing: number;
  speechLang: string;
  features: FeatureFlags;
}

export interface AppState {
  ideas: Idea[];
  settings: Settings;
}

export interface FilterState {
  q: string;
  type: string;
  domain: string;
}

export interface Route {
  path: string;
  title: string;
  render(): HTMLElement | void;
}

export interface IdeaTab {
  id: string;
  title: string;
  render(idea: Idea): HTMLElement;
}

export interface AppEventMap {
  'idea:created': { ideaId: string };
  'idea:updated': { ideaId: string };
  'idea:deleted': { ideaId: string };
  'idea:status-changed': {
    ideaId: string;
    status: IdeaStatus;
    lifecycle: IdeaLifecycle;
  };
  'prototype:generated': { ideaId: string; revision: number };
  'device:online': { deviceId: string; ideaId: string };
  'settings:changed': { settings: Settings };
}

export type AppEvent = {
  [K in keyof AppEventMap]: { type: K; payload: AppEventMap[K] };
}[keyof AppEventMap];

export interface AppModule {
  id: string;
  enabled(s: Settings): boolean;
  routes?: Route[];
  ideaTabs?: IdeaTab[];
  onEvent?(e: AppEvent): void;
}
