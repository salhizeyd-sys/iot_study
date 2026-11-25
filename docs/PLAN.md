# خطة التنفيذ (يقرؤها المساعد البرمجي وينفذها خطوة خطوة)

المرجع المعماري: `docs/ARCHITECTURE.md` (ملزم). تفاصيل مهام M3 وM4 في `docs/PROMPTS_V3.md` (الخطوات 8 إلى 12). Supabase في `docs/SUPABASE.md`.

## الحالة

| الخطوة | العنوان | الحالة |
|---|---|---|
| S1 | Vite + TypeScript | ✅ |
| S2 | التخزين: واجهة Store + IndexedDB | ✅ |
| S3 | مواءمة المعمارية (وحدات، قدرات، أعلام) | ✅ |
| S4 | الهاتف: واجهة متجاوبة + PWA + نشر | ✅ |
| S5 | المساعد الواعي بالمشروع | ✅ |
| S6 | النموذج الأولي (كود + توصيل + تحذيرات) | ✅ |
| S7 | لوحة التحكم والمحاكاة على الهاتف | ✅ |
| S8 | **اختبار الهاتف (نهاية M1)** | ✅ |
| S9 | Supabase: حساب + مزامنة | ✅ |
| S10 | llm-proxy (إخفاء مفتاح الـ AI) | ✅ |
| S11 | وضع التركيز | ✅ |
| S12 | حاسوب: ترجمة محلية + رفع + تهيئة | ✅ |
| S13 | استقبال القراءات واللوحة الحية | ⏳ 🛑 بانتظار التحقق اليدوي |
| S14 | أوامر التحكم من الهاتف | ⬜ |
| S15 | OTA | ⬜ |
| S16 | الاختبار الرأسي (ESP32 + DHT22 + LED) | ⬜ 🛑 |

🛑 = نقطة توقف بشرية: يتوقف المساعد ويعطيني الخطوات اليدوية بدقة، ولا يكمل حتى أقول "تم".

## ميزات التطبيق الأول: يجب ألا تضيع (اختبار التكافؤ)

تُتحقق كلها في S1، ويُعاد التحقق منها بعد S2 وS3 وS6، ويُسجَّل الدليل:
1. نقاش الفكرة مع AI يعرف أهدافي التعليمية (حقل الأهداف في الإعدادات).
2. تحويل النقاش إلى بطاقة: الاسم، المجال، النوع (برمجي/عتادي/كلاهما)، المشكلة، الحل، المهارات المطلوبة، المدة، خطة التنفيذ، العتاد.
3. تقييم التوافق: ضمن تخصصي / يحتاج تعلماً جانبياً / تشتيت، مع السبب.
4. الحالات وتعديلها، وتحذير تجاوز حد المشاريع قيد التنفيذ.
5. لوحة الخزانة: بحث، فلترة (النوع والمجال)، وتقدم الخطوات.
6. تعليم خطوات الخطة منجزة، الملاحظات، وحذف فكرة.
7. التصدير: ملف md، ملف json، ونسخ البرومت الجاهز لمساعد أو خبير آخر.
8. نسخة احتياطية واستيراد.
9. الإعدادات: المزوّد والنموذج والمفتاح وBase URL والأهداف.

## بروتوكول العمل (إلزامي)

لكل خطوة بالترتيب، ولا تبدأ خطوة قبل أن تُعلَّم ✅:
1. اشرح في 3 أسطر ما ستفعله، ثم نفّذ **هذه الخطوة فقط** دون تحسينات خارج نطاقها.
2. شغّل `npm run build` والاختبارات (`npm test`)، وأصلح الأخطاء.
3. تحقق من **كل** معيار قبول للخطوة، وسجّل الدليل (أمر ونتيجته أو وصف ما رأيت).
4. حدّث جدول الحالة هنا إلى ✅ مع سطر دليل أسفل الخطوة، ثم `git commit -m "Sx: ..."`.
5. إن تعذر معيار بعد محاولتين متتاليتين لحل المشكلة نفسها: توقف وأخبرني بالسبب والخيارات.
6. عند 🛑: توقف، وأعطني قائمة مرقمة بما أفعله يدوياً (حسابات، مفاتيح، نشر، تجربة على الهاتف)، وبما سأقوله لك عند النجاح.
7. عند قرار معماري جديد سجّله في `docs/DECISIONS.md`.
8. لا تحذف بياناتي ولا تكسر التوافق مع الأفكار المحفوظة (migration دائماً).

