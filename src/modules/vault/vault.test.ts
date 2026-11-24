// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { caps, mergeSettings } from '../../core';
import { S } from '../../store';
import {
  home,
  openIdea,
  openQuickCapture,
  saveQuickDraft,
  setupWindowGlobals,
  toggleSpeech,
  discussIdea,
  chat,
} from './ui';

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
  });
});
