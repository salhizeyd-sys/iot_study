// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bus, caps, mergeSettings, registry } from '../../core';
import { S } from '../../store';
import { vaultModule } from './index';
import {
  home,
  openIdea,
  openQuickCapture,
  saveQuickDraft,
  setupWindowGlobals,
  toggleSpeech,
  discussIdea,
  send,
  refreshProjectMemory,
  reviseProjectPlan,
  chat,
} from './ui';
import { mergeUpdatedPlan } from './logic';

describe('mobile UI & quick capture', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main id="app"></main>
      <nav class="bottom-nav">
        <button data-nav="home"></button>
        <button data-nav="new"></button>
        <button data-nav="quick"></button>
        <button data-nav="settings"></button>
      </nav>
      <dialog id="dlg"></dialog>
      <dialog id="set"></dialog>
      <dialog id="quick"></dialog>
      <div id="toast"></div>
    `;
    S.ideas = [];
    S.settings = mergeSettings();
    setupWindowGlobals();
  });

  it('hides speech dictation button when speech capability is unsupported', () => {
    caps.speech = false;
    openQuickCapture();
    expect(document.querySelector('#mic-btn')).toBeNull();
  });

  it('shows speech dictation button when speech capability is supported and uses configured speechLang', () => {
    caps.speech = true;
    S.settings.speechLang = 'ar-DZ';
    const startMock = vi.fn();
    let capturedLang = '';
    (window as any).SpeechRecognition = class {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: any = null;
      onerror: any = null;
      onend: any = null;
      start() {
        capturedLang = this.lang;
        startMock();
      }
      stop() {}
    };

    openQuickCapture();
    const micBtn = document.querySelector<HTMLButtonElement>('#mic-btn');
    expect(micBtn).not.toBeNull();
    toggleSpeech();
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(capturedLang).toBe('ar-DZ');
    toggleSpeech(); // clean up active speechSession
  });

  it('saves a quick draft offline and loads it later for discussion', () => {
    caps.speech = false;
    openQuickCapture();
    const titleInput = document.querySelector<HTMLInputElement>('#quick-title')!;
    const textInput = document.querySelector<HTMLTextAreaElement>('#quick-text')!;
    titleInput.value = 'محطة طقس ESP32';
    textInput.value = 'قياس الحرارة والرطوبة وإرسالها للمنصة';

    saveQuickDraft();

    expect(S.ideas).toHaveLength(1);
    expect(S.ideas[0].name).toBe('محطة طقس ESP32');
    expect(S.ideas[0].domain).toBe('مسودة');
    expect(S.ideas[0].status).toBe('idea');
    expect(S.ideas[0].chat).toEqual([
      { role: 'user', content: 'قياس الحرارة والرطوبة وإرسالها للمنصة' },
    ]);

    discussIdea(S.ideas[0].id);
    expect(chat).toEqual([
      { role: 'user', content: 'قياس الحرارة والرطوبة وإرسالها للمنصة' },
    ]);
  });

  it('renders hardware components in a responsive table with card labels', () => {
    S.ideas = [
      {
        id: 'hw-1',
        schemaVersion: 2,
        created: Date.now(),
        name: 'عقدة استشعار',
        domain: 'IoT',
        type: 'hardware',
        status: 'planned',
        lifecycle: 'planned',
        memory: '',
        problem: 'مراقبة',
        solution: 'ESP32 + DHT22',
        focus: 'aligned',
        focus_note: '',
        skills: ['ESP32'],
        duration: 'أسبوع',
        plan: [],
        components: [{ name: 'DHT22', qty: 1, note: 'GPIO4' }],
        notes: '',
      },
    ];

    home();
    openIdea('hw-1');
    const cells = document.querySelectorAll('table.responsive-table td');
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('data-label')).toBe('العنصر');
    expect(cells[1].getAttribute('data-label')).toBe('الكمية');
    expect(cells[2].getAttribute('data-label')).toBe('ملاحظة');
    expect(document.body.classList.contains('idea-modal-open')).toBe(true);
    expect(document.querySelector('#dlg [data-head-action="discuss"]')).not.toBeNull();
    expect(document.querySelector('#dlg [data-head-action="export-md"]')).not.toBeNull();
    expect(document.querySelector('#dlg [data-tab-id="plan"]')?.textContent).toContain('الخطة');
  });

  it('preserves completed plan steps and records plan_history in mergeUpdatedPlan', () => {
    const existing = [
      { step: 'شراء ESP32', detail: 'DevKit', done: true },
      { step: 'ربط الحساس', detail: 'مبدئي', done: false },
    ];
    const incoming = [
      { step: 'شراء ESP32', detail: 'مكرر', },
      { step: 'توصيل DHT22 على GPIO4', detail: 'مع مقاومة 10k' },
      { step: 'إرسال القراءات', detail: 'كل 5 ثوانٍ' },
    ];

    const { nextPlan, historyEntry } = mergeUpdatedPlan(existing, incoming, 12345);
    expect(historyEntry).toEqual({ savedAt: 12345, plan: existing });
    expect(nextPlan).toEqual([
      { step: 'شراء ESP32', detail: 'DevKit', done: true },
      { step: 'توصيل DHT22 على GPIO4', detail: 'مع مقاومة 10k', done: false },
      { step: 'إرسال القراءات', detail: 'كل 5 ثوانٍ', done: false },
    ]);
  });

  it('discusses project with full context, updates idea.chat, memory, and revises plan', async () => {
    S.settings.key = 'test-key';
    S.settings.provider = 'openai';
    S.ideas = [
      {
        id: 'proj-1',
        schemaVersion: 3,
        created: Date.now(),
        name: 'عقدة ري ذكية',
        domain: 'IoT',
        type: 'hardware',
        status: 'doing',
        lifecycle: 'planned',
        memory: 'تم اختيار صمام 12V.',
        problem: 'سقي النباتات آلياً',
        solution: 'حساس رطوبة تربة + ESP32',
        focus: 'aligned',
        focus_note: '',
        skills: ['ESP32'],
        duration: 'أسبوع',
        plan: [
          { step: 'تجهيز القطع', detail: 'ESP32', done: true },
          { step: 'توصيل الصمام', detail: 'عبر ترانزستور', done: false },
        ],
        plan_history: [],
        components: [{ name: 'Soil Sensor', qty: 1 }],
        notes: 'استخدام تغذية خارجية 12V للصمام.',
        chat: [],
      },
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'نعم، تغذية الصمام 12V خارجية عبر MOSFET.' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '- استخدام صمام 12V عبر MOSFET.' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"plan":[{"step":"توصيل الصمام عبر MOSFET","detail":"GPIO5"}]}',
              },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    discussIdea('proj-1');
    const inp = document.querySelector<HTMLTextAreaElement>('#inp')!;
    inp.value = 'ما الجهد المناسب للصمام؟';
    await send();

    // Verify system prompt included project context (memory + notes)
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.messages[0].content).toContain('تم اختيار صمام 12V.');
    expect(firstBody.messages[0].content).toContain('استخدام تغذية خارجية 12V للصمام.');
    expect(S.ideas[0].chat).toHaveLength(2);

    await refreshProjectMemory();
    expect(S.ideas[0].memory).toBe('- استخدام صمام 12V عبر MOSFET.');

    await reviseProjectPlan();
    expect(S.ideas[0].plan_history).toHaveLength(1);
    expect(S.ideas[0].plan).toEqual([
      { step: 'تجهيز القطع', detail: 'ESP32', done: true },
      { step: 'توصيل الصمام عبر MOSFET', detail: 'GPIO5', done: false },
    ]);

    registry.clear();
    bus.clear();
    registry.register(vaultModule);
    const unbind = registry.bindToBus(bus, () => S.settings);
    bus.emit('device:online', { deviceId: 'dev-1', ideaId: 'proj-1' });
    expect(S.ideas[0].lifecycle).toBe('online');
    expect(document.getElementById('toast')?.textContent).toContain('الجهاز متصل الآن');
    unbind();

    vi.unstubAllGlobals();
  });
});
