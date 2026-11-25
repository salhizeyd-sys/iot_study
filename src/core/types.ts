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

export interface PlanHistoryEntry {
  savedAt: number;
  plan: PlanStep[];
}

export type WidgetType =
  | 'gauge'
  | 'line_chart'
  | 'status_badge'
  | 'toggle_switch'
  | 'slider';

export interface Widget {
  type: WidgetType;
  key: string;
  label: string;
  min?: number;
  max?: number;
  unit?: string;
}

export interface WiringItem {
  part: string;
  part_pin: string;
  mcu_pin: string;
  note?: string;
}

export interface FirmwareFile {
  name: string;
  content: string;
}

export interface PrototypeV1 {
  schema_version: 1;
  board: { fqbn: string; ota: boolean };
  wiring: WiringItem[];
  firmware: { files: FirmwareFile[]; libraries: string[] };
  dashboard: Widget[];
  simulation: {
    interval_ms: number;
    frames: Record<string, number | boolean | string>[];
  };
  warnings: string[];
}

export interface PrototypeRecord {
  id: string;
  idea_id: string;
  revision: number;
  schema_version: 1;
  data: PrototypeV1;
  created_at: number;
  change_summary?: string;
}

export interface PrototypeContextSummary {
  revision: number;
  boardFqbn: string;
  wiringCount: number;
  wiringPreview?: string[];
  dashboardKeys: string[];
}

export interface DeviceContextSummary {
  lastSeenAt?: number;
  lastTelemetryKeys?: string[];
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
  updatedAt?: number;
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
  plan_history?: PlanHistoryEntry[];
  components: HardwareComponent[];
  notes: string;
  chat?: ChatMessage[];
  cooldown_until?: number;
  cooldown_bypass_reason?: string;
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
  contextBudget: number;
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

export type SyncStatus =
  | 'local_only'
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'offline'
  | 'error';

export interface OutboxEntry {
  id: string;
  table: 'ideas' | 'idea_prototypes';
  op: 'upsert' | 'delete';
  recordId: string;
  payload?: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface AppModule {
  id: string;
  enabled(s: Settings): boolean;
  routes?: Route[];
  ideaTabs?: IdeaTab[];
  onEvent?(e: AppEvent): void;
}
