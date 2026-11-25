// Supabase Edge Function: llm-proxy
// Verifies user JWT, applies per-user rate limiting, and calls the AI provider using server-side secrets.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ProxyRequest {
  messages: ChatMessage[];
  system: string;
  provider?: 'gemini' | 'openai' | 'anthropic' | string;
  model?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const MAX_BODY_BYTES = 64 * 1024;
const rateBuckets = new Map<string, number[]>();

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const recent = (rateBuckets.get(userId) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REQUESTS) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000));
    rateBuckets.set(userId, recent);
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  rateBuckets.set(userId, recent);
  return { allowed: true, retryAfterSec: 0 };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Supabase environment not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing Authorization bearer token' }, 401);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401);
  }

  const rate = checkRateLimit(userData.user.id);
  if (!rate.allowed) {
    return jsonResponse(
      { error: 'تم تجاوز حد الطلبات المؤقت، حاول بعد لحظات' },
      429,
      { 'Retry-After': String(rate.retryAfterSec) }
    );
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'حجم الطلب يتجاوز الحد المسموح (64KB)' }, 413);
  }

  let body: ProxyRequest;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload' }, 400);
  }

  if (!Array.isArray(body.messages) || typeof body.system !== 'string') {
    return jsonResponse({ error: 'messages and system are required' }, 400);
  }

  const messages = body.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-30);

  if (!messages.length) {
    return jsonResponse({ error: 'messages cannot be empty' }, 400);
  }

  const provider = body.provider || Deno.env.get('LLM_DEFAULT_PROVIDER') || 'gemini';

  if (provider === 'anthropic') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('LLM_API_KEY') || '';
    if (!apiKey) return jsonResponse({ error: 'ANTHROPIC_API_KEY is not configured' }, 500);

    const model = body.model || 'claude-sonnet-4-5';
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 4000, system: body.system, messages }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return jsonResponse({ error: data?.error?.message || 'Upstream Anthropic error' }, upstream.status);
    }
    return jsonResponse({ text: data?.content?.[0]?.text || '', provider, model });
  }

  if (provider === 'openai') {
    const apiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('LLM_API_KEY') || '';
    if (!apiKey) return jsonResponse({ error: 'OPENAI_API_KEY is not configured' }, 500);

    const baseUrl = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = body.model || 'gpt-4o-mini';
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: body.system }, ...messages],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return jsonResponse({ error: data?.error?.message || 'Upstream OpenAI error' }, upstream.status);
    }
    return jsonResponse({ text: data?.choices?.[0]?.message?.content || '', provider, model });
  }

  // Default: Gemini
  const geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('LLM_API_KEY') || '';
  if (!geminiKey) return jsonResponse({ error: 'GEMINI_API_KEY is not configured' }, 500);

  const model = body.model || 'gemini-2.5-flash';
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: body.system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      }),
    }
  );
  const data = await upstream.json();
  if (!upstream.ok) {
    return jsonResponse({ error: data?.error?.message || 'Upstream Gemini error' }, upstream.status);
  }
  return jsonResponse({
    text: data?.candidates?.[0]?.content?.parts?.[0]?.text || '',
    provider: 'gemini',
    model,
  });
});
