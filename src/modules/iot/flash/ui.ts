import {
  Idea,
  PrototypeRecord,
  bus,
  caps,
  checkEsp32Pins,
} from '../../../core';
import { S, getSupabaseConfig, save, store } from '../../../store';
import { esc, toast } from '../../../ui';
import {
  DEFAULT_COMPILE_URL,
  FlashBinaryPart,
  checkLocalCompiler,
  compileSketchLocal,
} from './compiler';
import { flashEsp32WebSerial } from './esptool';
import { canStartFlash, markIdeaFlashed, markIdeaReadyToFlash } from './logic';
import {
  SerialMonitorController,
  requestWebSerialPort,
  sendProvisioningOverSerial,
} from './serial';

export function renderFlashTab(idea: Idea): HTMLElement {
  const root = document.createElement('div');
  root.className = 'flash-tab';

  // Mobile / non-WebSerial browsers: Handoff UI ("جاهز للرفع")
  if (!caps.webSerial) {
    const paintHandoff = () => {
      const liveIdea = S.ideas.find((x) => x.id === idea.id) || idea;
      const isReady = liveIdea.lifecycle === 'ready_to_flash';
      root.innerHTML = `
        <div class="warn">
          <b>📱 وضع الهاتف (التسليم للحاسوب):</b>
          <p style="margin:6px 0">الرفع الأول عبر USB غير مدعوم في متصفحات الهاتف، ويتم عبر Chrome أو Edge على الحاسوب.</p>
          ${
            isReady
              ? '<div class="tag ok" data-role="ready-badge">🔌 جاهز للرفع — سيظهر في الحاسوب بنفس الحساب</div>'
              : ''
          }
          <div class="bar" style="margin-bottom:0">
            <button type="button" class="btn" data-action="mark-ready">${
              isReady ? '✓ تم التعليم: جاهز للرفع' : '🚀 جاهز للرفع'
            }</button>
          </div>
          <p style="font-size:13px;color:var(--mu);margin:8px 0 0">بديل عند التهيئة دون حاسوب: يفتح ESP32 بوابة <code>Sharara-Setup</code> تلقائياً عند خلو NVS.</p>
        </div>`;

      root.querySelector('[data-action="mark-ready"]')?.addEventListener('click', () => {
        const target = S.ideas.find((x) => x.id === idea.id) || idea;
        Object.assign(target, markIdeaReadyToFlash(target));
        save(toast);
        bus.emit('idea:status-changed', {
          ideaId: target.id,
          status: target.status,
          lifecycle: target.lifecycle,
        });
        toast('تم تعليم المشروع كـ «جاهز للرفع» للحاسوب');
        paintHandoff();
      });
    };

    paintHandoff();
    return root;
  }

  // Desktop Web Serial Workbench
  root.innerHTML = `<p style="color:var(--mu)">جارٍ تجهيز طاولة الرفع…</p>`;

  let latestProto: PrototypeRecord | undefined;
  let compiledBins: FlashBinaryPart[] = [];
  let reviewConfirmed = false;
  let selectedPort: any = null;
  let compileUrl = DEFAULT_COMPILE_URL;
  const monitor = new SerialMonitorController();

  const dlg = document.getElementById('dlg');
  if (dlg) {
    dlg.addEventListener(
      'close',
      () => {
        void monitor.disconnect();
      },
      { once: true }
    );
  }

  const defaultIngestUrl = (() => {
    const cfg = getSupabaseConfig();
    return cfg ? `${cfg.url.replace(/\/$/, '')}/functions/v1/ingest-telemetry` : '';
  })();

  function appendSerialLog(text: string) {
    const out = root.querySelector<HTMLElement>('[data-role="serial-log"]');
    if (!out) return;
    out.textContent = (out.textContent || '') + text;
    out.scrollTop = out.scrollHeight;
  }

  function updateFlashButtonState() {
    const flashBtn = root.querySelector<HTMLButtonElement>('[data-action="flash-usb"]');
    const guard = canStartFlash({ reviewConfirmed, binsCount: compiledBins.length });
    if (flashBtn) {
      flashBtn.disabled = !guard.allowed;
      flashBtn.title = guard.reason || '';
    }
  }

  async function paint() {
    latestProto = await store.getLatestPrototype(idea.id);
    if (!latestProto) {
      root.innerHTML = `<div class="warn">ولّد النموذج الأولي أولاً من تبويب «💻 الكود والتحذيرات» قبل الترجمة والرفع.</div>`;
      return;
    }

    const d = latestProto.data;
    const pinCheck = checkEsp32Pins(d.wiring);

    root.innerHTML = `
      <div class="warn" data-role="review-box">
        <b>1️⃣ المراجعة الإجبارية قبل الترجمة والرفع</b>
        <div class="bar" style="margin:6px 0">
          <span class="tag">${esc(d.board.fqbn)}</span>
          <span class="tag">النسخة v${latestProto.revision}</span>
          <span class="tag ${pinCheck.valid ? 'ok' : 'er'}">${
            pinCheck.valid ? 'فاحص الأرجل: سليم' : 'فاحص الأرجل: يوجد تعارض'
          }</span>
        </div>
        ${
          pinCheck.issues.length
            ? `<ul>${pinCheck.issues
                .map(
                  (iss) =>
                    `<li><span class="tag ${iss.severity === 'error' ? 'er' : 'wn'}">${
                      iss.severity === 'error' ? 'خطأ' : 'تنبيه'
                    }</span> ${esc(iss.message)}</li>`
                )
                .join('')}</ul>`
            : ''
        }
        ${
          d.warnings.length
            ? `<ul>${d.warnings.map((w) => `<li>⚠️ ${esc(w)}</li>`).join('')}</ul>`
            : '<p style="margin:4px 0;color:var(--mu)">لا توجد تحذيرات إضافية.</p>'
        }
        <label class="step" style="color:inherit;font-size:14px">
          <input type="checkbox" data-role="review-check" ${reviewConfirmed ? 'checked' : ''}>
          <span>أقرّ بمراجعة التوصيل والتحذيرات ونتائج فاحص الأرجل قبل الرفع إلى ESP32.</span>
        </label>
      </div>

      <div class="card" style="cursor:default;margin-bottom:10px">
        <b>2️⃣ الترجمة المحلية (arduino-cli)</b>
        <label for="compile-url-${esc(idea.id)}">عنوان الخادم المحلي</label>
        <div class="bar">
          <input id="compile-url-${esc(idea.id)}" data-role="compile-url" dir="ltr" value="${esc(compileUrl)}">
          <button type="button" class="btn g" data-action="check-health">فحص الاتصال</button>
          <button type="button" class="btn" data-action="compile-local">🔨 ترجمة محلية</button>
        </div>
        <div data-role="compile-status" style="font-size:13px;color:var(--mu)">
          ${
            compiledBins.length
              ? `✅ جاهز للرفع (${compiledBins.length} ملفات .bin)`
              : 'شغّل <code>npm run compile-local</code> في جهازك ثم اضغط ترجمة.'
          }
        </div>
      </div>

      <div class="card" style="cursor:default;margin-bottom:10px">
        <b>3️⃣ الرفع عبر USB (esptool-js)</b>
        <div class="bar">
          <button type="button" class="btn" data-action="flash-usb" disabled>⚡ رفع الكود إلى ESP32 (USB)</button>
          <span data-role="flash-pct" style="font-size:13px;color:var(--mu)">0%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" data-role="flash-bar" style="width:0%"></div></div>
        <pre dir="ltr" data-role="flash-log" style="max-height:140px;overflow:auto;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;font-size:12px;margin:6px 0 0"></pre>
      </div>

      <div class="card" style="cursor:default;margin-bottom:10px">
        <b>4️⃣ تهيئة الواي فاي والرمز (NVS) — لا تُحفظ كلمة المرور في الخادم</b>
        <label>اسم شبكة Wi-Fi (SSID)</label>
        <input data-role="prov-ssid" dir="ltr" placeholder="MyWiFi">
        <label>كلمة مرور Wi-Fi (تُرسل مباشرة عبر USB ولا تُخزّن)</label>
        <input data-role="prov-pass" type="password" dir="ltr" placeholder="••••••••">
        <label>رمز الجهاز (Device Token)</label>
        <input data-role="prov-token" dir="ltr" placeholder="سيُنشأ تلقائياً في S13 أو أدخله يدوياً">
        <label>عنوان الاستقبال (Ingest URL)</label>
        <input data-role="prov-url" dir="ltr" value="${esc(defaultIngestUrl)}">
        <div class="bar" style="margin-bottom:0">
          <button type="button" class="btn" data-action="provision-usb">📡 إرسال التهيئة عبر USB</button>
        </div>
      </div>

      <div class="card" style="cursor:default">
        <div class="bar" style="justify-content:space-between;margin-top:0">
          <b>5️⃣ Serial Monitor (115200 baud)</b>
          <div class="bar" style="margin:0">
            <button type="button" class="btn g" data-action="serial-connect">🔌 اتصال</button>
            <button type="button" class="btn g" data-action="serial-disconnect" disabled>قطع</button>
            <button type="button" class="btn g" data-action="serial-clear">مسح</button>
          </div>
        </div>
        <pre dir="ltr" data-role="serial-log" style="height:180px;overflow:auto;background:#0f1715;color:#e6ede9;border-radius:8px;padding:10px;font-size:12px"></pre>
        <div class="bar" style="margin-bottom:0">
          <input data-role="serial-input" dir="ltr" placeholder="أرسل سطراً للجهاز...">
          <button type="button" class="btn g" data-action="serial-send">إرسال</button>
        </div>
      </div>
    `;

    updateFlashButtonState();

    root.querySelector<HTMLInputElement>('[data-role="review-check"]')?.addEventListener(
      'change',
      (e) => {
        reviewConfirmed = (e.target as HTMLInputElement).checked;
        updateFlashButtonState();
      }
    );

    root.querySelector<HTMLInputElement>('[data-role="compile-url"]')?.addEventListener(
      'input',
      (e) => {
        compileUrl = (e.target as HTMLInputElement).value.trim() || DEFAULT_COMPILE_URL;
      }
    );

    root.querySelector('[data-action="check-health"]')?.addEventListener('click', async () => {
      const statusEl = root.querySelector('[data-role="compile-status"]');
      if (statusEl) statusEl.textContent = 'جارٍ فحص arduino-cli…';
      const res = await checkLocalCompiler(compileUrl);
      if (statusEl) {
        statusEl.textContent = res.ok
          ? `✅ متصل بـ arduino-cli (${res.version || 'ok'}) · نواة ESP32: ${
              res.esp32Core ? 'مثبّتة' : 'غير مثبّتة'
            }`
          : `⚠️ ${res.error || 'تعذّر الاتصال'}`;
      }
    });

    root.querySelector('[data-action="compile-local"]')?.addEventListener('click', async () => {
      if (!reviewConfirmed) {
        toast('أكّد المراجعة الإجبارية أولاً');
        return;
      }
      const statusEl = root.querySelector('[data-role="compile-status"]');
      const btn = root.querySelector<HTMLButtonElement>('[data-action="compile-local"]');
      if (btn) btn.disabled = true;
      if (statusEl) statusEl.textContent = 'جارٍ الترجمة المحلية عبر arduino-cli…';
      try {
        const res = await compileSketchLocal(
          d.firmware.files,
          d.board.fqbn,
          d.firmware.libraries,
          compileUrl
        );
        compiledBins = res.bins;
        if (statusEl) {
          statusEl.textContent = `✅ نجحت الترجمة (${compiledBins.length} ملفات .bin جاهزة للرفع)`;
        }
        updateFlashButtonState();
        toast('اكتملت الترجمة المحلية');
      } catch (err: any) {
        compiledBins = [];
        updateFlashButtonState();
        if (statusEl) statusEl.textContent = `⚠️ ${err?.message || 'فشلت الترجمة'}`;
        toast('⚠️ فشلت الترجمة المحلية');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    root.querySelector('[data-action="flash-usb"]')?.addEventListener('click', async () => {
      const guard = canStartFlash({ reviewConfirmed, binsCount: compiledBins.length });
      if (!guard.allowed) {
        toast(guard.reason || 'تعذّر الرفع');
        return;
      }
      if (monitor.isConnected()) {
        await monitor.disconnect();
      }
      const flashLog = root.querySelector<HTMLElement>('[data-role="flash-log"]');
      const pctEl = root.querySelector<HTMLElement>('[data-role="flash-pct"]');
      const barEl = root.querySelector<HTMLElement>('[data-role="flash-bar"]');
      const flashBtn = root.querySelector<HTMLButtonElement>('[data-action="flash-usb"]');
      if (flashLog) flashLog.textContent = '';
      if (flashBtn) flashBtn.disabled = true;

      try {
        selectedPort = selectedPort || (await requestWebSerialPort());
        await flashEsp32WebSerial({
          port: selectedPort,
          bins: compiledBins,
          onLog: (line) => {
            if (flashLog) {
              flashLog.textContent += line + '\n';
              flashLog.scrollTop = flashLog.scrollHeight;
            }
          },
          onProgress: (pct) => {
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (barEl) barEl.style.width = `${pct}%`;
          },
        });

        const target = S.ideas.find((x) => x.id === idea.id) || idea;
        Object.assign(target, markIdeaFlashed(target));
        save(toast);
        bus.emit('idea:status-changed', {
          ideaId: target.id,
          status: target.status,
          lifecycle: target.lifecycle,
        });
        toast('تم رفع البرنامج إلى ESP32 بنجاح!');
      } catch (err: any) {
        toast('⚠️ ' + (err?.message || 'فشل الرفع عبر USB'));
      } finally {
        updateFlashButtonState();
      }
    });

    root.querySelector('[data-action="provision-usb"]')?.addEventListener('click', async () => {
      if (monitor.isConnected()) {
        await monitor.disconnect();
      }
      const ssid = root.querySelector<HTMLInputElement>('[data-role="prov-ssid"]')?.value || '';
      const pass = root.querySelector<HTMLInputElement>('[data-role="prov-pass"]')?.value || '';
      const token = root.querySelector<HTMLInputElement>('[data-role="prov-token"]')?.value || '';
      const url = root.querySelector<HTMLInputElement>('[data-role="prov-url"]')?.value || '';

      try {
        selectedPort = selectedPort || (await requestWebSerialPort());
        await sendProvisioningOverSerial(
          selectedPort,
          {
            wifi_ssid: ssid,
            wifi_pass: pass,
            device_token: token,
            ingest_url: url,
          },
          (msg) => appendSerialLog(`[NVS] ${msg}\n`)
        );
        // Clear sensitive password field immediately after sending
        const passInput = root.querySelector<HTMLInputElement>('[data-role="prov-pass"]');
        if (passInput) passInput.value = '';
        toast('تم إرسال تهيئة الواي فاي إلى ESP32');
      } catch (err: any) {
        toast('⚠️ ' + (err?.message || 'تعذّر إرسال التهيئة'));
      }
    });

    const connBtn = root.querySelector<HTMLButtonElement>('[data-action="serial-connect"]');
    const discBtn = root.querySelector<HTMLButtonElement>('[data-action="serial-disconnect"]');

    connBtn?.addEventListener('click', async () => {
      try {
        selectedPort = selectedPort || (await requestWebSerialPort());
        await monitor.connect(
          selectedPort,
          115200,
          (chunk) => appendSerialLog(chunk),
          () => {
            if (connBtn) connBtn.disabled = false;
            if (discBtn) discBtn.disabled = true;
          }
        );
        if (connBtn) connBtn.disabled = true;
        if (discBtn) discBtn.disabled = false;
        appendSerialLog('--- متصل بـ Serial Monitor (115200) ---\n');
      } catch (err: any) {
        toast('⚠️ ' + (err?.message || 'تعذّر فتح المنفذ التسلسلي'));
      }
    });

    discBtn?.addEventListener('click', async () => {
      await monitor.disconnect();
      if (connBtn) connBtn.disabled = false;
      if (discBtn) discBtn.disabled = true;
      appendSerialLog('\n--- تم قطع الاتصال ---\n');
    });

    root.querySelector('[data-action="serial-clear"]')?.addEventListener('click', () => {
      const out = root.querySelector<HTMLElement>('[data-role="serial-log"]');
      if (out) out.textContent = '';
    });

    root.querySelector('[data-action="serial-send"]')?.addEventListener('click', async () => {
      const inp = root.querySelector<HTMLInputElement>('[data-role="serial-input"]');
      const line = inp?.value || '';
      if (!line) return;
      try {
        await monitor.sendLine(line);
        appendSerialLog(`> ${line}\n`);
        if (inp) inp.value = '';
      } catch (err: any) {
        toast('⚠️ ' + (err?.message || 'افتح الاتصال أولاً'));
      }
    });
  }

  bus.on('prototype:generated', (payload) => {
    if (payload.ideaId === idea.id) {
      compiledBins = [];
      void paint();
    }
  });

  void paint();
  return root;
}
