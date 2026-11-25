import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeSettings } from '../core';
import * as storeMod from '../store';
import {
  IdeaCardSchema,
  PlanRevisionSchema,
  callLLM,
  callLLMProxy,
  parseStructuredWithRetry,
} from './index';

describe('llm-proxy & zod schemas (S10)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('validates IdeaCardSchema & PlanRevisionSchema with one retry on malformed JSON', async () => {
    const validCardJson = JSON.stringify({
      name: 'جهاز قياس جودة الهواء',
      domain: 'IoT',
      type: 'both',
      problem: 'ارتفاع ثاني أكسيد الكربون',
      solution: 'ESP32 + MQ135',
      focus: 'aligned',
      focus_note: 'ضمن الأنظمة المدمجة',
      skills_needed: ['ESP32', 'ADC'],
      duration: 'أسبوع',
      plan: [{ step: 'معايرة الحساس', detail: 'قراءة ADC' }],
      components: [{ name: 'MQ135', qty: 1, note: 'Analog' }],
    });

    const retryCard = vi.fn(async () => `\`\`\`json\n${validCardJson}\n\`\`\``);
    const parsedCard = await parseStructuredWithRetry(
      IdeaCardSchema,
      'نعم هذه فكرة جيدة بلا JSON',
      retryCard
    );
    expect(retryCard).toHaveBeenCalledTimes(1);
    expect(parsedCard.name).toBe('جهاز قياس جودة الهواء');
    expect(parsedCard.plan).toHaveLength(1);

    const retryPlan = vi.fn(async () => '{"plan":[{"step":"الخطوة الجديدة","detail":"تفصيل"}]}');
    const parsedPlan = await parseStructuredWithRetry(
      PlanRevisionSchema,
      '{"plan":[]}',
      retryPlan
    );
    expect(retryPlan).toHaveBeenCalledTimes(1);
    expect(parsedPlan.plan[0].step).toBe('الخطوة الجديدة');
  });

  it('routes callLLM through llm-proxy with JWT and clears browser API keys', async () => {
    storeMod.S.settings = mergeSettings({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      key: 'legacy-secret-should-be-cleared',
    });

    vi.spyOn(storeMod, 'getSupabaseConfig').mockReturnValue({
      url: 'https://demo.supabase.co',
      anonKey: 'anon-public-key',
    });
    vi.spyOn(storeMod, 'getSupabaseClient').mockReturnValue({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'user-jwt-123' } },
        }),
      },
    } as any);
    vi.spyOn(storeMod, 'save').mockResolvedValue();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'رد آمن من البروكسي' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const reply = await callLLM([{ role: 'user', content: 'مرحباً' }], 'system prompt');
    expect(reply).toBe('رد آمن من البروكسي');
    expect(storeMod.S.settings.key).toBe('');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://demo.supabase.co/functions/v1/llm-proxy');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt-123');
    expect(String(init.body)).not.toContain('legacy-secret-should-be-cleared');
  });

  it('throws clear error when llm-proxy returns non-OK response', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'تم تجاوز حد الطلبات المؤقت' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      callLLMProxy(
        { url: 'https://demo.supabase.co', anonKey: 'anon', accessToken: 'jwt' },
        [{ role: 'user', content: 'اختبار' }],
        'sys',
        'gemini',
        'gemini-2.5-flash'
      )
    ).rejects.toThrow('تم تجاوز حد الطلبات المؤقت');
  });
});
