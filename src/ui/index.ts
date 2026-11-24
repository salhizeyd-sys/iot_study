import { Idea, IdeaType, IdeaFocus, FilterState, ChatMessage } from '../types';
import { TYPES, STATUS, FOCUS, MODELS } from '../config';
import { S, save } from '../store';
import { callLLM } from '../llm';
import { sysChat, sysPlan } from '../prompts';
import { toMD, toPrompt, dl } from '../export';

export const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null =>
  document.querySelector<T>(s);

export const esc = (s: any): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );

export const filt: FilterState = { q: '', type: '', domain: '' };
export let chat: ChatMessage[] = [];
let busy = false;
let toastTimer: any;

export function toast(m: string): void {
  const t = $('#toast');
  if (!t) return;
  t.textContent = m;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (t) t.style.display = 'none';
  }, 3200);
}

export const norm = (j: any) => ({
  name: j.name || 'فكرة بلا اسم',
  domain: j.domain || 'عام',
  type: (TYPES[j.type as IdeaType] ? j.type : 'software') as IdeaType,
  problem: j.problem || '',
  solution: j.solution || '',
  focus: (FOCUS[j.focus as IdeaFocus] ? j.focus : 'partial') as IdeaFocus,
  focus_note: j.focus_note || '',
  skills: Array.isArray(j.skills_needed) ? j.skills_needed : Array.isArray(j.skills) ? j.skills : [],
  duration: j.duration || '',
  plan: (j.plan || []).map((p: any) => ({
    step: p.step || '',
    detail: p.detail || '',
    done: !!p.done,
  })),
  components: (j.components || []).map((c: any) => ({
    name: c.name || '',
    qty: Number(c.qty) || 1,
    note: c.note || '',
  })),
});

/* --- الصفحة الرئيسية --- */
export function home(): void {
  const app = $('#app');
  if (!app) return;
  const doing = S.ideas.filter((i) => i.status === 'doing').length;
  const max = +S.settings.maxDoing || 2;
  const domains = [...new Set(S.ideas.map((i) => i.domain))];

  app.innerHTML = `
  <div>${S.ideas.length} فكرة · ${doing} قيد التنفيذ</div>
  ${
    doing > max
      ? `<div class="warn">⚠️ عندك ${doing} مشاريع قيد التنفيذ والحد الذي وضعته ${max}. أنهِ أو أوقف مشروعاً قبل أن تبدأ غيره.</div>`
      : ''
  }
  <div class="bar">
    <input id="q" placeholder="ابحث في الأفكار" value="${esc(filt.q)}" oninput="filt.q=this.value;grid()">
    <select onchange="filt.type=this.value;grid()"><option value="">كل الأنواع</option>${Object.entries(
      TYPES
    )
      .map(([k, v]) => `<option value="${k}" ${filt.type === k ? 'selected' : ''}>${v}</option>`)
      .join('')}</select>
    <select onchange="filt.domain=this.value;grid()"><option value="">كل المجالات</option>${domains
      .map((d) => `<option ${filt.domain === d ? 'selected' : ''}>${esc(d)}</option>`)
      .join('')}</select>
  </div><div id="grid" class="grid"></div>`;
  grid();
}

export function grid(): void {
  const gridEl = $('#grid');
  if (!gridEl) return;
  const q = filt.q.toLowerCase();
  const list = S.ideas.filter(
    (i) =>
      (!filt.type || i.type === filt.type) &&
      (!filt.domain || i.domain === filt.domain) &&
      (!q || (i.name + i.problem + i.solution + i.domain).toLowerCase().includes(q))
  );

  gridEl.innerHTML =
    list
      .map((i) => {
        const f = FOCUS[i.focus] || ['غير محدد', 'wn'];
        const d = (i.plan || []).filter((p) => p.done).length;
        return `<div class="card ${i.type}" tabindex="0" onclick="openIdea('${i.id}')" onkeydown="if(event.key==='Enter')openIdea('${i.id}')">
    <h3>${esc(i.name)}</h3><span class="tag">${esc(i.domain)}</span><span class="tag">${
          TYPES[i.type] || i.type
        }</span><span class="tag ${f[1]}">${f[0]}</span>
    <p>${STATUS[i.status] || i.status} · ${d}/${(i.plan || []).length} خطوات</p></div>`;
      })
      .join('') ||
    `<div class="empty" style="grid-column:1/-1">${
      S.ideas.length
        ? 'لا نتائج مطابقة.'
        : 'خزانتك فارغة. اضغط «فكرة جديدة» وناقشها مع المساعد.'
    }</div>`;
}

