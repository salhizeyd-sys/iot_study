import {
  FeatureFlagKey,
  FeatureFlags,
  IdeaFocus,
  IdeaLifecycle,
  IdeaStatus,
  IdeaType,
  Settings,
} from './types';

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

export const LIFECYCLE: Record<IdeaLifecycle, string> = {
  idea: 'فكرة',
  cooldown: 'فترة تبريد',
  planned: 'مخطط',
  prototype_generated: 'نموذج مولّد',
  reviewed: 'تمت المراجعة',
  ready_to_flash: 'جاهز للرفع',
  flashed: 'تم الرفع',
  online: 'متصل',
  done: 'مكتمل',
};

export const FOCUS: Record<IdeaFocus, [string, string]> = {
  aligned: ['ضمن تخصصي', 'ok'],
  partial: ['يحتاج تعلماً جانبياً', 'wn'],
  distraction: ['تشتيت', 'er'],
};

export const DEFAULT_FEATURES: FeatureFlags = {
  vault: true,
  'iot.prototype': true,
  'iot.dashboard': false,
  'iot.telemetry': false,
  'iot.flash': false,
  'iot.ota': false,
  focus: false,
};

export const DEFAULTS: Settings = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  base: 'https://api.openai.com/v1',
  key: '',
  goals: 'تصميم الدوائر الإلكترونية، برمجة المتحكمات (MCU)، الذكاء الاصطناعي على الحافة (Edge AI)',
  maxDoing: 2,
  speechLang: 'ar-SA',
  contextBudget: 1600,
  features: { ...DEFAULT_FEATURES },
};

export const MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
};

export function mergeSettings(partial?: Partial<Settings> | null): Settings {
  return {
    ...DEFAULTS,
    ...(partial || {}),
    speechLang: partial?.speechLang || DEFAULTS.speechLang,
    contextBudget:
      typeof partial?.contextBudget === 'number' && partial.contextBudget >= 200
        ? partial.contextBudget
        : DEFAULTS.contextBudget,
    features: {
      ...DEFAULT_FEATURES,
      ...(partial?.features || {}),
    },
  };
}

export function isFeatureEnabled(settings: Settings, flag: FeatureFlagKey): boolean {
  return Boolean(settings.features?.[flag]);
}
