# مزامنة «خزانة الأفكار» مع Supabase

## 1) كيف تُخزَّن الخطة؟

الخطة يولّدها المساعد أصلاً بصيغة JSON، فتُحفظ كما هي في أعمدة `jsonb` داخل صف الفكرة نفسه:

- `plan` = مصفوفة `[{step, detail, done}]`. عند تعليم خطوة كمنجزة نحدّث هذا العمود فقط.
- `components` = قائمة عناصر العتاد `[{name, qty, note}]`.
- `skills` = المهارات المطلوبة.
- `chat` = نقاش الفكرة الأصلي.
- `plan_history` = نسخ سابقة من الخطة للرجوع إليها.

لماذا ليس جدولاً منفصلاً للخطوات؟ لأن الخطة تُقرأ وتُعدّل كوحدة واحدة، وهذا أبسط وأسرع. إذا احتجت لاحقاً إحصاءات عبر كل الخطوات يمكن فصلها في جدول `idea_steps`.

## 2) SQL (الصقه في Supabase ← SQL Editor)

```sql
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  domain text default 'عام',
  type text not null check (type in ('software','hardware','both')),
  status text not null default 'idea'
    check (status in ('idea','planned','doing','paused','done','dropped')),
  problem text default '',
  solution text default '',
  focus text default 'partial' check (focus in ('aligned','partial','distraction')),
  focus_note text default '',
  duration text default '',
  notes text default '',
  skills jsonb not null default '[]',
  plan jsonb not null default '[]',
  components jsonb not null default '[]',
  chat jsonb not null default '[]',
  plan_history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.ideas (user_id, status);

create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

create trigger ideas_touch before update on public.ideas
for each row execute function public.touch_updated_at();

alter table public.ideas enable row level security;

create policy "own ideas" on public.ideas
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 3) البرومت لـ Antigravity

```
أضف مزامنة Supabase إلى مشروع "خزانة الأفكار" بدون تغيير شكل الواجهة.

المعطيات: جدول public.ideas موجود (انظر SUPABASE.md) وفيه RLS. أعمدة plan وcomponents وskills وchat وplan_history من نوع jsonb وتطابق كائن Idea الحالي.

المطلوب بالترتيب، واحدة في كل مرة:
1. ثبّت @supabase/supabase-js. ضع SUPABASE_URL وSUPABASE_ANON_KEY في ملف .env (VITE_...) ولا تضع أي مفتاح LLM أو service_role في الواجهة.
2. تسجيل الدخول: Magic Link عبر البريد فقط، وشاشة دخول بسيطة بالعربية، وزر خروج في الإعدادات.
3. اكتب SupabaseStore بنفس واجهة Store (list/get/put/remove) مع دوال تحويل بين Idea وصف الجدول (created → created_at وغيرها).
4. معمارية "محلي أولاً": القراءة والكتابة تتم على IndexedDB فوراً، وطابور تغييرات (outbox) يُرسل إلى Supabase عند توفر الإنترنت ويُعاد عند الفشل. أظهر أيقونة حالة صغيرة: متزامن / بانتظار المزامنة / غير متصل.
5. حل التعارض: الأحدث حسب updated_at يفوز، لكن عند تعديل plan على جهازين لا تستبدل الخطة كلها بصمت؛ ادمج حقل done لكل خطوة بمطابقة نص step.
6. Realtime: اشترك في تغييرات جدول ideas لتظهر تعديلات الهاتف على الحاسوب مباشرة.
7. ترحيل بياناتي الحالية: عند أول تسجيل دخول اعرض زر "ارفع أفكاري المحلية" يرفع محتوى IndexedDB/localStorage القديم بدون تكرار، ولا يحذف المحلي.
8. حماية مفتاح الـ LLM: أنشئ Supabase Edge Function باسم llm-proxy تستقبل الرسائل والنظام وتستدعي المزوّد، والمفتاح محفوظ كـ secret في Supabase. تتحقق من JWT المستخدم، وتحدّ المعدل لكل مستخدم. عدّل طبقة LLM لتستخدمها افتراضياً.
9. اكتب اختبارات لدالتي التحويل ودمج الخطة ومنطق الطابور.

بعد كل خطوة: شغّل البناء وأخبرني كيف أتحقق يدوياً.
```

## 4) ملاحظات

- مفتاح `anon` عام بطبيعته، وحمايتك الفعلية هي سياسة RLS. لا تعطّلها أبداً.
- مفتاح `service_role` لا يوضع في أي ملف داخل الواجهة.
- فعّل في Supabase ← Authentication ← Providers خيار Email، وأضف عنوان موقعك في Redirect URLs.
- الخطة المجانية كافية جداً لخزانة شخصية.
