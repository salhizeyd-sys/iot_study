import {
  ChatMessage,
  FilterState,
  Idea,
  IdeaStatus,
  FOCUS,
  MODELS,
  STATUS,
  TYPES,
  bus,
  caps,
  mergeSettings,
  registry,
} from '../../core';
import {
  CURRENT_SCHEMA_VERSION,
  S,
  SyncStateSnapshot,
  isSupabaseConfigured,
  migrate,
  save,
  signInWithMagicLink,
  signOutSupabase,
  statusToLifecycle,
  store,
  syncManager,
} from '../../store';
import {
  IdeaCardSchema,
  PlanRevisionSchema,
  buildProjectContext,
  callLLM,
  parseStructuredWithRetry,
  summarizeProjectMemory,
} from '../../llm';
import {
  sysChat,
  sysPlan,
  sysProjectChat,
  sysUpdatePlan,
} from '../../prompts';
import { dl, toMD, toPrompt } from '../../export';
import { $, esc, toast } from '../../ui';
import { filterIdeas, mergeUpdatedPlan, norm } from './logic';
import { SpeechSession, startSpeechDictation } from './speech';

export const filt: FilterState = { q: '', type: '', domain: '' };
export let chat: ChatMessage[] = [];
let activeDraftId: string | null = null;
let activeIdeaModalId: string | null = null;
let activeIdeaTabId = 'plan';
let sessionNewMessages = 0;
let busy = false;
let speechSession: SpeechSession | null = null;

