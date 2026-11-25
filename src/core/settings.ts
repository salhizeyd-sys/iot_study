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

export const CURRENT_SETTINGS_VERSION = 5;

export const DEFAULT_FEATURES: FeatureFlags = {
  vault: true,
  'iot.prototype': true,
  'iot.dashboard': true,
  'iot.telemetry': true,
  'iot.flash': true,
  'iot.ota': true,
  focus: true,
};

export const DEFAULTS: Settings = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
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
  const isLegacySettings = !partial || (partial.settingsVersion ?? 1) < CURRENT_SETTINGS_VERSION;
  const mergedFeatures: FeatureFlags = {
    ...DEFAULT_FEATURES,
    ...(partial?.features || {}),
  };

  // Auto-enable released M1/M2/M3/M4 modules for users upgrading from older settings
  if (isLegacySettings) {
    mergedFeatures.vault = true;
    mergedFeatures['iot.prototype'] = true;
    mergedFeatures['iot.dashboard'] = true;
    mergedFeatures['iot.telemetry'] = true;
    mergedFeatures['iot.flash'] = true;
    mergedFeatures['iot.ota'] = true;
    mergedFeatures.focus = true;
  }

  return {
    ...DEFAULTS,
    ...(partial || {}),
    settingsVersion: CURRENT_SETTINGS_VERSION,
    speechLang: partial?.speechLang || DEFAULTS.speechLang,
    contextBudget:
      typeof partial?.contextBudget === 'number' && partial.contextBudget >= 200
        ? partial.contextBudget
        : DEFAULTS.contextBudget,
    features: mergedFeatures,
  };
}

export function isFeatureEnabled(settings: Settings, flag: FeatureFlagKey): boolean {
  return Boolean(settings.features?.[flag]);
}
