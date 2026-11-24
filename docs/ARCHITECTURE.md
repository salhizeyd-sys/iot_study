# معمارية «خزانة الأفكار»: النسخة 2 (الحلقة الكاملة)

> ضع هذا الملف في `docs/ARCHITECTURE.md` ليحل محل النسخة السابقة. على المساعد البرمجي قراءته قبل أي مهمة، ولا يخالفه إلا بتسجيل قرار في `docs/DECISIONS.md`.

## 1) الرؤية

المنصة تحل ثلاث مشكلات لصاحبها:
1. **ضياع المشاريع والتشتت:** خزانة + تركيز + تبريد (الأساس، موجود).
2. **بطء الوصول إلى نموذج أولي يعمل:** الدورة اليدوية الحالية: AI للعتاد والكود ← AI آخر للوحة وSQL ← حساب Supabase ← نسخ المفاتيح ← نشر على Vercel ← رفع الكود. المنصة تلغيها كلها في مسار واحد.
3. **مساعد دائم يعرف كل تفاصيل المشروع:** يستأنف النقاش في أي وقت بسياق كامل (خطة، عتاد، كود، حالة الجهاز).

**المبدأ الحاكم:** الخزانة هي العمود الفقري، و«IoT Studio» وحدة رئيسية فوقها. كل ميزة تخدم هدفاً واحداً: **إكمال المشروع**.

## 2) ما الذي يتغير مقارنة بدورتك اليدوية؟ (وضع Managed)

| اليوم (يدوي) | في المنصة |
|---|---|
| Supabase مستقل لكل مشروع + نسخ مفاتيح | قاعدة بيانات واحدة للمنصة، وعزل بـ RLS، ولا مفاتيح تنسخها |
| لوحة تحكم تُنشر على Vercel لكل مشروع | **لوحة تُرسم داخل المنصة من JSON**، فلا نشر ولا استضافة |
| AI ثانٍ لكتابة SQL | لا SQL لكل مشروع: القراءات تُخزَّن في جدول عام بصيغة JSONB |
| كتابة الواي فاي والمفاتيح داخل الكود | تهيئة (provisioning) عند الرفع، بلا أسرار في الكود |

**وضع التصدير (Export Mode)، مؤجل:** يولّد SQL ولوحة مستقلة لمن يريد بنيته الخاصة (Supabase/Vercel). لا يُبنى قبل اكتمال Managed.

## 3) توزيع الأدوار: حاسوب وهاتف

الواجهة **تتكيف حسب القدرات (capabilities) لا حسب نوع الجهاز.**

```ts
// core/capabilities.ts
export const caps = {
  webSerial: 'serial' in navigator,                 // الرفع عبر USB
  speech: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
  touch: matchMedia('(pointer:coarse)').matches,
  standalone: matchMedia('(display-mode: standalone)').matches,
};
```

| الميزة | الهاتف (عقل مخطط + ريموت) | الحاسوب (طاولة العمل) |
|---|---|---|
| التقاط فكرة، النقاش، الإملاء الصوتي | ✅ | ✅ |
| توليد النموذج الأولي ومراجعته | ✅ | ✅ (مع محرر كود) |
| المحاكاة (بلا عتاد) | ✅ | ✅ |
| لوحة حية + إرسال أوامر | ✅ | ✅ |
| قائمة المشتريات وبطاقات التوصيل | ✅ | ✅ |
| الرفع الأول عبر USB + Serial Monitor | ❌ (غير مدعوم) | ✅ (`caps.webSerial`) |
| OTA (بعد الرفع الأول) | ✅ زر | ✅ زر |

**التسليم (Handoff):** إن جهز الهاتف نموذجاً أولياً ولا يدعم الرفع، تُحفظ حالته `ready_to_flash` فيظهر في الحاسوب عند الدخول بنفس الحساب: «جاهز للرفع».
**لا حاجة للجهازين:** من يملك حاسوباً فقط يستخدم كل شيء. ومن يملك هاتفاً فقط يصمم ويحاكي ويراقب.

## 4) قرارات المكدس