function setNavActive(name: 'home' | 'new' | 'quick' | 'settings'): void {
  document.querySelectorAll<HTMLButtonElement>('.bottom-nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });
}

function stopSpeechIfActive(): void {
  if (speechSession) {
    speechSession.stop();
    speechSession = null;
  }
  const micBtn = $('#mic-btn') as HTMLButtonElement | null;
  if (micBtn) {
    micBtn.classList.remove('rec');
    micBtn.textContent = '🎙️ إملاء صوتي';
  }
}

export function home(): void {
  setNavActive('home');
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
  const list = filterIdeas(S.ideas, filt);

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
        : 'مشاريعك في Sharara فارغة. اضغط «فكرة جديدة» أو «فكرة سريعة» وابدأ.'
    }</div>`;
}

export function newIdea(draftId?: string, initialText?: string): void {
  setNavActive('new');
  activeDraftId = draftId || null;
  sessionNewMessages = 0;
  const draft = draftId ? S.ideas.find((x) => x.id === draftId) : undefined;
  if (draft) {
    chat = draft.chat?.length
      ? draft.chat.map((m) => ({ ...m }))
      : !draft.plan?.length && draft.problem
        ? [{ role: 'user', content: draft.problem }]
        : [];
  } else {
    chat = [];
  }

  const app = $('#app');
  if (!app) return;

  const isExistingWithPlan = Boolean(draft && (draft.plan?.length || 0) > 0);
  const memoryBanner = draft?.memory?.trim()
    ? `<div class="warn" id="memory-banner"><b>🧠 ذاكرة المشروع:</b> ${esc(draft.memory)}</div>`
    : '';

  const actionButtons = isExistingWithPlan
    ? `<button class="btn" id="send" onclick="send()">إرسال</button>
       <button class="btn g" id="revise" onclick="reviseProjectPlan()">✏️ عدّل الخطة</button>
       <button class="btn g" id="mem-btn" onclick="refreshProjectMemory()">🧠 تحديث الذاكرة</button>`
    : `<button class="btn" id="send" onclick="send()">إرسال</button>
       <button class="btn g" id="fin" onclick="finalize()">حوّلها إلى خطة واحفظها</button>
       ${draft ? '<button class="btn g" id="mem-btn" onclick="refreshProjectMemory()">🧠 تحديث الذاكرة</button>' : ''}`;

  app.innerHTML = `<button class="btn g" onclick="exitDiscussion()">← Sharara</button><h2>${
    draft ? esc(draft.name) : 'فكرة جديدة'
  }</h2>
  ${memoryBanner}
  <div class="msgs" id="msgs"></div>
  <textarea id="inp" rows="3" placeholder="${
    draft
      ? 'اسأل المساعد عن أي تفصيل في المشروع أو اطلب تعديل الخطة…'
      : 'اشرح فكرتك بحرية، والمساعد سيسألك ويختبرها معك.'
  }">${initialText ? esc(initialText) : ''}</textarea>
  <div class="bar">${actionButtons}</div>`;
  paint();
}

export async function exitDiscussion(): Promise<void> {
  const projectId = activeDraftId;
  const shouldSummarize = Boolean(projectId && sessionNewMessages > 0);
  activeDraftId = null;
  sessionNewMessages = 0;

  if (shouldSummarize && projectId) {
    const idea = S.ideas.find((x) => x.id === projectId);
    const hasKeyOrLocal =
      Boolean(S.settings.key) || /localhost|127\.0\.0\.1/.test(S.settings.base);
    if (idea && hasKeyOrLocal) {
      summarizeProjectMemory(idea, chat)
        .then((summary) => {
          if (summary) {
            idea.memory = summary;
            save(toast);
            bus.emit('idea:updated', { ideaId: idea.id });
          }
        })
        .catch(() => {
          // Keep existing memory silently if offline or rate-limited
        });
    }
  }

  home();
}

export function paint(): void {
  const m = $('#msgs');
  if (!m) return;
  m.innerHTML = chat.length
    ? chat.map((c) => `<div class="m ${c.role}">${esc(c.content)}</div>`).join('')
    : '<div class="empty">ابدأ بوصف الفكرة. سأذكّرك بأهدافك: ' + esc(S.settings.goals) + '</div>';
  m.lastElementChild?.scrollIntoView?.({ block: 'end' });
}

export async function guard(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll<HTMLButtonElement>('#send,#fin,#revise,#mem-btn')
    .forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e: any) {
    toast('⚠️ ' + (e?.message || 'حدث خطأ'));
  }
  busy = false;
  document
    .querySelectorAll<HTMLButtonElement>('#send,#fin,#revise,#mem-btn')
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

    const activeIdea = activeDraftId
      ? S.ideas.find((x) => x.id === activeDraftId)
      : undefined;
    const systemPrompt = activeIdea
      ? sysProjectChat(
          buildProjectContext(activeIdea, {
            tokenBudget: S.settings.contextBudget,
          })
        )
      : sysChat();

    try {
      const resp = await callLLM(chat, systemPrompt);
      chat.push({ role: 'assistant', content: resp });
      sessionNewMessages += 1;
      if (activeIdea) {
        activeIdea.chat = chat.slice();
        save(toast);
        bus.emit('idea:updated', { ideaId: activeIdea.id });
      }
    } catch (e) {
      chat.pop();
      inp.value = t;
      throw e;
    }
    paint();
  });

export const refreshProjectMemory = () =>
  guard(async () => {
    if (!activeDraftId) return;
    const idea = S.ideas.find((x) => x.id === activeDraftId);
    if (!idea) return;
    toast('جارٍ تحديث ذاكرة المشروع…');
    const summary = await summarizeProjectMemory(idea, chat);
    if (summary) {
      idea.memory = summary;
      idea.chat = chat.slice();
      sessionNewMessages = 0;
      save(toast);
      bus.emit('idea:updated', { ideaId: idea.id });
      const banner = $('#memory-banner');
      if (banner) {
        banner.innerHTML = `<b>🧠 ذاكرة المشروع:</b> ${esc(idea.memory)}`;
      }
      toast('تم تحديث ذاكرة المشروع');
    }
  });

async function applyPlanRevision(idea: Idea, messages: ChatMessage[]): Promise<void> {
  toast('جارٍ تعديل الخطة مع الحفاظ على الخطوات المنجزة…');
  const ctx = buildProjectContext(idea, {
    tokenBudget: S.settings.contextBudget,
  });
  const completedSteps = (idea.plan || []).filter((p) => p.done);
  const promptMessages: ChatMessage[] = [
    ...messages,
    {
      role: 'user',
      content: 'عدّل الخطة المتبقية وأخرج JSON فقط بصيغة {"plan":[{"step":"","detail":""}]}.',
    },
  ];
  const system = sysUpdatePlan(ctx, completedSteps);
  const firstRaw = await callLLM(promptMessages, system);
  const validated = await parseStructuredWithRetry(
    PlanRevisionSchema,
    firstRaw,
    (err) =>
      callLLM(
        [
          ...promptMessages,
          { role: 'assistant', content: firstRaw },
          {
            role: 'user',
            content: `أصلح صيغة JSON وفق المخطط المطلوب (${err}) وأخرج JSON فقط.`,
          },
        ],
        system
      )
  );
  const { nextPlan, historyEntry } = mergeUpdatedPlan(idea.plan || [], validated.plan);
  idea.plan_history = [...(idea.plan_history || []), historyEntry];
  idea.plan = nextPlan;
  idea.chat = messages.slice();
  save(toast);
  bus.emit('idea:updated', { ideaId: idea.id });
}

export const reviseProjectPlan = () =>
  guard(async () => {
    if (!activeDraftId) return;
    const idea = S.ideas.find((x) => x.id === activeDraftId);
    if (!idea) return;
    await applyPlanRevision(idea, chat);
    toast('تم تعديل الخطة وحفظ النسخة السابقة');
    openIdea(idea.id);
  });

export const reviseProjectPlanFromModal = (id: string) =>
  guard(async () => {
    const idea = S.ideas.find((x) => x.id === id);
    if (!idea) return;
    await applyPlanRevision(idea, idea.chat || []);
    toast('تم تعديل الخطة وحفظ النسخة السابقة');
    openIdea(id);
  });

export const finalize = () =>
  guard(async () => {
    if (!chat.length) return toast('ناقش الفكرة أولاً');
    toast('جارٍ بناء الخطة…');
    const promptMessages: ChatMessage[] = [
      ...chat,
      {
        role: 'user',
        content: 'حوّل نقاشنا إلى بطاقة المشروع النهائية بصيغة JSON فقط.',
      },
    ];
    const system = sysPlan();
    const r = await callLLM(promptMessages, system);
    const validated = await parseStructuredWithRetry(
      IdeaCardSchema,
      r,
      (err) =>
        callLLM(
          [
            ...promptMessages,
            { role: 'assistant', content: r },
            {
              role: 'user',
              content: `استجابتك السابقة غير مكتملة (${err}). أخرج بطاقة المشروع بصيغة JSON فقط.`,
            },
          ],
          system
        )
    );
    const normalized = norm(validated);
    const existing = activeDraftId
      ? S.ideas.find((x) => x.id === activeDraftId)
      : undefined;

    let savedId: string;
    if (existing) {
      Object.assign(existing, normalized, {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        status: existing.status === 'idea' ? 'planned' : existing.status,
        lifecycle: existing.lifecycle === 'idea' ? 'planned' : existing.lifecycle,
        chat: chat.slice(),
      });
      savedId = existing.id;
      bus.emit('idea:updated', { ideaId: savedId });
    } else {
      const idea: Idea = {
        id: crypto.randomUUID(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        created: Date.now(),
        status: 'idea',
        lifecycle: 'idea',
        memory: '',
        plan_history: [],
        notes: '',
        chat: chat.slice(),
        ...normalized,
      };
      S.ideas.unshift(idea);
      savedId = idea.id;
      bus.emit('idea:created', { ideaId: savedId });
    }

    save(toast);
    chat = [];
    activeDraftId = null;
    sessionNewMessages = 0;
    home();
    openIdea(savedId);
  });

export function openQuickCapture(): void {
  setNavActive('quick');
  const qdlg = $('#quick') as HTMLDialogElement | null;
  if (!qdlg) return;
  stopSpeechIfActive();

  const speechBtnHtml = caps.speech
    ? `<button type="button" class="btn g" id="mic-btn" onclick="toggleSpeech()">🎙️ إملاء صوتي</button>`
    : '';

  qdlg.innerHTML = `
  <div class="bar" style="justify-content:space-between">
    <h2 style="margin:0">⚡ فكرة سريعة</h2>
    <button type="button" class="btn g" onclick="closeQuickCapture()" aria-label="إغلاق">✕</button>
  </div>
  <label for="quick-title">اسم مختصر (اختياري)</label>
  <input id="quick-title" placeholder="مثال: حسّاس ري ذكي للحديقة">
  <label for="quick-text">وصف الفكرة أو الملاحظة الصوتية</label>
  <textarea id="quick-text" rows="4" placeholder="اكتب فكرتك بسرعة أو استخدم الإملاء الصوتي لحفظها كمسودة دون إنترنت…"></textarea>
  <div class="bar">
    ${speechBtnHtml}
    <button type="button" class="btn" onclick="saveQuickDraft()">حفظ كمسودة</button>
    <button type="button" class="btn g" onclick="discussQuickDraft()">ناقشها الآن</button>
  </div>`;

  if (typeof qdlg.showModal === 'function') {
    qdlg.showModal();
  }
}

export function closeQuickCapture(): void {
  stopSpeechIfActive();
  const qdlg = $('#quick') as HTMLDialogElement | null;
  if (qdlg && typeof qdlg.close === 'function') {
    qdlg.close();
  }
  setNavActive('home');
}

export function toggleSpeech(): void {
  const micBtn = $('#mic-btn') as HTMLButtonElement | null;
  if (speechSession) {
    stopSpeechIfActive();
    return;
  }

  if (micBtn) {
    micBtn.classList.add('rec');
    micBtn.textContent = '⏹️ إيقاف الاستماع';
  }

  const session = startSpeechDictation(S.settings.speechLang || 'ar-SA', {
    onTranscript: (text) => {
      const box = $('#quick-text') as HTMLTextAreaElement | null;
      if (box) {
        box.value = box.value.trim() ? `${box.value.trim()} ${text}` : text;
      }
    },
    onError: (msg) => {
      toast('⚠️ ' + msg);
      stopSpeechIfActive();
    },
    onEnd: () => {
      speechSession = null;
      if (micBtn) {
        micBtn.classList.remove('rec');
        micBtn.textContent = '🎙️ إملاء صوتي';
      }
    },
  });

  if (!session) {
    stopSpeechIfActive();
  } else {
    speechSession = session;
  }
}

export function saveQuickDraft(): void {
  const titleEl = $('#quick-title') as HTMLInputElement | null;
  const textEl = $('#quick-text') as HTMLTextAreaElement | null;
  const rawText = textEl?.value.trim() || '';
  const rawTitle = titleEl?.value.trim() || '';

  if (!rawText && !rawTitle) {
    toast('اكتب فكرة أولاً');
    return;
  }

  const fallbackName = rawText.split(/\s+/).slice(0, 6).join(' ');
  const name = rawTitle || (fallbackName.length < rawText.length ? `${fallbackName}…` : fallbackName) || 'مسودة فكرة';

  const draft: Idea = {
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    created: Date.now(),
    name,
    domain: 'مسودة',
    type: 'both',
    status: 'idea',
    lifecycle: 'idea',
    memory: '',
    problem: rawText || rawTitle,
    solution: '',
    focus: 'partial',
    focus_note: 'مسودة سريعة بانتظار النقاش',
    skills: [],
    duration: '',
    plan: [],
    plan_history: [],
    components: [],
    notes: '',
    chat: rawText ? [{ role: 'user', content: rawText }] : [],
  };

  S.ideas.unshift(draft);
  save(toast);
  bus.emit('idea:created', { ideaId: draft.id });
  closeQuickCapture();
  home();
  toast('تم حفظ المسودة دون إنترنت');
}

export function discussQuickDraft(): void {
  const textEl = $('#quick-text') as HTMLTextAreaElement | null;
  const rawText = textEl?.value.trim() || '';
  closeQuickCapture();
  newIdea(undefined, rawText);
}

export function openIdea(id: string, requestedTabId?: string): void {
  const dlg = $('#dlg') as HTMLDialogElement | null;
  if (!dlg) return;
  const i = S.ideas.find((x) => x.id === id);
  if (!i) return;

  const f = FOCUS[i.focus] || ['غير محدد', 'wn'];
  const extraTabs = registry.getIdeaTabs(i, S.settings);
  const allTabs = [
    { id: 'plan', title: '📋 الخطة' },
    ...extraTabs.map((t) => ({ id: t.id, title: t.title })),
  ];

  if (requestedTabId && allTabs.some((t) => t.id === requestedTabId)) {
    activeIdeaTabId = requestedTabId;
  } else if (activeIdeaModalId !== id || !allTabs.some((t) => t.id === activeIdeaTabId)) {
    activeIdeaTabId = 'plan';
  }
  activeIdeaModalId = id;

  const historyCount = i.plan_history?.length || 0;

  dlg.innerHTML = `
  <div class="idea-modal-sticky">
    <div class="idea-modal-head">
      <h2 class="idea-modal-title">${esc(i.name)}</h2>
      <div class="idea-modal-head-actions">
        <button type="button" class="btn" data-head-action="discuss" onclick="discussIdea('${id}')">💬 ناقش هذا المشروع</button>
        <button type="button" class="btn g" data-head-action="export-md" onclick="exp('${id}','md')">📄 .md</button>
      </div>
      <button type="button" class="btn g idea-close-btn" onclick="dlg.close()" aria-label="إغلاق">✕</button>
    </div>
    <div class="idea-tabs" role="tablist" aria-label="أقسام المشروع">
      ${allTabs
        .map(
          (tab) => `<button type="button" role="tab" class="idea-tab-btn${
            tab.id === activeIdeaTabId ? ' active' : ''
          }" data-tab-id="${esc(tab.id)}" aria-selected="${
            tab.id === activeIdeaTabId ? 'true' : 'false'
          }">${esc(tab.title)}</button>`
        )
        .join('')}
    </div>
  </div>

  <div class="idea-tab-panels">
    <section role="tabpanel" data-panel-id="plan"${activeIdeaTabId === 'plan' ? '' : ' hidden'}>
      <div class="bar" style="margin-top:0">
        <span class="tag">${esc(i.domain)}</span><span class="tag">${
          TYPES[i.type] || i.type
        }</span><span class="tag ${f[1]}">${f[0]}</span>${
          i.duration ? `<span class="tag">${esc(i.duration)}</span>` : ''
        }
      </div>
      ${i.focus_note ? `<p style="color:var(--mu);margin:6px 0">${esc(i.focus_note)}</p>` : ''}
      ${
        i.memory?.trim()
          ? `<div class="warn"><b>🧠 ذاكرة المشروع:</b><div style="white-space:pre-wrap;margin-top:4px">${esc(
              i.memory
            )}</div></div>`
          : ''
      }
      <label>الحالة</label><select onchange="upd('${id}','status',this.value)">${Object.entries(
        STATUS
      )
        .map(
          ([k, v]) =>
            `<option value="${k}" ${i.status === k ? 'selected' : ''}>${v}</option>`
        )
        .join('')}</select>
      <h3>المشكلة</h3><div>${esc(i.problem)}</div><h3>الحل</h3><div>${esc(i.solution)}</div>
      ${
        i.skills && i.skills.length
          ? `<h3>المهارات المطلوبة</h3><ul>${i.skills
              .map((s) => `<li>${esc(s)}</li>`)
              .join('')}</ul>`
          : ''
      }
      <div class="bar" style="justify-content:space-between;margin-top:14px">
        <h3 style="margin:0">خطة التنفيذ${
          historyCount ? ` <span class="tag">سجل التعديلات: ${historyCount}</span>` : ''
        }</h3>
        ${
          i.plan?.length
            ? `<button type="button" class="btn g" onclick="reviseProjectPlanFromModal('${id}')">✏️ عدّل الخطة</button>`
            : ''
        }
      </div>
      ${(i.plan || [])
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
        .join('') || '<p style="color:var(--mu)">لا خطة بعد — اضغط «💬 ناقش هذا المشروع» لتحويل المسودة إلى خطة.</p>'}
      ${
        i.components && i.components.length
          ? `<h3>العناصر المطلوبة</h3><table class="responsive-table"><thead><tr><th>العنصر</th><th>الكمية</th><th>ملاحظة</th></tr></thead><tbody>${i.components
              .map(
                (c) =>
                  `<tr><td data-label="العنصر">${esc(c.name)}</td><td data-label="الكمية">${esc(
                    c.qty || 1
                  )}</td><td data-label="ملاحظة">${esc(c.note || '—')}</td></tr>`
              )
              .join('')}</tbody></table>`
          : ''
      }
      <label>ملاحظاتي</label><textarea rows="3" onchange="upd('${id}','notes',this.value)">${esc(
        i.notes
      )}</textarea>
      <div class="bar" style="margin-top:14px">
        <button type="button" class="btn g" onclick="copyPrompt('${id}')">نسخ كبرومبت لمساعد آخر</button>
        <button type="button" class="btn g" onclick="exp('${id}','json')">تصدير .json</button>
        <button type="button" class="btn d" onclick="del('${id}')">حذف</button>
      </div>
    </section>
  </div>`;

  const panelsHost = dlg.querySelector('.idea-tab-panels');
  if (panelsHost) {
    for (const tab of extraTabs) {
      const panel = document.createElement('section');
      panel.setAttribute('role', 'tabpanel');
      panel.dataset.panelId = tab.id;
      if (tab.id !== activeIdeaTabId) {
        panel.hidden = true;
      }
      panel.appendChild(tab.render(i));
      panelsHost.appendChild(panel);
    }
  }

  const selectIdeaTab = (nextId: string) => {
    activeIdeaTabId = nextId;
    dlg.querySelectorAll<HTMLButtonElement>('[data-tab-id]').forEach((btn) => {
      const active = btn.dataset.tabId === nextId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    dlg.querySelectorAll<HTMLElement>('[data-panel-id]').forEach((panel) => {
      panel.hidden = panel.dataset.panelId !== nextId;
    });
  };

  dlg.querySelectorAll<HTMLButtonElement>('[data-tab-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tabId) selectIdeaTab(btn.dataset.tabId);
    });
  });

  document.body.classList.add('idea-modal-open');
  dlg.onclose = () => {
    document.body.classList.remove('idea-modal-open');
  };

  if (typeof dlg.showModal === 'function' && !dlg.open) {
    dlg.showModal();
  }
}

export function discussIdea(id: string): void {
  const dlg = $('#dlg') as HTMLDialogElement | null;
  if (dlg && typeof dlg.close === 'function') dlg.close();
  document.body.classList.remove('idea-modal-open');
  newIdea(id);
}

export const copyPrompt = async (id: string): Promise<void> => {
  const i = S.ideas.find((x) => x.id === id);
  if (!i) return;
  const proto = await store.getLatestPrototype(id);
  await navigator.clipboard.writeText(toPrompt(i, proto));
  toast('نُسخ كبرومبت جاهز');
};

export const upd = (id: string, k: keyof Idea, v: any): void => {
  const item = S.ideas.find((x) => x.id === id);
  if (!item) return;
  (item as any)[k] = v;
  if (k === 'status') {
    const newStatus = v as IdeaStatus;
    item.lifecycle = statusToLifecycle(newStatus);
    bus.emit('idea:status-changed', {
      ideaId: id,
      status: newStatus,
      lifecycle: item.lifecycle,
    });
  } else {
    bus.emit('idea:updated', { ideaId: id });
  }
  save(toast);
  home();
};

export const tick = (id: string, n: number, v: boolean): void => {
  const item = S.ideas.find((x) => x.id === id);
  if (!item || !item.plan || !item.plan[n]) return;
  item.plan[n].done = v;
  save(toast);
  bus.emit('idea:updated', { ideaId: id });
  home();
  openIdea(id);
};

export const del = (id: string): void => {
  if (confirm('حذف الفكرة نهائياً؟')) {
    S.ideas = S.ideas.filter((x) => x.id !== id);
    save(toast);
    bus.emit('idea:deleted', { ideaId: id });
    const dlg = $('#dlg') as HTMLDialogElement | null;
    if (dlg) dlg.close();
    document.body.classList.remove('idea-modal-open');
    home();
  }
};

export const exp = async (id: string, t: 'md' | 'json'): Promise<void> => {
  const i = S.ideas.find((x) => x.id === id);
  if (!i) return;
  const n = i.name.replace(/[^\w\u0600-\u06FF]+/g, '-');
  if (t === 'md') {
    const proto = await store.getLatestPrototype(id);
    dl(n + '.md', toMD(i, proto));
  } else {
    dl(n + '.json', JSON.stringify(i, null, 2), 'application/json');
  }
};

export function renderSyncPill(snap: SyncStateSnapshot): void {
  const pill = $('#sync-pill');
  if (!pill) return;

  pill.className = 'sync-pill';
  if (!isSupabaseConfigured()) {
    pill.textContent = '⚪ محلي';
    return;
  }
  if (!snap.user) {
    pill.textContent = '🔑 دخول للمزامنة';
    return;
  }
  if (snap.status === 'synced') {
    pill.classList.add('ok');
    pill.textContent = '🟢 متزامن';
  } else if (snap.status === 'syncing') {
    pill.classList.add('wn');
    pill.textContent = '🔄 يزامن…';
  } else if (snap.status === 'pending') {
    pill.classList.add('wn');
    pill.textContent = `🟡 بانتظار المزامنة (${snap.pendingCount})`;
  } else if (snap.status === 'offline') {
    pill.classList.add('wn');
    pill.textContent = snap.pendingCount
      ? `🟠 غير متصل (${snap.pendingCount})`
      : '🟠 غير متصل';
  } else if (snap.status === 'error') {
    pill.classList.add('er');
    pill.textContent = '🔴 تعذّر التزامن';
  } else {
    pill.textContent = '⚪ محلي';
  }
}

export function openSettings(): void {
  setNavActive('settings');
  const set = $('#set') as HTMLDialogElement | null;
  if (!set) return;
  const s = S.settings;
  const syncSnap = syncManager.getSnapshot();
  const supaReady = isSupabaseConfigured();

  let accountHtml = '';
  if (!supaReady) {
    accountHtml = `<div class="warn"><b>☁️ المزامنة السحابية (Supabase):</b> غير مفعّلة محلياً بعد (أضف <code>VITE_SUPABASE_URL</code> و<code>VITE_SUPABASE_ANON_KEY</code>).</div>`;
  } else if (!syncSnap.user) {
    accountHtml = `<div class="warn" id="auth-box">
      <b>☁️ الحساب والمزامنة (Magic Link)</b>
      <label for="auth-email">البريد الإلكتروني</label>
      <div class="bar" style="margin-bottom:0">
        <input id="auth-email" type="email" dir="ltr" placeholder="name@example.com">
        <button type="button" class="btn" id="magic-btn" onclick="sendMagicLink()">✉️ إرسال رابط الدخول</button>
      </div>
    </div>`;
  } else {
    accountHtml = `<div class="warn" id="auth-box">
      <div><b>☁️ متصل بحساب:</b> <span dir="ltr">${esc(syncSnap.user.email || syncSnap.user.id)}</span></div>
      <div class="bar" style="margin-bottom:0">
        <button type="button" class="btn" onclick="uploadLocalIdeas()">⬆️ ارفع أفكاري المحلية</button>
        <button type="button" class="btn g" onclick="syncNow()">🔄 مزامنة الآن</button>
        <button type="button" class="btn d" onclick="logoutSupabase()">🚪 تسجيل الخروج</button>
      </div>
    </div>`;
  }

  const proxyActive = Boolean(supaReady && syncSnap.user);
  const apiKeyHtml = proxyActive
    ? `<div class="warn" id="proxy-key-notice">🔒 مفتاح الـ AI محفوظ بأمان داخل Supabase (<code>llm-proxy</code>) ولا يُخزَّن أو يُرسَل من المتصفح.</div>`
    : `<label>مفتاح API (يبقى في متصفحك فقط)</label><input id="sk" type="password" value="${esc(
        s.key
      )}">
       <label>Base URL (للمزوّد المتوافق مع OpenAI فقط)</label><input id="sb" dir="ltr" value="${esc(
         s.base
       )}">`;

  set.innerHTML = `<div class="bar" style="justify-content:space-between"><h2 style="margin:0">الإعدادات</h2><button class="btn g" onclick="set.close()" aria-label="إغلاق">✕</button></div>
  ${accountHtml}
  <label>المزوّد</label><select id="sp" onchange="const sm = document.getElementById('sm'); if(sm) sm.value=MODELS[this.value]||''"><option value="gemini">Gemini</option><option value="openai">OpenAI / متوافق (OpenRouter, Groq, Ollama)</option><option value="anthropic">Anthropic</option></select>
  <label>النموذج</label><input id="sm" value="${esc(s.model)}">
  ${apiKeyHtml}
  <label>أهدافي التعليمية (يقرأها المساعد في كل نقاش)</label><textarea id="sg" rows="3">${esc(
    s.goals
  )}</textarea>
  <label>الحد الأقصى للمشاريع قيد التنفيذ</label><input id="sx" type="number" min="1" value="${esc(
    s.maxDoing
  )}">
  <label>ميزانية سياق المساعد (Tokens)</label><input id="scb" type="number" min="200" step="100" value="${esc(
    s.contextBudget
  )}">
  <label>لغة الإملاء الصوتي</label><select id="sl">
    <option value="ar-SA" ${s.speechLang === 'ar-SA' ? 'selected' : ''}>العربية (السعودية / عام - ar-SA)</option>
    <option value="ar-DZ" ${s.speechLang === 'ar-DZ' ? 'selected' : ''}>العربية (الجزائر - ar-DZ)</option>
    <option value="ar-EG" ${s.speechLang === 'ar-EG' ? 'selected' : ''}>العربية (مصر - ar-EG)</option>
    <option value="ar-MA" ${s.speechLang === 'ar-MA' ? 'selected' : ''}>العربية (المغرب - ar-MA)</option>
    <option value="en-US" ${s.speechLang === 'en-US' ? 'selected' : ''}>English (en-US)</option>
    <option value="fr-FR" ${s.speechLang === 'fr-FR' ? 'selected' : ''}>Français (fr-FR)</option>
  </select>
  <div class="bar" style="margin-top:14px"><button class="btn" onclick="saveSettings()">حفظ</button>
  <button class="btn g" onclick="backupIdeas()">نسخة احتياطية</button>
  <button class="btn g" onclick="const imp = document.getElementById('imp'); if(imp) imp.click()">استيراد</button><input id="imp" type="file" accept=".json" hidden onchange="if(this.files && this.files[0]) importFile(this.files[0])"></div>`;

  const sp = $('#sp') as HTMLSelectElement | null;
  if (sp) sp.value = s.provider;
  if (typeof set.showModal === 'function') {
    set.showModal();
  }
}

