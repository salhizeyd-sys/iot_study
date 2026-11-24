import { z } from 'zod';
import { PrototypeV1 } from '../../../core';

export const WidgetSchema = z.object({
  type: z.enum(['gauge', 'line_chart', 'status_badge', 'toggle_switch', 'slider']),
  key: z.string().min(1),
  label: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: z.string().optional(),
});

export const WiringItemSchema = z.object({
  part: z.string().min(1),
  part_pin: z.string().min(1),
  mcu_pin: z.string().min(1),
  note: z.string().optional(),
});

export const PrototypeV1Schema = z.object({
  schema_version: z.literal(1),
  board: z.object({
    fqbn: z
      .string()
      .min(1)
      .refine((v) => v.toLowerCase().includes('esp32'), {
        message: 'الإصدار الأول يدعم لوحات ESP32 فقط',
      }),
    ota: z.boolean(),
  }),
  wiring: z.array(WiringItemSchema),
  firmware: z.object({
    files: z
      .array(
        z.object({
          name: z.string().min(1),
          content: z.string().min(1),
        })
      )
      .min(1),
    libraries: z.array(z.string()),
  }),
  dashboard: z.array(WidgetSchema),
  simulation: z.object({
    interval_ms: z.number().int().positive(),
    frames: z.array(
      z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
    ),
  }),
  warnings: z.array(z.string()),
});

export function extractJsonFromText(raw: string): string | null {
  if (!raw) return null;

  // Prefer explicit ```json fenced block if present
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

export type PrototypeParseResult =
  | { ok: true; data: PrototypeV1 }
  | { ok: false; error: string };

export function parsePrototypeResponse(rawText: string): PrototypeParseResult {
  const jsonText = extractJsonFromText(rawText);
  if (!jsonText) {
    return { ok: false, error: 'لم يتم العثور على كائن JSON داخل استجابة المساعد.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    return { ok: false, error: `JSON غير صالح نحوياً: ${e?.message || 'parse error'}` };
  }

  const res = PrototypeV1Schema.safeParse(parsed);
  if (!res.success) {
    const details = res.error.issues
      .map((iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`)
      .join('؛ ');
    return { ok: false, error: `بنية النموذج الأولي غير مكتملة: ${details}` };
  }

  return { ok: true, data: res.data };
}
