import { ChatMessage } from '../core';
import { S } from '../store';

export async function callLLM(messages: ChatMessage[], system: string): Promise<string> {
  const { provider: p, key, model, base } = S.settings;
  if (!key && !/localhost|127\.0\.0\.1/.test(base)) {
    throw new Error('أضف مفتاح API من الإعدادات ⚙️');
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

  // Default: OpenAI or OpenAI-compatible (Groq, Ollama, OpenRouter, etc.)
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
