import { IdeaType, IdeaStatus, IdeaFocus, Settings } from './types';

export const TYPES: Record<IdeaType, string> = {
  software: 'برمجي',
  hardware: 'عتادي',
  both: 'برمجي + عتادي',
};

export const STATUS: Record<IdeaStatus, string> = {
  idea: 'فكرة',
  planned: 'مخطط',
  doing: 'قيد التنفيذ',
  paused: 'متوقف',
  done: 'مكتمل',
  dropped: 'مهمل',
};

export const FOCUS: Record<IdeaFocus, [string, string]> = {
  aligned: ['ضمن تخصصي', 'ok'],
  partial: ['يحتاج تعلماً جانبياً', 'wn'],
  distraction: ['تشتيت', 'er'],
};

export const DEFAULTS: Settings = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  base: 'https://api.openai.com/v1',
  key: '',
  goals: 'تصميم الدوائر الإلكترونية، برمجة المتحكمات (MCU)، الذكاء الاصطناعي على الحافة (Edge AI)',
  maxDoing: 2,
};

export const MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
};