---

# M1: الهاتف يعمل (بلا خادم، البيانات محلية)

في M1 يُحفظ كل شيء على الجهاز، ومفتاح الـ AI يدخله المستخدم في الإعدادات ويبقى محلياً (حل مؤقت يُستبدل في S10).

## S1: التحقق من Vite + TypeScript
**معايير القبول:** `npm run build` ينجح بلا أخطاء أنواع؛ `npm run dev` يعمل؛ السلوك مطابق للنسخة السابقة: كل بنود جدول التكافؤ (1 إلى 9) تعمل؛ يوجد README بطريقة التشغيل؛ `git init` وأول commit إن لم يوجد.
**الدليل:** `npm.cmd run build` (`tsc && vite build`) نجح في 196ms بدون أخطاء (`dist/index.html`, `dist/assets/index-QUfmBvKD.js`)؛ `npm.cmd run dev` استجاب بـ HTTP 200 على `http://localhost:3000/`؛ طابقت `src/` مع `index.html.bak` لبنود التكافؤ (1–9)؛ `README.md` و`git` موجودان.

## S2: التخزين
**المهام:** عرّف واجهة `Store` (list/get/put/remove) في `src/store/`. نفّذ `IndexedDBStore` بمكتبة `idb`. ترحيل لمرة واحدة من localStorage (المفتاح `ideavault.v1`) مع إبقاء نسخة احتياطية منه حتى تأكد النجاح. أضف `schemaVersion` ودالة `migrate`. أضف Vitest مع `fake-indexeddb`.
**معايير القبول:** اختبارات تمر لـ CRUD والترحيل (بما فيها بيانات قديمة بلا حقول جديدة)؛ يدوياً: أفكاري الحالية تظهر بعد إعادة التحميل، وتبقى بعد مسح localStorage.
**الدليل:** `npm.cmd run build` نجح في 233ms؛ `npm.cmd test` (`vitest run` + `fake-indexeddb`) نجح بـ 6/6 اختبارات في `src/store/store.test.ts` تغطي CRUD وترقية السجلات القديمة والترحيل لمرة واحدة من `ideavault.v1` مع حفظ `ideavault.v1.backup` وبقاء البيانات بعد مسح `localStorage` وإعادة `initStore()`؛ أُعيد التحقق من تكافؤ الميزات (1–9) عبر واجهة `S` و`save()`.

## S3: مواءمة المعمارية
**المهام:** القسم 5 و6 من ARCHITECTURE.md: `core/` (types مع schemaVersion وmemory وlifecycle، settings، ناقل أحداث typed، سجل وحدات، `capabilities.ts`)؛ نقل منطق الأفكار إلى `modules/vault/`؛ feature flags (كلها مغلقة عدا vault)؛ `docs/DECISIONS.md` بأول القرارات؛ قاعدة ESLint تمنع استيراد وحدة من وحدة.
**معايير القبول:** build واختبارات تمر؛ السلوك مطابق؛ ملف تجريبي يستورد وحدة من أخرى يفشل في ESLint (وثّق ذلك ثم احذف الملف).
**الدليل:** `npm.cmd run build` نجح في 259ms؛ `npm.cmd test` نجح بـ 9/9 اختبارات (`core.test.ts` 3 + `store.test.ts` 6)؛ `npm.cmd run lint` مرّ بـ 0 أخطاء؛ اختبار ملف مؤقت `src/modules/tmp-probe/bad.ts` يستورد `../vault` فشل في ESLint بـ `PROBE_EXIT=1` (`local/no-cross-module-imports`) ثم حُذف وعاد الفحص للنجاح؛ تم التحقق من تكافؤ الميزات (1–9) وتوثيق `docs/DECISIONS.md`.