/* --- نقاش فكرة جديدة --- */
export function newIdea(): void {
  chat = [];
  const app = $('#app');
  if (!app) return;
  app.innerHTML = `<button class="btn g" onclick="home()">← الخزانة</button><h2>فكرة جديدة</h2>
  <div class="msgs" id="msgs"></div>
  <textarea id="inp" rows="3" placeholder="اشرح فكرتك بحرية، والمساعد سيسألك ويختبرها معك."></textarea>
  <div class="bar"><button class="btn" id="send" onclick="send()">إرسال</button><button class="btn g" id="fin" onclick="finalize()">حوّلها إلى خطة واحفظها</button></div>`;
  paint();
}

export function paint(): void {
  const m = $('#msgs');
  if (!m) return;
  m.innerHTML = chat.length
    ? chat.map((c) => `<div class="m ${c.role}">${esc(c.content)}</div>`).join('')
    : '<div class="empty">ابدأ بوصف الفكرة. سأذكّرك بأهدافك: ' + esc(S.settings.goals) + '</div>';
  m.lastElementChild?.scrollIntoView({ block: 'end' });
}

export async function guard(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll<HTMLButtonElement>('#send,#fin')
    .forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e: any) {
    toast('⚠️ ' + (e?.message || 'حدث خطأ'));
  }
  busy = false;
  document
    .querySelectorAll<HTMLButtonElement>('#send,#fin')
    .forEach((b) => (b.disabled = false));
}

export const send = () =>
  guard(async () => {
    const inp = $('#inp') as HTMLTextAreaElement | null;
    if (!inp) return;
    const t = inp.value.trim();
    if (!t) return;
    chat.push({ role: 'user', content: t });
    inp.value = '';
    paint();
    try {
      const resp = await callLLM(chat, sysChat());
      chat.push({ role: 'assistant', content: resp });
    } catch (e) {
      chat.pop();
      inp.value = t;
      throw e;
    }
    paint();
  });

export const finalize = () =>
  guard(async () => {
    if (!chat.length) return toast('ناقش الفكرة أولاً');
    toast('جارٍ بناء الخطة…');
    const r = await callLLM(
      [
        ...chat,
        {
          role: 'user',
          content: 'حوّل نقاشنا إلى بطاقة المشروع النهائية بصيغة JSON فقط.',
        },
      ],
      sysPlan()
    );
    const m = r.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('لم يُرجع المساعد JSON صالحاً، أعد المحاولة');
    const parsed = JSON.parse(m[0]);
    const idea: Idea = {
      id: crypto.randomUUID(),
      created: Date.now(),
      status: 'idea',
      notes: '',
      chat: chat.slice(),
      ...norm(parsed),
    };
    S.ideas.unshift(idea);
    save(toast);
    chat = [];
    home();
    openIdea(idea.id);
  });