| القرار | السبب |
|---|---|
| **Vite + TypeScript (Vanilla)**، بلا Next.js | موجود ويعمل، والمنصة PWA ثابتة. Supabase هي الخلفية |
| **Supabase** (Auth, Postgres, Realtime, Edge Functions, Storage) | بلا خادم لإدارته |
| **IndexedDB أولاً** + outbox للمزامنة | يعمل دون إنترنت |
| **zod** لكل مخرجات الـ LLM | لا نثق بنص قادم من نموذج |
| **Monaco، esptool-js** بتحميل كسول | لا تثقل التطبيق |
| **ESP32 فقط في الإصدار الأول** | واي فاي + OTA + رفع بالمتصفح. Uno/Nano بلا واي فاي، وتُدعم لاحقاً |

## 5) بنية المجلدات

```
src/
  core/        types, settings, events (bus), modules (registry), capabilities
  store/       Store + IndexedDBStore + SupabaseStore + sync/outbox
  llm/         providers, llm-proxy client, schemas (zod), context.ts (سياق المشروع)
  prompts/     كل نصوص النظام
  export/      md / json / pdf / zip / prompt
  ui/          shell, router, مكونات مشتركة
  modules/
    vault/     الأفكار، التركيز، المهارات، BOM
    iot/
      prototype/   توليد، مخطط، فاحص الأرجل، نسخ (versions)
      dashboard/   رسم الـ widgets من JSON + المحاكي
      telemetry/   Realtime وحالة الجهاز (online/offline)
      flash/       تهيئة + Web Serial + Serial Monitor
      ota/         التحديث اللاسلكي
supabase/  migrations/  functions/ (llm-proxy, ingest-telemetry)
scripts/   compile-local/  (arduino-cli على جهازك)
docs/      ARCHITECTURE.md  DECISIONS.md
```

## 6) عقد الوحدات

```ts
interface AppModule {
  id: string;                                   // 'iot.prototype'
  enabled(s: Settings): boolean;                // feature flag
  routes?: Route[];
  ideaTabs?: { id: string; title: string; render(idea: Idea): HTMLElement }[];
  onEvent?(e: AppEvent): void;
}
```
1. الوحدة تستورد من `core/` و`store/` و`llm/` فقط، **ولا تستورد من وحدة أخرى**. التواصل عبر الأحداث (`idea:status-changed`, `prototype:generated`, `device:online`).
2. لا تعدّل جداول الأساس، بل تضيف جداولها المرتبطة بـ `idea_id`.
3. كل وحدة IoT خلف feature flag.
4. أي تغيير على `Idea` يتطلب `schemaVersion` وmigration.

## 6.1) دورة حياة فكرة العتاد

```
idea → cooldown → planned → prototype_generated → reviewed → ready_to_flash
     → flashed → online (أول قراءة حية) → done
```
لحظة النجاح هي **online**: أول قراءة حقيقية تظهر في اللوحة.

## 7) نموذج البيانات

`ideas` من `SUPABASE.md`، مع إضافة: `memory text default ''` (ملخص تراكمي للنقاش) و`lifecycle text`. **لا جدول باسم `projects`**.

**كل جدول يحمل `user_id` مباشرة** (لسياسات RLS وأداء Realtime).

| الجدول | أهم الأعمدة |
|---|---|
| `idea_prototypes` | `idea_id`, `revision int`, `schema_version`, `data jsonb`, `created_at` (نسخة جديدة عند كل تعديل) |
| `devices` | `id`, `idea_id`, `name`, `board`, `last_seen_at` |
| `device_tokens` | `device_id`, `token_hash` (sha256 فقط)، `revoked`, `last_used_at` |
| `iot_telemetry` | `device_id`, `payload jsonb`, `created_at` (احتفاظ 30 يوماً) |
| `iot_commands` | `device_id`, `action`, `value`, `executed_at` |
| `firmware_releases` | `idea_id`, `version`, `storage_path`, `sha256` |

## 8) الذكاء الاصطناعي

### 8.1) المساعد الواعي بالمشروع
كل نقاش داخل فكرة يبدأ بسياق تبنيه `llm/context.ts` ضمن ميزانية رموز محددة:
بطاقة الفكرة ← الخطوات المنجزة والمتبقية ← BOM ← ملخص آخر نموذج أولي (اللوحة، التوصيل، مفاتيح اللوحة، رقم revision) ← حالة الجهاز (آخر ظهور، آخر مفاتيح قراءات) ← `memory` ← ملاحظاتي.
بعد كل جلسة يُحدَّث `memory` بملخص قرارات وتغييرات (لا نسخ حرفي للمحادثة).

