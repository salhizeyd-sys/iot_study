export type IdeaType = 'software' | 'hardware' | 'both';

export type IdeaStatus = 'idea' | 'planned' | 'doing' | 'paused' | 'done' | 'dropped';

export type IdeaFocus = 'aligned' | 'partial' | 'distraction';

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

export interface Settings {
  provider: 'gemini' | 'openai' | 'anthropic' | string;
  model: string;
  key: string;
  base: string;
  goals: string;
  maxDoing: number;
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
