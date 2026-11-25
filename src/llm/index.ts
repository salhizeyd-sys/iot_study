import { ChatMessage, Idea } from '../core';
import {
  S,
  getSupabaseClient,
  getSupabaseConfig,
  save,
} from '../store';
import { sysMemorySummary } from '../prompts';

export {
  buildProjectContext,
  estimateTokens,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  type ProjectContextOptions,
} from './context';
export {
  IdeaCardSchema,
  PlanRevisionSchema,
  extractJsonFromText,
  parseWithSchema,
  parseStructuredWithRetry,
  type IdeaCardOutput,
  type PlanRevisionOutput,
} from './schemas';

export interface ProxyAuthContext {
  url: string;
  anonKey: string;
  accessToken: string;
}

export async function getActiveProxyAuth(): Promise<ProxyAuthContext | null> {
  const cfg = getSupabaseConfig();
  const client = getSupabaseClient();
  if (!cfg || !client) return null;

  const { data } = await client.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return null;

  return {
    url: cfg.url.replace(/\/$/, ''),
    anonKey: cfg.anonKey,
    accessToken,
  };
}

export async function clearBrowserApiKeyIfProxyActive(): Promise<boolean> {
  const proxy = await getActiveProxyAuth();
  if (!proxy) return false;
  if (S.settings.key) {
    S.settings.key = '';
    await save();
  }
  return true;
}

export async function callLLMProxy(
  proxy: ProxyAuthContext,
  messages: ChatMessage[],
  system: string,
  provider: string,
  model: string
): Promise<string> {
  const r = await fetch(`${proxy.url}/functions/v1/llm-proxy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: proxy.anonKey,
      Authorization: `Bearer ${proxy.accessToken}`,
    },
    body: JSON.stringify({
      provider,
      model,
      system,
      messages,
    }),
  });

  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(d.error || 'خطأ من خادم المساعد (llm-proxy)');
  }
  return String(d.text ?? '');
}

export async function callLLM(messages: ChatMessage[], system: string): Promise<string> {
  const { provider: p, key, model, base } = S.settings;

  const proxy = await getActiveProxyAuth();
  if (proxy) {
    if (S.settings.key) {
      S.settings.key = '';
      void save();
    }
    return callLLMProxy(proxy, messages, system, p, model);
  }

  if (!key && !/localhost|127\.0\.0\.1/.test(base)) {
    throw new Error('سجّل الدخول للمزامنة أو أضف مفتاح API من الإعدادات ⚙️');
  }

  let r: Response;
  let d: any;

  if (p === 'anthropic') {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 4000, system, messages }),
    });
    d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'خطأ من المزوّد');
    return d.content[0].text;
  }

  if (p === 'gemini') {
    r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        }),
      }
    );
    d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'خطأ من المزوّد');
    return d.candidates[0].content.parts[0].text;
  }

  r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: 'Bearer ' + key,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'خطأ من المزوّد');
  return d.choices[0].message.content;
}

export async function summarizeProjectMemory(
  idea: Idea,
  recentMessages: ChatMessage[]
): Promise<string> {
  if (!recentMessages.length) return idea.memory || '';
  const tail = recentMessages.slice(-12);
  const summary = await callLLM(
    [
      ...tail,
      {
        role: 'user',
        content: 'لخّص أهم القرارات والتغييرات للمشروع في نقاط مختصرة جداً.',
      },
    ],
    sysMemorySummary(idea.memory || '')
  );
  return summary.trim().slice(0, 1500);
}