## S4: الهاتف: واجهة وPWA ونشر 🛑
**المهام:** واجهة متجاوبة للجوال (تنقل سفلي، أهداف لمس 44px، جداول تتحول إلى بطاقات، دعم RTL كامل). PWA بـ `vite-plugin-pwa`: manifest وservice worker وعمل دون إنترنت للقراءة والكتابة. زر عائم "فكرة سريعة" بالكتابة أو الإملاء (`SpeechRecognition` عبر `caps.speech`، ولغته من الإعدادات وافتراضياً العربية، ويُخفى إن لم يُدعم)، ويحفظ مسودة تُناقش لاحقاً.
**معايير القبول (المساعد):** البناء ينتج manifest وservice worker؛ `npm run preview` يخدمهما؛ لا تمرير أفقي في عرض 360px (تحقق بأداة أو متصفح مدمج إن توفر). ثم اكتب لي خطوات نشر Vite على Vercel بدقة (الاستيراد من GitHub، أمر البناء `npm run build`، مجلد الإخراج `dist`).
**دليل المساعد:** `npm.cmd run build` أنتج `dist/manifest.webmanifest` و`dist/sw.js` و`dist/workbox-9c191d2f.js` (11 ملفاً مخزناً مسبقاً)؛ `npm.cmd run preview` خدمهما بـ HTTP 200؛ `npm.cmd test` مرّ بـ 13/13 اختباراً و`npm.cmd run lint` بـ 0 أخطاء؛ فحص Chrome headless بعرض 360px أعطى `scrollWidth: 360` و`clientWidth: 360` (`hasHorizontalScroll: false`) و`dir: "rtl"` وأزرار تنقل سفلي بارتفاع `51px` وFAB بارتفاع `48px`؛ وأكّد المستخدم النشر وتجربة الهاتف بـ«تم».
**🛑 يدوياً:** أنشر على Vercel، افتح الرابط على الهاتف، ثبّته على الشاشة الرئيسية، فعّل وضع الطيران وتأكد أنه يفتح، وجرّب الإملاء الصوتي.

## S5: المساعد الواعي بالمشروع
**المهام:** `src/llm/context.ts` بدالة `buildProjectContext(idea)` ضمن ميزانية رموز قابلة للضبط (بطاقة الفكرة، الخطوات المنجزة والمتبقية، BOM، ملخص النموذج الأولي إن وُجد، memory، ملاحظاتي). زر "ناقش هذا المشروع" يفتح محادثة بهذا السياق وتُحفظ في `idea.chat`. تحديث `idea.memory` بملخص قرارات بعد الجلسة. زر "عدّل الخطة" يحافظ على الخطوات المنجزة ويحفظ النسخة السابقة في `plan_history`.
**معايير القبول:** اختبارات لـ buildProjectContext (الترتيب، احترام الميزانية، غياب الحقول الاختيارية)؛ يدوياً: أسأل المساعد عن تفصيل ذكرته سابقاً في الفكرة فيجيب بدقة دون أن أعيده.
**الدليل:** `npm.cmd run build` نجح في 350ms؛ `npm.cmd test` مرّ بـ 18/18 اختباراً (`src/llm/context.test.ts`: 3 اختبارات للترتيب والميزانية وغياب الحقول الاختيارية؛ `src/modules/vault/vault.test.ts`: اختبار النقاش الواعي وحفظ `idea.chat` وتحديث `idea.memory` وتعديل الخطة مع الحفاظ على الخطوات المنجزة وتسجيل `plan_history`)؛ `npm.cmd run lint` مرّ بـ 0 أخطاء.

## S6: النموذج الأولي
**المهام:** `modules/iot/prototype/` بحسب القسم 8.2 والقسم 9: مخطط zod لـ `PrototypeV1`؛ توليد عبر `buildProjectContext` مع إعادة محاولة واحدة عند فشل التحقق، وتحمّل نص زائد حول JSON؛ قالب الكود يقرأ إعداداته من Preferences/NVS بلا أسرار مكتوبة، ويرسل كل 5 ثوانٍ؛ جدول `idea_prototypes` محلياً في IndexedDB مع `revision` ونسخ قديمة؛ فاحص أرجل ESP32 حتمي (تكرار، أرجل الإقلاع، أرجل الإدخال فقط)؛ تبويب في تفاصيل الفكرة: جدول التوصيل، الكود (`<pre>` مع نسخ على اللمس، وMonaco بتحميل كسول على غير اللمس فقط)، قائمة warnings؛ زر "عدّل عبر النقاش" ينتج revision جديداً ويعرض الفروقات. **بلا ترجمة ولا رفع.**
**معايير القبول:** اختبارات: JSON صالح، JSON ناقص، نص زائد حول JSON، فاحص الأرجل (حالات ناجحة وفاشلة)؛ يدوياً: أولد نموذجاً لفكرة ESP32 + DHT22 + LED فأرى التوصيل والكود والتحذيرات؛ وعند تصدير الفكرة (md أو نسخ كبرومت) يحوي الملف النموذج الأولي أيضاً (التوصيل، الكود، التحذيرات).
**الدليل:** `npm.cmd run build` نجح في 8.91s (مع تقسيم Monaco كسولاً وحزمة PWA بحجم 273.69 KiB)؛ `npm.cmd test` مرّ بـ 24/24 اختباراً (6 اختبارات في `prototype.test.ts` تغطي JSON صالح/ناقص/بنص زائد، وفاحص الأرجل الحتمي، وإعادة المحاولة الواحدة، والنسخ في `idea_prototypes`، والفروقات، والتصدير `.md`/برومبت شاملاً التوصيل والكود والتحذيرات)؛ `npm.cmd run lint` مرّ بـ 0 أخطاء؛ وأُعيد التحقق من تكافؤ الميزات (1–9).

