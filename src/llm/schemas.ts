import { z } from 'zod';

export const PlanStepInputSchema = z.object({
  step: z.string().min(1),
  detail: z.string().default(''),
  done: z.boolean().optional(),
});

export const HardwareComponentInputSchema = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().int().positive().default(1),
  note: z.string().optional().default(''),
});

export const IdeaCardSchema = z.object({
  name: z.string().min(1),
  domain: z.string().default('عام'),
  type: z.enum(['software', 'hardware', 'both']).default('software'),
  problem: z.string().default(''),
  solution: z.string().default(''),
  focus: z.enum(['aligned', 'partial', 'distraction']).default('partial'),
  focus_note: z.string().default(''),
  skills_needed: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  duration: z.string().default(''),
  plan: z.array(PlanStepInputSchema).default([]),
  components: z.array(HardwareComponentInputSchema).default([]),
});

export type IdeaCardOutput = z.infer<typeof IdeaCardSchema>;

export const PlanRevisionSchema = z.object({
  plan: z.array(PlanStepInputSchema).min(1),
});

export type PlanRevisionOutput = z.infer<typeof PlanRevisionSchema>;

export function extractJsonFromText(raw: string): string | null {
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const source = fenced ? fenced[1] : raw;

  const start = source.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  rawText: string
): { ok: true; data: T } | { ok: false; error: string } {
  const jsonText = extractJsonFromText(rawText);
  if (!jsonText) {
    return { ok: false, error: 'لم يتم العثور على كائن JSON صالح.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    return { ok: false, error: `JSON غير صالح نحوياً: ${e?.message || 'parse error'}` };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues
      .map((iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`)
      .join('؛ ');
    return { ok: false, error: msg };
  }

  return { ok: true, data: result.data };
}

export async function parseStructuredWithRetry<T>(
  schema: z.ZodType<T>,
  initialRaw: string,
  retryFn: (errorFeedback: string) => Promise<string>
): Promise<T> {
  const first = parseWithSchema(schema, initialRaw);
  if (first.ok) return first.data;

  const retryRaw = await retryFn(first.error);
  const second = parseWithSchema(schema, retryRaw);
  if (second.ok) return second.data;

  throw new Error(`فشل التحقق من استجابة المساعد: ${second.error}`);
}