### 8.2) عقد النموذج الأولي (zod + إعادة محاولة واحدة)
```ts
type Widget = { type:'gauge'|'line_chart'|'status_badge'|'toggle_switch'|'slider';
                key:string; label:string; min?:number; max?:number; unit?:string };
interface PrototypeV1 {
  schema_version: 1;
  board: { fqbn: string; ota: boolean };            // v1: ESP32 فقط
  wiring: { part:string; part_pin:string; mcu_pin:string; note?:string }[];
  firmware: { files:{name:string; content:string}[]; libraries:string[] };
  dashboard: Widget[];
  simulation: { interval_ms:number; frames:Record<string, number|boolean|string>[] };
  warnings: string[];                               // افتراضات تحتاج مراجعة بشرية
}
```
قواعد:
- **لا رفع تلقائياً:** مراجعة بشرية تعرض `warnings` ونتيجة الفاحص.
- فاحص الأرجل (تكرار، أرجل الإقلاع، أرجل الإدخال فقط في ESP32) **كود TypeScript حتمي** وليس LLM.
- التعديل عبر النقاش ينتج `revision` جديداً ويحتفظ بالقديم، مع عرض الفروقات.

## 9) التهيئة والأمان (Provisioning)

- **لا أسرار داخل الكود المولّد.** الكود يقرأ إعداداته (واي فاي، رمز الجهاز، عنوان الخادم) من NVS/Preferences.
- التهيئة عند الرفع: بعد الحرق يرسل المتصفح سطر JSON عبر Web Serial ليحفظه الجهاز. والبديل للهاتف أو عند الفشل: بوابة تقييدية (captive portal، مثل WiFiManager). كلمة مرور الواي فاي **لا تُخزن في الخادم**.
- رمز الجهاز يُعرض **مرة واحدة** ويُخزن مجزّأ sha256 فقط.
- `ingest-telemetry` (Edge Function): يتحقق من الرمز، حد 4KB، حد معدل (حد أدنى 2 ثانية بين الطلبات)، ويقبل فقط المفاتيح الموجودة في `dashboard` الخاص بالفكرة. **الرد في رحلة واحدة:** `{ commands: [...], firmware: {version, url, sha256} | null }` فلا حاجة لاستعلامات منفصلة.
- مفتاح `service_role` داخل Edge Functions فقط، ومفاتيح الـ LLM أسرار في Supabase.
- ملفات OTA تُتحقق بـ sha256 قبل التثبيت.

## 10) حقائق تقنية

- Web Serial: Chrome/Edge للحاسوب فقط، لا iOS ولا Chrome أندرويد.
- **الرفع الأول يتم عبر USB دائماً**، وOTA يعمل بعدها فقط.
- الترجمة: محلياً أولاً (`arduino-cli` على جهازك عبر `scripts/compile-local`). خدمة الترجمة السحابية مؤجلة وتحتاج عزلاً كاملاً وحدود موارد وطابوراً.
- حدود Supabase المجانية: لذلك الاحتفاظ 30 يوماً وفاصل 5 ثوانٍ افتراضياً في القالب.

## 11) خارج النطاق حالياً

الفوترة والباقات، وضع الأطفال (Blockly)، وضع التصدير، خدمة الترجمة السحابية، دعم Uno/Nano، سوق المشاريع.

## 12) الاختبار الرأسي (تعريف نجاح الإصدار الأول)

مشروع حقيقي واحد: **ESP32 + حساس DHT22 + LED/مروحة**، دون أي خطوة يدوية خارج المنصة:
1. فكرة على الهاتف ← نقاش ← خطة وBOM.
2. توليد نموذج أولي ← مراجعة ← محاكاة على الهاتف.
3. الحاسوب: «جاهز للرفع» ← ترجمة محلية ← رفع USB + تهيئة.
4. الهاتف: عداد حرارة حي ← مفتاح يشغّل LED.
5. تعديل عبر النقاش ← revision جديد ← OTA.

## 13) تعريف الإنجاز لأي مهمة

1. `npm run build` بلا أخطاء.
2. اختبارات الجزء المتغير تمر.
3. لا كسر لبيانات قديمة (migration).
4. تحديث `docs/DECISIONS.md` عند أي قرار معماري.
5. شرح قصير للتحقق اليدوي.