## S7: لوحة التحكم والمحاكاة
**المهام:** `modules/iot/dashboard/`: رسم widgets (gauge, line_chart, status_badge, toggle_switch, slider) بـ SVG/Canvas بلا مكتبة ثقيلة وبتصميم للجوال؛ زر محاكاة يبث `simulation.frames` كل `interval_ms` (تشغيل/إيقاف)؛ المفاتيح والمنزلقات تغيّر حالة محلية في المحاكاة فقط.
**معايير القبول:** اختبارات رسم من JSON (jsdom)؛ يدوياً على الهاتف: العدادات والمخطط يتحركون، والمفاتيح تستجيب.
**الدليل:** `npm.cmd run build` نجح في 8.57s؛ `npm.cmd test` مرّ بـ 27/27 اختباراً (3 اختبارات في `dashboard.test.ts` تغطي رسم جميع العناصر الخمسة بـ SVG/DOM من JSON في `jsdom` وبث `simulation.frames` وفق `interval_ms` واستجابة `toggle_switch` و`slider` محلياً دون ارتداد)؛ `npm.cmd run lint` مرّ بـ 0 أخطاء.

## S8: اختبار الهاتف (نهاية M1) 🛑
**المهام:** اكتب `docs/PHONE_CHECKLIST.md` بالسيناريو، ونفّذ ما يمكن آلياً.
**السيناريو:** على الهاتف فقط: التقط فكرة صوتياً ← ناقشها ← حوّلها لخطة ← ولّد النموذج الأولي ← راجع التوصيل والكود ← شغّل المحاكاة ← عدّل شيئاً بالنقاش فيظهر revision جديد ← صدّر ملف md.
**دليل المساعد:** أُنشئت قائمة التحقق في `docs/PHONE_CHECKLIST.md`؛ نُفّذ السيناريو الكامل آلياً في `src/e2e/m1-flow.test.ts` (`npm.cmd run build` نجح في 8.80s، `npm.cmd test` مرّ بـ 28/28 اختباراً عبر 7 ملفات، `npm.cmd run lint` مرّ بـ 0 أخطاء)؛ وأكّد المستخدم «M1 نجح» مع طلب تنظيم تفاصيل المشروع في 3 تبويبات مثبتة وإخفاء الزر العائم داخلها.
**🛑 يدوياً:** أنفذ السيناريو وأكتب لك الملاحظات. لا ننتقل إلى M2 قبل أن أقول "M1 نجح".

---

# M2: الحساب والمزامنة (بعد نجاح M1)

تفصيل الخطوات بناءً على `docs/SUPABASE.md` والقسم 7 من `docs/ARCHITECTURE.md` و`docs/PROMPTS_V3.md`:

