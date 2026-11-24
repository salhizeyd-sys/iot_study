import {
  Idea,
  PrototypeRecord,
  caps,
} from '../../../core';
import { S, store } from '../../../store';
import { esc, toast } from '../../../ui';
import { computePrototypeDiff, generatePrototype } from './generator';
import { checkEsp32Pins } from './pinChecker';

export function renderPrototypeTab(idea: Idea): HTMLElement {
  const root = document.createElement('div');
  root.className = 'proto-tab';
  root.innerHTML = `<p style="color:var(--mu)">جارٍ تحميل بيانات النموذج الأولي…</p>`;

  let selectedRevIndex = 0;
  let selectedFileIndex = 0;
  let disposeMonaco: (() => void) | null = null;

  async function paint() {
    if (disposeMonaco) {
      disposeMonaco();
      disposeMonaco = null;
    }

    const revisions = await store.listPrototypes(idea.id);
    if (!revisions.length) {
      root.innerHTML = `
        <div class="warn">
          لا يوجد نموذج أولي (ESP32) لهذه الفكرة بعد.
          <div class="bar" style="margin-bottom:0">
            <button type="button" class="btn" data-action="generate">⚡ توليد نموذج أولي (ESP32)</button>
          </div>
        </div>`;

      root.querySelector('[data-action="generate"]')?.addEventListener('click', () => {
        void handleGenerate();
      });
      return;
    }

    if (selectedRevIndex >= revisions.length) selectedRevIndex = 0;
    const current: PrototypeRecord = revisions[selectedRevIndex];
    const previous: PrototypeRecord | undefined = revisions[selectedRevIndex + 1];
    const d = current.data;
    const pinCheck = checkEsp32Pins(d.wiring);

    const files = d.firmware.files;
    if (selectedFileIndex >= files.length) selectedFileIndex = 0;
    const activeFile = files[selectedFileIndex] || files[0];

    const diff = previous ? computePrototypeDiff(previous.data, d) : null;
    const diffLines = diff
      ? [
          ...diff.wiringChanges,
          ...diff.firmwareChanges,
          ...diff.dashboardChanges,
          ...diff.warningChanges,
        ]
      : [];

    root.innerHTML = `
      <div class="bar" style="justify-content:space-between">
        <div>
          <span class="tag">النسخة v${current.revision}</span>
          <span class="tag">${esc(d.board.fqbn)}</span>
          ${d.board.ota ? '<span class="tag ok">OTA مدعوم</span>' : ''}
          <span class="tag ${pinCheck.valid ? 'ok' : 'er'}">${
            pinCheck.valid ? 'فحص الأرجل: سليم' : 'فحص الأرجل: يوجد تعارض'
          }</span>
        </div>
        ${
          revisions.length > 1
            ? `<select data-role="rev-select" style="width:auto">${revisions
                .map(
                  (r, idx) =>
                    `<option value="${idx}" ${idx === selectedRevIndex ? 'selected' : ''}>v${r.revision}${
                      r.change_summary ? ' — ' + esc(r.change_summary) : ''
                    }</option>`
                )
                .join('')}</select>`
            : ''
        }
      </div>

      ${
        diff && diffLines.length
          ? `<details class="warn" style="margin:8px 0">
              <summary><b>الفروقات عن النسخة v${previous!.revision} (${diffLines.length})</b></summary>
              <ul>${diffLines.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
            </details>`
          : ''
      }

      ${
        pinCheck.issues.length
          ? `<div class="warn">
              <b>فاحص أرجل ESP32:</b>
              <ul>${pinCheck.issues
                .map(
                  (iss) =>
                    `<li><span class="tag ${iss.severity === 'error' ? 'er' : 'wn'}">${
                      iss.severity === 'error' ? 'خطأ' : 'تنبيه'
                    }</span> ${esc(iss.message)}</li>`
                )
                .join('')}</ul>
            </div>`
          : ''
      }

      ${
        d.warnings.length
          ? `<div class="warn">
              <b>تحذيرات للمراجعة البشرية:</b>
              <ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
            </div>`
          : ''
      }

      <h3>التوصيل (Wiring)</h3>
      <table class="responsive-table">
        <thead>
          <tr><th>القطعة</th><th>طرف القطعة</th><th>رجل ESP32</th><th>ملاحظة</th></tr>
        </thead>
        <tbody>
          ${d.wiring
            .map(
              (w) => `<tr>
                <td data-label="القطعة">${esc(w.part)}</td>
                <td data-label="طرف القطعة">${esc(w.part_pin)}</td>
                <td data-label="رجل ESP32"><code>${esc(w.mcu_pin)}</code></td>
                <td data-label="ملاحظة">${esc(w.note || '—')}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>

      <h3>الكود البرمجي${
        d.firmware.libraries.length
          ? ` <span class="tag">المكتبات: ${esc(d.firmware.libraries.join('، '))}</span>`
          : ''
      }</h3>
      <div class="bar">
        ${files
          .map(
            (f, idx) =>
              `<button type="button" class="btn ${
                idx === selectedFileIndex ? '' : 'g'
              }" data-file-idx="${idx}">${esc(f.name)}</button>`
          )
          .join('')}
        <button type="button" class="btn g" data-action="copy-code">📋 نسخ الكود</button>
      </div>
      <div data-role="code-host">
        <pre dir="ltr" style="background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:12px;overflow-x:auto;font-size:13px"><code>${esc(
          activeFile?.content || ''
        )}</code></pre>
      </div>

      <div class="warn" style="margin-top:12px">
        <label for="proto-feedback-${esc(idea.id)}">عدّل النموذج عبر النقاش (ينتج نسخة revision جديدة)</label>
        <div class="bar" style="margin-bottom:0">
          <input id="proto-feedback-${esc(idea.id)}" data-role="rev-feedback" placeholder="مثال: انقل الحساس إلى GPIO14 وأضف زر إطفاء">
          <button type="button" class="btn" data-action="revise">🔄 عدّل عبر النقاش</button>
        </div>
      </div>
    `;

    root.querySelector<HTMLSelectElement>('[data-role="rev-select"]')?.addEventListener(
      'change',
      (e) => {
        selectedRevIndex = Number((e.target as HTMLSelectElement).value) || 0;
        selectedFileIndex = 0;
        void paint();
      }
    );

    root.querySelectorAll<HTMLButtonElement>('[data-file-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedFileIndex = Number(btn.dataset.fileIdx) || 0;
        void paint();
      });
    });

    root.querySelector('[data-action="copy-code"]')?.addEventListener('click', () => {
      if (!activeFile) return;
      navigator.clipboard?.writeText(activeFile.content).then(() => {
        toast('تم نسخ الكود');
      });
    });

    root.querySelector('[data-action="revise"]')?.addEventListener('click', () => {
      const inp = root.querySelector<HTMLInputElement>('[data-role="rev-feedback"]');
      const feedback = inp?.value.trim();
      if (!feedback) {
        toast('اكتب التعديل المطلوب أولاً');
        return;
      }
      void handleGenerate(feedback, current);
    });

    // Lazy-load Monaco ONLY on non-touch devices; touch devices keep copyable <pre>
    if (!caps.touch && activeFile) {
      const codeHost = root.querySelector<HTMLElement>('[data-role="code-host"]');
      if (codeHost) {
        import('./monaco')
          .then(({ mountMonacoViewer }) =>
            mountMonacoViewer(codeHost, activeFile.content, activeFile.name)
          )
          .then((dispose) => {
            disposeMonaco = dispose;
          })
          .catch(() => {
            // Keep <pre> fallback cleanly if Monaco fails to load
          });
      }
    }
  }

  async function handleGenerate(feedback?: string, previous?: PrototypeRecord) {
    const btns = root.querySelectorAll<HTMLButtonElement>('button');
    btns.forEach((b) => (b.disabled = true));
    toast(feedback ? 'جارٍ تعديل النموذج الأولي…' : 'جارٍ توليد النموذج الأولي…');
    try {
      await generatePrototype(idea, {
        revisionFeedback: feedback,
        previous,
        tokenBudget: S.settings.contextBudget,
      });
      selectedRevIndex = 0;
      selectedFileIndex = 0;
      toast('تم حفظ النموذج الأولي');
      await paint();
    } catch (e: any) {
      toast('⚠️ ' + (e?.message || 'تعذّر توليد النموذج الأولي'));
      btns.forEach((b) => (b.disabled = false));
    }
  }

  void paint();
  return root;
}