export function saveSettings(): void {
  const sp = $('#sp') as HTMLSelectElement | null;
  const sm = $('#sm') as HTMLInputElement | null;
  const sk = $('#sk') as HTMLInputElement | null;
  const sb = $('#sb') as HTMLInputElement | null;
  const sg = $('#sg') as HTMLTextAreaElement | null;
  const sx = $('#sx') as HTMLInputElement | null;
  const scb = $('#scb') as HTMLInputElement | null;
  const sl = $('#sl') as HTMLSelectElement | null;
  const set = $('#set') as HTMLDialogElement | null;

  const proxyActive = Boolean(isSupabaseConfigured() && syncManager.getSnapshot().user);

  S.settings = mergeSettings({
    ...S.settings,
    provider: sp ? sp.value : 'gemini',
    model: sm ? sm.value.trim() : '',
    key: proxyActive ? '' : sk ? sk.value.trim() : '',
    base: sb ? sb.value.trim() : S.settings.base,
    goals: sg ? sg.value.trim() : '',
    maxDoing: sx ? +sx.value || 2 : 2,
    contextBudget: scb ? +scb.value || 1600 : 1600,
    speechLang: sl ? sl.value : 'ar-SA',
  });
  save(toast);
  bus.emit('settings:changed', { settings: S.settings });
  if (set && typeof set.close === 'function') set.close();
  home();
  toast('تم الحفظ');
}