/* --- تفاصيل الفكرة --- */
export function openIdea(id: string): void {
  const dlg = $('#dlg') as HTMLDialogElement | null;
  if (!dlg) return;
  const i = S.ideas.find((x) => x.id === id);
  if (!i) return;
  const f = FOCUS[i.focus] || ['غير محدد', 'wn'];

  dlg.innerHTML = `
  <div class="bar" style="justify-content:space-between"><h2 style="margin:0">${esc(
    i.name
  )}</h2><button class="btn g" onclick="dlg.close()" aria-label="إغلاق">✕</button></div>
  <span class="tag">${esc(i.domain)}</span><span class="tag">${TYPES[i.type] || i.type}</span><span class="tag ${f[1]}">${f[0]}</span>${
    i.duration ? `<span class="tag">${esc(i.duration)}</span>` : ''
  }
  ${i.focus_note ? `<p style="color:var(--mu);margin:6px 0">${esc(i.focus_note)}</p>` : ''}
  <label>الحالة</label><select onchange="upd('${id}','status',this.value)">${Object.entries(
    STATUS
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v}</option>`
    )
    .join('')}</select>
  <h2>المشكلة</h2><div>${esc(i.problem)}</div><h2>الحل</h2><div>${esc(i.solution)}</div>
  ${
    i.skills && i.skills.length
      ? `<h2>المهارات المطلوبة</h2><ul>${i.skills
          .map((s) => `<li>${esc(s)}</li>`)
          .join('')}</ul>`
      : ''
  }
  <h2>خطة التنفيذ</h2>${(i.plan || [])
    .map(
      (p, n) =>
        `<label class="step ${
          p.done ? 'done' : ''
        }" style="color:inherit;font-size:inherit;margin:6px 0"><input type="checkbox" ${
          p.done ? 'checked' : ''
        } onchange="tick('${id}',${n},this.checked)"><span><b>${esc(
          p.step
        )}</b><br>${esc(p.detail)}</span></label>`
    )
    .join('')}
  ${
    i.components && i.components.length
      ? `<h2>العناصر المطلوبة</h2><ul>${i.components
          .map(
            (c) =>
              `<li>${esc(c.name)} × ${esc(c.qty || 1)} ${
                c.note ? '— ' + esc(c.note) : ''
              }</li>`
          )
          .join('')}</ul>`
      : ''
  }
  <label>ملاحظاتي</label><textarea rows="3" onchange="upd('${id}','notes',this.value)">${esc(
    i.notes
  )}</textarea>
  <div class="bar" style="margin-top:14px">
    <button class="btn" onclick="copyPrompt('${id}')">نسخ كبرومبت لمساعد آخر</button>
    <button class="btn g" onclick="exp('${id}','md')">تصدير .md</button>
    <button class="btn g" onclick="exp('${id}','json')">تصدير .json</button>
    <button class="btn d" onclick="del('${id}')">حذف</button>
  </div>`;
  dlg.showModal();
}

export const copyPrompt = (id: string): void => {
  const i = S.ideas.find((x) => x.id === id);
  if (!i) return;
  navigator.clipboard.writeText(toPrompt(i)).then(() => toast('نُسخ كبرومبت جاهز'));
};

export const upd = (id: string, k: keyof Idea, v: any): void => {
  const item = S.ideas.find((x) => x.id === id);
  if (!item) return;
  (item as any)[k] = v;
  save(toast);
  home();
};

export const tick = (id: string, n: number, v: boolean): void => {
  const item = S.ideas.find((x) => x.id === id);
  if (!item || !item.plan || !item.plan[n]) return;
  item.plan[n].done = v;
  save(toast);
  home();
  openIdea(id);
};

export const del = (id: string): void => {
  if (confirm('حذف الفكرة نهائياً؟')) {
    S.ideas = S.ideas.filter((x) => x.id !== id);
    save(toast);
    const dlg = $('#dlg') as HTMLDialogElement | null;
    if (dlg) dlg.close();
    home();
  }
};

export const exp = (id: string, t: 'md' | 'json'): void => {
  const i = S.ideas.find((x) => x.id === id);
  if (!i) return;
  const n = i.name.replace(/[^\w\u0600-\u06FF]+/g, '-');
  t === 'md'
    ? dl(n + '.md', toMD(i))
    : dl(n + '.json', JSON.stringify(i, null, 2), 'application/json');
};

/* --- الإعدادات --- */
export function openSettings(): void {
  const set = $('#set') as HTMLDialogElement | null;
  if (!set) return;
  const s = S.settings;
  set.innerHTML = `<div class="bar" style="justify-content:space-between"><h2 style="margin:0">الإعدادات</h2><button class="btn g" onclick="set.close()" aria-label="إغلاق">✕</button></div>
  <label>المزوّد</label><select id="sp" onchange="const sm = document.getElementById('sm'); if(sm) sm.value=MODELS[this.value]||''"><option value="gemini">Gemini</option><option value="openai">OpenAI / متوافق (OpenRouter, Groq, Ollama)</option><option value="anthropic">Anthropic</option></select>
  <label>النموذج</label><input id="sm" value="${esc(s.model)}">
  <label>مفتاح API (يبقى في متصفحك فقط)</label><input id="sk" type="password" value="${esc(
    s.key
  )}">
  <label>Base URL (للمزوّد المتوافق مع OpenAI فقط)</label><input id="sb" dir="ltr" value="${esc(
    s.base
  )}">
  <label>أهدافي التعليمية (يقرأها المساعد في كل نقاش)</label><textarea id="sg" rows="3">${esc(
    s.goals
  )}</textarea>
  <label>الحد الأقصى للمشاريع قيد التنفيذ</label><input id="sx" type="number" min="1" value="${esc(
    s.maxDoing
  )}">
  <div class="bar" style="margin-top:14px"><button class="btn" onclick="saveSettings()">حفظ</button>
  <button class="btn g" onclick="backupIdeas()">نسخة احتياطية</button>
  <button class="btn g" onclick="const imp = document.getElementById('imp'); if(imp) imp.click()">استيراد</button><input id="imp" type="file" accept=".json" hidden onchange="if(this.files && this.files[0]) importFile(this.files[0])"></div>`;

  const sp = $('#sp') as HTMLSelectElement | null;
  if (sp) sp.value = s.provider;
  set.showModal();
}

export function saveSettings(): void {
  const sp = $('#sp') as HTMLSelectElement | null;
  const sm = $('#sm') as HTMLInputElement | null;
  const sk = $('#sk') as HTMLInputElement | null;
  const sb = $('#sb') as HTMLInputElement | null;
  const sg = $('#sg') as HTMLTextAreaElement | null;
  const sx = $('#sx') as HTMLInputElement | null;
  const set = $('#set') as HTMLDialogElement | null;

  S.settings = {
    provider: sp ? sp.value : 'gemini',
    model: sm ? sm.value.trim() : '',
    key: sk ? sk.value.trim() : '',
    base: sb ? sb.value.trim() : '',
    goals: sg ? sg.value.trim() : '',
    maxDoing: sx ? +sx.value || 2 : 2,
  };
  save(toast);
  if (set) set.close();
  home();
  toast('تم الحفظ');
}

export const backupIdeas = (): void => {
  dl('idea-vault-backup.json', JSON.stringify(S.ideas, null, 2), 'application/json');
};

export async function importFile(f: File): Promise<void> {
  const set = $('#set') as HTMLDialogElement | null;
  try {
    const arr = JSON.parse(await f.text());
    if (!Array.isArray(arr)) throw new Error('الملف ليس مصفوفة أفكار صالحة');
    const ids = new Set(S.ideas.map((i) => i.id));
    arr.forEach((i: any) => {
      if (!ids.has(i.id)) {
        S.ideas.push({
          id: i.id || crypto.randomUUID(),
          created: i.created || Date.now(),
          status: (STATUS[i.status as keyof typeof STATUS] ? i.status : 'idea') as any,
          notes: i.notes || '',
          ...norm(i),
        } as Idea);
      }
    });
    save(toast);
    if (set) set.close();
    home();
    toast('تم الاستيراد');
  } catch {
    toast('ملف غير صالح');
  }
}

// Bind functions to window so inline HTML onclick/onchange handlers work out of the box
export function setupWindowGlobals(): void {
  const g = window as any;
  g.MODELS = MODELS;
  g.TYPES = TYPES;
  g.STATUS = STATUS;
  g.FOCUS = FOCUS;
  g.S = S;
  g.filt = filt;
  g.toPrompt = toPrompt;
  g.toMD = toMD;
  g.home = home;
  g.grid = grid;
  g.newIdea = newIdea;
  g.paint = paint;
  g.send = send;
  g.finalize = finalize;
  g.openIdea = openIdea;
  g.copyPrompt = copyPrompt;
  g.upd = upd;
  g.tick = tick;
  g.del = del;
  g.exp = exp;
  g.openSettings = openSettings;
  g.saveSettings = saveSettings;
  g.backupIdeas = backupIdeas;
  g.importFile = importFile;
  g.toast = toast;
}