## S9: Supabase: الحساب والمزامنة 🛑
**المهام:**
1. ملف `supabase/migrations/001_m2_initial.sql`: جدول `public.ideas` (مع `memory`, `lifecycle`, `plan_history`, `updated_at` trigger، فهرس `(user_id, status)`، وسياسة RLS)، وجدول `public.idea_prototypes` (مع `user_id`, `idea_id`, `revision`, `schema_version`, `data jsonb`, `change_summary`, `created_at` وسياسة RLS)، وتفعيل Realtime عليهما.
2. تثبيت `@supabase/supabase-js`، وإعداد `.env.example` وعميل Supabase (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` فقط بلا أسرار LLM أو `service_role`).
3. تسجيل الدخول عبر Magic Link (البريد الإلكتروني فقط) مع واجهة عربية بسيطة وزر خروج في الإعدادات.
4. `SupabaseStore` بنفس واجهة `Store` (`list/get/put/remove`) مع دوال التحويل الصريحة (`ideaToRow` / `rowToIdea`, `prototypeToRow` / `rowToPrototype`).
5. معمارية محلي-أولاً: القراءة والكتابة على IndexedDB فوراً، وطابور `outbox` يُرسل عند الاتصال ويُعاد عند الفشل، ومؤشر حالة (`متزامن` / `بانتظار المزامنة` / `غير متصل` / `محلي فقط`).
6. حل التعارض: الأحدث حسب `updated_at` يفوز، مع دمج حقل `done` لكل خطوة في `plan` بمطابقة نص `step`.
7. Realtime عبر `postgres_changes` لتحديث الواجهة فوراً، وزر **"⬆️ ارفع أفكاري المحلية"** عند أول دخول دون حذف أو تكرار.
**معايير القبول (المساعد):** اختبارات لدوال التحويل، ودمج الخطة المتعارضة، ومنطق `outbox` وإعادة المحاولة؛ `npm run build` و`npm test` و`npm run lint` تمر بلا أخطاء.
**دليل المساعد:** أُنشئ SQL والـ RLS في `supabase/migrations/001_m2_initial.sql`؛ و`SupabaseStore` و`SyncManager` ودوال التحويل و`mergeIdeaConflict` في `src/store/`؛ `npm.cmd run build` نجح في `9.35s`؛ `npm.cmd test` مرّ بـ `32/32` اختباراً (منها 4 اختبارات في `src/store/sync.test.ts`)؛ `npm.cmd run lint` مرّ بـ `0` أخطاء؛ وأكّد المستخدم الإعداد والمزامنة بـ«تم».
**🛑 يدوياً:** أنشئ مشروع Supabase، شغّل `supabase/migrations/001_m2_initial.sql` في SQL Editor، فعّل Email provider وأضف Redirect URLs، ضع `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` في `.env` وVercel، ثم تأكد: فكرة تُنشأ على الهاتف تظهر على الحاسوب، والعكس، ويعمل التعديل دون إنترنت ثم يُزامَن.

## S10: `llm-proxy` (إخفاء مفتاح الـ AI) 🛑
**المهام:**
1. Edge Function في `supabase/functions/llm-proxy/index.ts` تتحقق من JWT المستخدم، وتحدّ المعدل لكل مستخدم، وتستدعي مزوّد الـ AI بمفتاح محفوظ في أسرار Supabase.
2. تحديث `src/llm/index.ts` لاستخدام `llm-proxy` افتراضياً عند تسجيل الدخول وإزالة تخزين/إرسال مفتاح الـ AI من المتصفح عند تفعيل البروكسي، مع مخططات `zod` في `src/llm/schemas.ts`.
**معايير القبول (المساعد):** اختبارات لعميل `llm-proxy` ومخططات `zod`؛ البناء والاختبارات وESLint تمر.
**دليل المساعد:** أُنشئت الدالة في `supabase/functions/llm-proxy/index.ts` (تحقق JWT + Rate limit + قراءة السر من `Deno.env`)؛ ومخططات `zod` وإعادة المحاولة الواحدة في `src/llm/schemas.ts`؛ وتوجيه `callLLM` عبر البروكسي ومسح أي مفتاح متبقٍ من المتصفح في `src/llm/index.ts` و`src/modules/vault/ui.ts`؛ `npm.cmd run build` نجح في `7.22s`؛ `npm.cmd test` مرّ بـ `35/35` اختباراً (منها 3 اختبارات في `src/llm/llm-proxy.test.ts`)؛ `npm.cmd run lint` مرّ بـ `0` أخطاء؛ وأكّد المستخدم النشر والتحقق بـ«تم».
**🛑 يدوياً:** اضبط السر في Supabase وانشر الدالة، وتأكد من Network وStorage أنه لا يوجد أي مفتاح AI في المتصفح.

## S11: وضع التركيز
**المهام:** تفعيل علم `focus: true`؛ صفحة «🎯 التركيز» داخل `modules/vault/` تعرض مشروعاً نشطاً واحداً مع الخطوة التالية وشريط تقدم؛ نافذة اختيار مشروع لإيقافه عند تجاوز `maxDoing`؛ تبريد 7 أيام (`cooldown_until` مع migration) مع عدّاد وزر تجاوز يتطلب سبباً؛ شريط نسب التوافق.
**معايير القبول:** اختبارات لمنطق التبريد وتجاوز `maxDoing` وحساب النسب؛ البناء والاختبارات وESLint تمر.
**الدليل:** فُعّل `focus: true` في `src/core/settings.ts`؛ وأُنشئت `src/modules/vault/focus.ts` و`focusView()` ونافذة اختيار إيقاف مشروع عند تجاوز `maxDoing` وإدارة تبريد 7 أيام (`cooldown_until` و`schemaVersion = 5`) وشريط نسب التوافق في `src/modules/vault/ui.ts`؛ `npm.cmd run build` نجح في `7.38s`؛ `npm.cmd test` مرّ بـ `40/40` اختباراً (منها 5 اختبارات في `src/modules/vault/focus.test.ts`)؛ `npm.cmd run lint` مرّ بـ `0` أخطاء.

# M3: الحاسوب (بعد نجاح M2)

## S12: حاسوب: ترجمة محلية + رفع + تهيئة + Serial Monitor 🛑
**المهام:**
1. `scripts/compile-local`: خادم Node محلي يغلّف `arduino-cli` (`GET /health`, `POST /compile` مع CORS وPrivate Network Access) ويرجع ملفات `.bin` وإزاحاتها.
2. `src/modules/iot/flash/` (متكيّف بـ `caps.webSerial`):
   - على الحاسوب (`caps.webSerial`): مراجعة إجبارية للتحذيرات وفاحص الأرجل، ترجمة محلية، رفع عبر USB بـ `esptool-js` (تحميل كسول)، تهيئة الواي فاي والرمز عبر Web Serial إلى Preferences/NVS (دون حفظ كلمة مرور الواي فاي في أي خادم)، وSerial Monitor حي داخل الواجهة.
   - على الهاتف (`!caps.webSerial`): زر «🚀 جاهز للرفع» يضبط `lifecycle = 'ready_to_flash'` ويظهر مشروعك على الحاسوب كجاهز للرفع.
3. تحديث قالب ESP32 بإضافة مستمع التهيئة عبر Serial وبوابة Captive Portal عند خلو NVS.
**معايير القبول (المساعد):** اختبارات لـ `scripts/compile-local` (تحضير الملفات وتسمية `.ino` والإزاحات)، ولحارس المراجعة الإجبارية وتنسيق سطر JSON للتهيئة ومنطق التسليم `ready_to_flash`؛ `npm run build` و`npm test` و`npm run lint` تمر.
**دليل المساعد:** أُنشئ الخادم المحلي في `scripts/compile-local/server.mjs` و`lib.mjs`؛ ونُقلت دالة فحص أرجل ESP32 إلى `src/core/esp32.ts` لمنع الاستيراد بين الوحدات؛ وأُنشئت وحدة `src/modules/iot/flash/` (مراجعة إجبارية، ترجمة محلية، رفع `esptool-js` كسول، تهيئة NVS عبر Web Serial، Serial Monitor، وتسليم `ready_to_flash` للهاتف) مع تحديث قالب Captive Portal والتهيئة التسلسلية في `template.ts`؛ `npm.cmd run build` نجح في `10.13s`؛ `npm.cmd test` مرّ بـ `45/45` اختباراً (منها 4 اختبارات في `src/modules/iot/flash/flash.test.ts`)؛ `npm.cmd run lint` مرّ بـ `0` أخطاء؛ وأكّد المستخدم التجربة على ESP32 بـ«تم».
**🛑 يدوياً:** ثبّت `arduino-cli` ونواة `esp32:esp32`، شغّل `npm run compile-local`، وصّل ESP32 عبر USB بالحاسوب، ثم راجع وترجم وارفع وهيّئ الواي فاي وراقب الإقلاع في Serial Monitor.

# M4: الحقل (بعد نجاح M3)

## S13: استقبال القراءات والأجهزة (Managed) 🛑
**المهام:**
1. Migration `supabase/migrations/002_m4_iot_field.sql`: جداول `devices` و`device_tokens` (`token_hash` sha256 فقط) و`iot_telemetry` و`iot_commands` مع `user_id` وRLS وفهارس Realtime، ودالة `cleanup_old_telemetry()` لحذف القراءات الأقدم من 30 يوماً.
2. Edge Function `supabase/functions/ingest-telemetry/index.ts` (مع `cleanup-telemetry/index.ts`): تحقق بـ SHA-256، حد 4KB، حد معدل (2 ثانية على الأقل)، قبول مفاتيح `dashboard` فقط، تحديث `last_seen_at` و`last_used_at`، والرد بـ `{ ok: true, commands: [], firmware: null }`.
3. واجهة `modules/iot/telemetry/` (مع `iot.telemetry: true`): زر «🔑 سجّل جهازاً» يعرض الرمز مرة واحدة، وحالة `online`/`offline` (أقل من `3 × الفاصل`)، واحتفال بأول قراءة حية (`lifecycle = 'online'`).
4. تبديل واضح في لوحة التحكم (`modules/iot/dashboard/`) بين **المحاكاة** و**البث الحي (Realtime)**.
**معايير القبول (المساعد):** اختبارات لتوليد وتجزئة الرمز، وفلترة مفاتيح `dashboard` وحد 4KB والحد الزمني، وحساب `online`/`offline`، وتبديل المحاكاة/البث الحي في اللوحة؛ `npm run build` و`npm test` و`npm run lint` تمر.
**دليل المساعد:** أُنشئ `supabase/migrations/002_m4_iot_field.sql` (جداول `devices`, `device_tokens`, `iot_telemetry`, `iot_commands` مع RLS وRealtime ودالة حذف 30 يوماً)؛ وEdge Functions في `supabase/functions/ingest-telemetry/index.ts` و`cleanup-telemetry/index.ts`؛ و`src/store/telemetry.ts` و`src/modules/iot/telemetry/` (تسجيل الجهاز بعرض الرمز مرة واحدة، حالة `online`/`offline`، واحتفال بأول قراءة)؛ وتبديل المحاكاة/البث الحي في `src/modules/iot/dashboard/ui.ts`؛ `npm.cmd run build` نجح في `9.25s`؛ `npm.cmd test` مرّ بـ `48/48` اختباراً (12 ملفاً)؛ `npm.cmd run lint` مرّ بـ `0` أخطاء.
**🛑 يدوياً:** شغّل `002_m4_iot_field.sql` في Supabase، وانشر `ingest-telemetry` (بـ `--no-verify-jwt`) و`cleanup-telemetry`، وسجّل جهازاً في التطبيق وهيّئه على ESP32 لترى القراءات الحية.

## S14: أوامر التحكم من الهاتف
**المهام:** ربط `toggle_switch` و`slider` بإدراج صف في `iot_commands` عند التبديل في وضع البث الحي؛ تحديث `ingest-telemetry` لإرجاع الأوامر غير المنفذة وتعليمها منفذة بعد تأكيد الجهاز في الطلب التالي، مع مهلة صلاحية للأمر وتحديث قالب ESP32.
**معايير القبول:** اختبارات لإرسال الأمر وتأكيد التنفيذ وانتهاء الصلاحية؛ البناء والاختبارات وESLint تمر.

## S15: OTA (التحديث اللاسلكي)
**المهام:** Migration لـ `firmware_releases` وStorage خاص مع `sha256`؛ تضمين `firmware: { version, url, sha256 }` في رد `ingest-telemetry` عند وجود إصدار أحدث؛ تحديث قالب ESP32 للتحقق من `sha256` قبل التثبيت؛ وزر «حدّث لاسلكياً» في `modules/iot/ota/`.
**معايير القبول:** اختبارات لتطابق `sha256` ومنطق الإصدارات؛ البناء والاختبارات وESLint تمر.

## S16: الاختبار الرأسي (ESP32 + DHT22 + LED) 🛑
**المهام:** كتابة `docs/E2E_CHECKLIST.md` من القسم 12 في المعمارية وتنفيذ كل ما يمكن التحقق منه آلياً.
**🛑 يدوياً:** تنفيذ الدورة الكاملة على مشروع حقيقي (ESP32 + DHT22 + LED) دون أي خطوة خارج المنصة.