export const backupIdeas = (): void => {
  dl('idea-vault-backup.json', JSON.stringify(S.ideas, null, 2), 'application/json');
};

export async function sendMagicLink(): Promise<void> {
  const emailEl = $('#auth-email') as HTMLInputElement | null;
  const btn = $('#magic-btn') as HTMLButtonElement | null;
  const email = emailEl?.value.trim() || '';
  if (!email) {
    toast('أدخل البريد الإلكتروني أولاً');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    await signInWithMagicLink(email);
    toast('أُرسل رابط الدخول إلى بريدك الإلكتروني');
  } catch (e: any) {
    toast('⚠️ ' + (e?.message || 'تعذّر إرسال رابط الدخول'));
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function uploadLocalIdeas(): Promise<void> {
  toast('جارٍ رفع أفكارك المحلية بدون تكرار…');
  try {
    const res = await syncManager.uploadLocalData();
    home();
    toast(`تم رفع ${res.ideasUploaded} فكرة و${res.prototypesUploaded} نموذجاً`);
  } catch (e: any) {
    toast('⚠️ ' + (e?.message || 'تعذّر رفع البيانات'));
  }
}

export async function syncNow(): Promise<void> {
  toast('جارٍ المزامنة…');
  try {
    await syncManager.flushOutbox();
    await syncManager.pullFromRemote();
    home();
    toast('اكتملت المزامنة');
  } catch (e: any) {
    toast('⚠️ ' + (e?.message || 'تعذّرت المزامنة'));
  }
}

export async function logoutSupabase(): Promise<void> {
  try {
    await signOutSupabase();
    await syncManager.setUser(null);
    openSettings();
    toast('تم تسجيل الخروج (بياناتك المحلية محفوظة)');
  } catch (e: any) {
    toast('⚠️ ' + (e?.message || 'تعذّر تسجيل الخروج'));
  }
}

export async function importFile(f: File): Promise<void> {
  const set = $('#set') as HTMLDialogElement | null;
  try {
    const arr = JSON.parse(await f.text());
    if (!Array.isArray(arr)) throw new Error('الملف ليس مصفوفة أفكار صالحة');
    const ids = new Set(S.ideas.map((i) => i.id));
    arr.forEach((raw: any) => {
      if (!ids.has(raw.id)) {
        S.ideas.push(migrate(raw));
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
  g.exitDiscussion = exitDiscussion;
  g.paint = paint;
  g.send = send;
  g.refreshProjectMemory = refreshProjectMemory;
  g.reviseProjectPlan = reviseProjectPlan;
  g.reviseProjectPlanFromModal = reviseProjectPlanFromModal;
  g.finalize = finalize;
  g.openIdea = openIdea;
  g.discussIdea = discussIdea;
  g.openQuickCapture = openQuickCapture;
  g.closeQuickCapture = closeQuickCapture;
  g.toggleSpeech = toggleSpeech;
  g.saveQuickDraft = saveQuickDraft;
  g.discussQuickDraft = discussQuickDraft;
  g.copyPrompt = copyPrompt;
  g.upd = upd;
  g.tick = tick;
  g.del = del;
  g.exp = exp;
  g.openSettings = openSettings;
  g.saveSettings = saveSettings;
  g.backupIdeas = backupIdeas;
  g.importFile = importFile;
  g.sendMagicLink = sendMagicLink;
  g.uploadLocalIdeas = uploadLocalIdeas;
  g.syncNow = syncNow;
  g.logoutSupabase = logoutSupabase;
  g.toast = toast;
}
