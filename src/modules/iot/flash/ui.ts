import {
  DEFAULT_COMPILE_URL,
  Idea,
  InstalledLibraryInfo,
  LibrarySearchItem,
  PrototypeRecord,
  PrototypeV1,
  bus,
  caps,
  checkEsp32Pins,
} from '../../../core';
import { callLLM } from '../../../llm';
import {
  S,
  getLastIssuedToken,
  getSupabaseConfig,
  save,
  savePrototypeRevisionSynced,
  store,
} from '../../../store';
import { esc, toast } from '../../../ui';
import {
  FlashBinaryPart,
  checkLocalCompiler,
  compileSketchLocal,
  installArduinoLibrary,
  listInstalledLibraries,
  searchArduinoLibraries,
} from './compiler';
import { flashEsp32WebSerial } from './esptool';
import {
  buildCompileFixPrompts,
  canStartFlash,
  cleanFixedFirmwareCode,
  extractMissingHeaderFromCompileError,
  markIdeaFlashed,
  markIdeaReadyToFlash,
} from './logic';
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

  // Library manager & compile diagnostics state
  let installedLibs: InstalledLibraryInfo[] = [];
  let installedLibsLoaded = false;
  let libSearchQuery = '';
  let libSearchResults: LibrarySearchItem[] = [];
  let libSearchBusy = false;
  let libActionMsg = '';
  let libManagerOpen = false;
  let installingLibName: string | null = null;

  let compileBusy = false;
  let compileErrorSummary: string | null = null;
  let compileErrorLogs: string | null = null;
  let aiFixBusy = false;
  let aiFixApplied = false;
  let suppressNextProtoRefresh = false;

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

  function isLibInstalled(name: string): boolean {
    const target = name.trim().toLowerCase();
    return installedLibs.some((lib) => lib.name.trim().toLowerCase() === target);
  }

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

  function paintLibraryManagerSection() {
    const body = root.querySelector<HTMLElement>('[data-role="lib-manager-body"]');
    const details = root.querySelector<HTMLDetailsElement>('[data-role="lib-manager"]');
    if (!body || !latestProto) return;
    if (details) details.open = libManagerOpen;

    const requiredLibs = latestProto.data.firmware.libraries || [];
    body.innerHTML = `
      <div class="bar" style="justify-content:space-between;margin-top:6px">
        <span style="font-size:13px;color:var(--mu)">المكتبات المطلوبة للمشروع (${requiredLibs.length}):</span>
        <button type="button" class="btn g" data-action="refresh-libs">🔄 تحديث القائمة</button>
      </div>
      ${
        requiredLibs.length
          ? `<div data-role="required-libs-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
              ${requiredLibs
                .map((lib) => {
                  const installed = isLibInstalled(lib);
                  const busyThis = installingLibName === lib;
                  return `<div class="bar" data-req-lib="${esc(lib)}" style="justify-content:space-between;margin:0;padding:6px 8px;border:1px solid var(--bd);border-radius:8px">
                    <span><code>${esc(lib)}</code></span>
                    <div class="bar" style="margin:0;gap:6px">
                      <span class="tag ${installed ? 'ok' : 'wn'}" data-role="lib-state">${
                        installed
                          ? '✅ مثبتة'
                          : installedLibsLoaded
                            ? '⚠️ غير مثبتة'
                            : '⏳ غير مفحوصة'
                      }</span>
                      ${
                        installed
                          ? ''
                          : `<button type="button" class="btn g" data-action="install-lib" data-lib-name="${esc(
                              lib
                            )}" ${busyThis ? 'disabled' : ''}>${
                              busyThis ? '⏳ جارٍ التثبيت…' : '📥 تثبيت'
                            }</button>`
                      }
                    </div>
                  </div>`;
                })
                .join('')}
            </div>`
          : `<p style="font-size:13px;color:var(--mu);margin:4px 0 10px">لا توجد مكتبات خارجية مطلوبة لهذا الكود.</p>`
      }
      <div class="bar" style="margin-top:6px">
        <input data-role="lib-search-input" placeholder="ابحث عن مكتبة Arduino (مثال: LiquidCrystal_I2C أو DHT)" value="${esc(
          libSearchQuery
        )}">
        <button type="button" class="btn g" data-action="search-libs" ${
          libSearchBusy ? 'disabled' : ''
        }>${libSearchBusy ? '⏳ بحث…' : '🔍 بحث'}</button>
      </div>
      ${
        libActionMsg
          ? `<div data-role="lib-action-msg" style="font-size:13px;margin:4px 0;color:var(--mu)">${esc(
              libActionMsg
            )}</div>`
          : ''
      }
      <div data-role="lib-search-results" style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        ${libSearchResults
          .map((item) => {
            const installed = isLibInstalled(item.name);
            const busyThis = installingLibName === item.name;
            return `<div class="warn" data-search-lib="${esc(item.name)}" style="margin:0">
              <div class="bar" style="justify-content:space-between;margin:0">
                <div>
                  <b>${esc(item.name)}</b>
                  ${item.version ? `<span class="tag">v${esc(item.version)}</span>` : ''}
                  ${
                    item.author
                      ? `<span style="font-size:12px;color:var(--mu)"> · ${esc(item.author)}</span>`
                      : ''
                  }
                </div>
                ${
                  installed
                    ? `<span class="tag ok">✅ مثبتة</span>`
                    : `<button type="button" class="btn g" data-action="install-lib" data-lib-name="${esc(
                        item.name
                      )}" ${busyThis ? 'disabled' : ''}>${
                        busyThis ? '⏳ جارٍ التثبيت…' : '📥 تثبيت'
                      }</button>`
                }
              </div>
              ${
                item.sentence
                  ? `<div style="font-size:12px;color:var(--mu);margin-top:4px">${esc(
                      item.sentence
                    )}</div>`
                  : ''
              }
            </div>`;
          })
          .join('')}
      </div>`;

    body.querySelector<HTMLInputElement>('[data-role="lib-search-input"]')?.addEventListener(
      'input',
      (e) => {
        libSearchQuery = (e.target as HTMLInputElement).value;
      }
    );

    body.querySelector('[data-action="refresh-libs"]')?.addEventListener('click', () => {
      void loadInstalledLibraries(true);
    });

    body.querySelector('[data-action="search-libs"]')?.addEventListener('click', () => {
      void handleLibrarySearch(libSearchQuery);
    });

    body.querySelectorAll<HTMLButtonElement>('[data-action="install-lib"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const libName = btn.getAttribute('data-lib-name') || '';
        if (libName) void handleInstallLibrary(libName);
      });
    });
  }

  function paintDiagnosticsSection() {
    const host = root.querySelector<HTMLElement>('[data-role="compile-diagnostics-host"]');
    if (!host) return;

    if (aiFixApplied && latestProto) {
      host.innerHTML = `
        <div class="warn" data-role="ai-fix-success" style="margin-top:8px;border-color:var(--ok)">
          <b>✅ تم تحديث <code>main.ino</code> بالإصلاح المقترح (النسخة v${latestProto.revision}).</b>
          <div class="bar" style="margin:8px 0 0">
            <button type="button" class="btn" data-action="recompile-after-fix" ${
              compileBusy ? 'disabled' : ''
            }>🔄 إعادة الترجمة الآن</button>
          </div>
        </div>`;

      host.querySelector('[data-action="recompile-after-fix"]')?.addEventListener('click', () => {
        void handleCompile();
      });
      return;
    }

    if (!compileErrorLogs) {
      host.innerHTML = '';
      return;
    }

    const missingHeader = extractMissingHeaderFromCompileError(compileErrorLogs);
    host.innerHTML = `
      <div class="warn" data-role="compile-diagnostics" style="margin-top:8px;border-color:var(--er)">
        <b>⚠️ تشخيص خطأ الترجمة</b>
        <p style="margin:6px 0;font-size:13px">${esc(
          compileErrorSummary || 'فشلت الترجمة المحلية'
        )}</p>
        ${
          missingHeader
            ? `<div class="bar" style="margin:6px 0">
                <span class="tag wn">ملف ترويسة مفقود: <code>${esc(
                  missingHeader.header
                )}</code></span>
                <button type="button" class="btn g" data-action="search-missing-lib" data-query="${esc(
                  missingHeader.query
                )}">📦 بحث وتثبيت المكتبة الناقصة</button>
              </div>`
            : ''
        }
        <pre dir="ltr" data-role="compile-stderr" style="max-height:150px;overflow:auto;background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;font-size:12px;margin:6px 0">${esc(
          compileErrorLogs
        )}</pre>
        <div class="bar" style="margin:6px 0 0">
          <button type="button" class="btn" data-action="ai-auto-fix" ${
            aiFixBusy ? 'disabled' : ''
          }>${
            aiFixBusy ? '⏳ جارٍ تحليل الخطأ وإصلاح الكود…' : '✨ إصلاح الكود تلقائياً بالذكاء الاصطناعي'
          }</button>
        </div>
      </div>`;

    host.querySelector<HTMLButtonElement>('[data-action="search-missing-lib"]')?.addEventListener(
      'click',
      (e) => {
        const q = (e.currentTarget as HTMLButtonElement).getAttribute('data-query') || '';
        libManagerOpen = true;
        const details = root.querySelector<HTMLDetailsElement>('[data-role="lib-manager"]');
        if (details) {
          details.open = true;
          details.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        }
        void handleLibrarySearch(q);
      }
    );

    host.querySelector('[data-action="ai-auto-fix"]')?.addEventListener('click', () => {
      void handleAiAutoFix();
    });
  }

  async function loadInstalledLibraries(showFeedback = false) {
    try {
      installedLibs = await listInstalledLibraries(compileUrl);
      installedLibsLoaded = true;
      if (showFeedback) {
        libActionMsg = `تم تحديث القائمة (${installedLibs.length} مكتبة مثبتة).`;
      }
    } catch (err: any) {
      if (showFeedback) {
        libActionMsg = `⚠️ ${err?.message || 'تعذّر جلب قائمة المكتبات'}`;
      }
    }
    paintLibraryManagerSection();
  }

  async function handleLibrarySearch(query: string) {
    const clean = query.trim();
    libSearchQuery = clean;
    if (!clean) {
      libActionMsg = 'أدخل اسم المكتبة للبحث.';
      paintLibraryManagerSection();
      return;
    }

    libSearchBusy = true;
    libActionMsg = `جارٍ البحث عن «${clean}»…`;
    paintLibraryManagerSection();

    try {
      libSearchResults = await searchArduinoLibraries(clean, compileUrl);
      libActionMsg = libSearchResults.length
        ? `تم العثور على ${libSearchResults.length} نتيجة.`
        : `لم يُعثر على مكتبات مطابقة لـ «${clean}».`;
    } catch (err: any) {
      libSearchResults = [];
      libActionMsg = `⚠️ ${err?.message || 'تعذّر البحث عن المكتبات'}`;
    } finally {
      libSearchBusy = false;
      paintLibraryManagerSection();
    }
  }

  async function handleInstallLibrary(libName: string) {
    installingLibName = libName;
    libActionMsg = `جارٍ تثبيت المكتبة «${libName}»…`;
    paintLibraryManagerSection();

    try {
      await installArduinoLibrary(libName, compileUrl);
      await loadInstalledLibraries(false);
      libActionMsg = `✅ تم تثبيت المكتبة «${libName}» بنجاح.`;
      toast(`✅ تم تثبيت ${libName}`);
    } catch (err: any) {
      libActionMsg = `⚠️ ${err?.message || `فشل تثبيت ${libName}`}`;
      toast(`⚠️ تعذّر تثبيت ${libName}`);
    } finally {
      installingLibName = null;
      paintLibraryManagerSection();
    }
  }

  async function handleCompile() {
    if (!latestProto) return;
    if (!reviewConfirmed) {
      toast('أكّد المراجعة الإجبارية أولاً');
      return;
    }

    const statusEl = root.querySelector('[data-role="compile-status"]');
    const compileBtn = root.querySelector<HTMLButtonElement>('[data-action="compile-local"]');
    compileBusy = true;
    aiFixApplied = false;
    compileErrorSummary = null;
    compileErrorLogs = null;
    if (compileBtn) compileBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'جارٍ التحقق من المكتبات والترجمة المحلية عبر arduino-cli…';
    paintDiagnosticsSection();

    try {
      const res = await compileSketchLocal(
        latestProto.data.firmware.files,
        latestProto.data.board.fqbn,
        latestProto.data.firmware.libraries,
        compileUrl
      );
      compiledBins = res.bins;
      if (statusEl) {
        statusEl.textContent = `✅ نجحت الترجمة (${compiledBins.length} ملفات .bin جاهزة للرفع)`;
      }
      updateFlashButtonState();
      await loadInstalledLibraries(false);
      toast('اكتملت الترجمة المحلية');
    } catch (err: any) {
      compiledBins = [];
      updateFlashButtonState();
      const fullLog = String(err?.logs || err?.message || 'فشلت الترجمة المحلية');
      const firstLine = fullLog.split(/\r?\n/).find((l) => l.trim()) || 'فشلت الترجمة المحلية';
      compileErrorSummary = firstLine;
      compileErrorLogs = fullLog;
      if (statusEl) statusEl.textContent = `⚠️ ${firstLine}`;
      toast('⚠️ فشلت الترجمة المحلية');
    } finally {
      compileBusy = false;
      if (compileBtn) compileBtn.disabled = false;
      paintDiagnosticsSection();
    }
  }

  async function handleAiAutoFix() {
    if (!latestProto || !compileErrorLogs) return;
    const files = latestProto.data.firmware.files;
    const targetIdx = Math.max(
      0,
      files.findIndex((f) => f.name.toLowerCase().endsWith('.ino'))
    );
    const targetFile = files[targetIdx];
    if (!targetFile) {
      toast('لم يُعثر على ملف main.ino لإصلاحه');
      return;
    }

    aiFixBusy = true;
    paintDiagnosticsSection();

    try {
      const { system, userMessage } = buildCompileFixPrompts({
        mainInoContent: targetFile.content,
        fqbn: latestProto.data.board.fqbn,
        libraries: latestProto.data.firmware.libraries,
        errorLogs: compileErrorLogs,
      });

      const aiRaw = await callLLM([{ role: 'user', content: userMessage }], system);
      const cleanedCode = cleanFixedFirmwareCode(aiRaw);
      if (!cleanedCode) {
        throw new Error('لم يُرجع الذكاء الاصطناعي كوداً صالحاً');
      }

      const nextData: PrototypeV1 = {
        ...latestProto.data,
        firmware: {
          ...latestProto.data.firmware,
          files: files.map((f, idx) =>
            idx === targetIdx ? { ...f, content: cleanedCode } : { ...f }
          ),
        },
      };

      const savedRecord = await savePrototypeRevisionSynced(
        idea.id,
        nextData,
        'إصلاح تلقائي لخطأ الترجمة بالذكاء الاصطناعي'
      );
      latestProto = savedRecord;
      compiledBins = [];
      compileErrorLogs = null;
      compileErrorSummary = null;
      aiFixApplied = true;
      updateFlashButtonState();

      suppressNextProtoRefresh = true;
      bus.emit('prototype:generated', { ideaId: idea.id, revision: savedRecord.revision });
      suppressNextProtoRefresh = false;

      toast('✨ تم إصلاح الكود وحفظ نسخة محدّثة');
    } catch (err: any) {
      toast('⚠️ ' + (err?.message || 'تعذّر إصلاح الكود تلقائياً'));
    } finally {
      aiFixBusy = false;
      paintDiagnosticsSection();
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
        <div data-role="compile-diagnostics-host"></div>
        <details data-role="lib-manager" style="margin-top:10px;border-top:1px solid var(--bd);padding-top:8px" ${
          libManagerOpen ? 'open' : ''
        }>
          <summary style="cursor:pointer;font-weight:700">📚 مدير المكتبات</summary>
          <div data-role="lib-manager-body"></div>
        </details>
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
        <input data-role="prov-token" dir="ltr" value="${esc(
          getLastIssuedToken(idea.id)
        )}" placeholder="سجّل جهازاً من تبويب الأجهزة والبث الحي أو ألصق الرمز هنا">
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
    paintLibraryManagerSection();
    paintDiagnosticsSection();

    const libDetails = root.querySelector<HTMLDetailsElement>('[data-role="lib-manager"]');
    libDetails?.addEventListener('toggle', () => {
      libManagerOpen = libDetails.open;
      if (libDetails.open && !installedLibsLoaded) {
        void loadInstalledLibraries(false);
      }
    });

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
      if (res.ok) {
        void loadInstalledLibraries(false);
      }
    });

    root.querySelector('[data-action="compile-local"]')?.addEventListener('click', () => {
      void handleCompile();
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
      if (suppressNextProtoRefresh) return;
      compiledBins = [];
      compileErrorLogs = null;
      compileErrorSummary = null;
      aiFixApplied = false;
      void paint();
    }
  });

  void paint();
  return root;
}
