import {
  DEFAULT_COMPILE_URL,
  DeviceRecord,
  FirmwareReleaseRecord,
  Idea,
  PrototypeRecord,
  bus,
  checkLocalCompiler,
  compileSketchLocal,
} from '../../../core';
import {
  base64ToBytes,
  isSupabaseConfigured,
  listDevicesForIdea,
  listFirmwareReleases,
  pickAppBinaryPart,
  publishOtaRelease,
  store,
  syncManager,
} from '../../../store';
import { esc, toast } from '../../../ui';
import { canPublishOta, suggestNextFirmwareVersion } from './logic';

export function renderOtaTab(idea: Idea): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ota-tab';
  root.innerHTML = `<p style="color:var(--mu)">جارٍ تحميل سجل التحديثات اللاسلكية (OTA)…</p>`;

  let devices: DeviceRecord[] = [];
  let releases: FirmwareReleaseRecord[] = [];
  let latestProto: PrototypeRecord | undefined;
  let busy = false;
  let statusMessage = '';
  let statusOk = true;
  const compileUrl = DEFAULT_COMPILE_URL;
  let compilerReady = false;
  let selectedFile: File | null = null;

  function paint() {
    const supaOk = isSupabaseConfigured() && Boolean(syncManager.getSnapshot().user);
    const gate = canPublishOta(devices, Boolean(latestProto));
    const suggestedVer = suggestNextFirmwareVersion(releases);
    const otaSupported = Boolean(latestProto?.data?.board?.ota);

    root.innerHTML = `
      <div class="card" style="cursor:default;margin-bottom:10px">
        <div class="bar" style="justify-content:space-between;margin-top:0">
          <b>🚀 التحديث اللاسلكي (OTA)</b>
          <span class="tag ${otaSupported ? 'ok' : 'wn'}">${
            otaSupported ? 'OTA مفعّل في اللوحة' : 'يتطلب ESP32 + OTA'
          }</span>
        </div>
        ${
          !supaOk
            ? `<p style="color:var(--mu);margin:6px 0 0">سجّل الدخول بحساب Supabase من الإعدادات لنشر تحديثات OTA السحابية.</p>`
            : !gate.ok
              ? `<div class="warn" data-role="ota-gate-warn" style="margin-top:8px;border-color:var(--wn)">⚠️ ${esc(
                  gate.reason || ''
                )}</div>`
              : `<div style="margin-top:8px">
                  <div class="bar" style="margin-top:0">
                    <label style="font-size:13px;color:var(--mu)">الإصدار الجديد:</label>
                    <input data-role="ota-version" value="${esc(
                      suggestedVer
                    )}" placeholder="مثال: 1.0.1" style="max-width:140px">
                    <button type="button" class="btn" data-action="publish-ota" ${
                      busy ? 'disabled' : ''
                    }>${busy ? '⏳ جارٍ النشر…' : '🚀 حدّث لاسلكياً'}</button>
                  </div>
                  <div style="margin-top:8px;font-size:12px;color:var(--mu)">
                    ${
                      compilerReady
                        ? '🖥️ خدمة الترجمة المحلية متصلة: سيتم ترجمة الكود الحالي ورفع ملف التطبيق <code>.bin</code> تلقائياً مع حساب <code>sha256</code>.'
                        : '📱 خدمة الترجمة المحلية غير متصلة (وضع الهاتف/أو اختياري): اختر ملف <code>.bin</code> مترجَماً مسبقاً لرفعه وتوقيعه بـ <code>sha256</code>:'
                    }
                  </div>
                  <div class="bar" style="margin-top:6px">
                    <input type="file" accept=".bin" data-role="ota-bin-file" style="font-size:12px">
                    ${
                      selectedFile
                        ? `<span class="tag ok" data-role="selected-bin">${esc(
                            selectedFile.name
                          )}</span>`
                        : ''
                    }
                  </div>
                  ${
                    statusMessage
                      ? `<div class="warn" data-role="ota-status" style="margin-top:8px;border-color:${
                          statusOk ? 'var(--ok)' : 'var(--er)'
                        }">${esc(statusMessage)}</div>`
                      : ''
                  }
                </div>`
        }
      </div>

      <div class="card" style="cursor:default">
        <div class="bar" style="justify-content:space-between;margin-top:0">
          <b>📦 الإصدارات المنشورة (${releases.length})</b>
          <button type="button" class="btn g" data-action="refresh-ota">🔄 تحديث</button>
        </div>
        ${
          releases.length
            ? releases
                .map(
                  (r) => `<div class="warn" data-release-version="${esc(r.version)}">
                    <div class="bar" style="justify-content:space-between;margin:0">
                      <b>v${esc(r.version)}</b>
                      <span class="tag ok" title="${esc(r.sha256)}">SHA-256: ${esc(
                        r.sha256.slice(0, 12)
                      )}…</span>
                    </div>
                    <div style="font-size:12px;color:var(--mu);margin-top:4px">
                      ${esc(new Date(r.created_at).toLocaleString('ar'))}
                    </div>
                  </div>`
                )
                .join('')
            : `<p style="color:var(--mu);margin:6px 0 0">لا توجد إصدارات OTA منشورة لهذا المشروع بعد.</p>`
        }
      </div>`;

    root.querySelector<HTMLInputElement>('[data-role="ota-bin-file"]')?.addEventListener(
      'change',
      (e) => {
        const file = (e.target as HTMLInputElement).files?.[0] || null;
        selectedFile = file;
        paint();
      }
    );

    root.querySelector('[data-action="refresh-ota"]')?.addEventListener('click', () => {
      void refresh();
    });

    root.querySelector('[data-action="publish-ota"]')?.addEventListener('click', async () => {
      const verInput = root.querySelector<HTMLInputElement>('[data-role="ota-version"]');
      const version = (verInput?.value || suggestedVer).trim();
      if (!version) {
        toast('أدخل رقم الإصدار أولاً');
        return;
      }

      busy = true;
      statusMessage = 'جارٍ تجهيز التحديث وحساب SHA-256…';
      statusOk = true;
      paint();

      try {
        let binaryBytes: Uint8Array | null = null;
        let fileName = 'firmware.bin';

        if (selectedFile) {
          binaryBytes = new Uint8Array(await selectedFile.arrayBuffer());
          fileName = selectedFile.name;
        } else if (latestProto) {
          const health = await checkLocalCompiler(compileUrl);
          compilerReady = Boolean(health.ok && health.arduinoCli && health.esp32Core);
          if (!compilerReady) {
            throw new Error(
              'خدمة الترجمة المحلية غير متاحة. شغّل npm run compile-local على الحاسوب أو اختر ملف .bin مرفقاً.'
            );
          }
          const compiled = await compileSketchLocal(
            latestProto.data.firmware.files,
            latestProto.data.board.fqbn,
            latestProto.data.firmware.libraries,
            compileUrl
          );
          const appPart = pickAppBinaryPart(compiled.bins);
          if (!appPart) {
            throw new Error('لم يُعثر على ملف التطبيق (.bin) بعد الترجمة');
          }
          binaryBytes = base64ToBytes(appPart.dataBase64);
          fileName = appPart.name;
        }

        if (!binaryBytes) {
          throw new Error('اختر ملف .bin أو ولّد النموذج الأولي أولاً');
        }

        const record = await publishOtaRelease({
          ideaId: idea.id,
          version,
          binaryBytes,
          fileName,
        });

        releases = [record, ...releases];
        selectedFile = null;
        statusOk = true;
        statusMessage = `✅ تم نشر الإصدار v${record.version} (SHA-256: ${record.sha256.slice(
          0,
          12
        )}…). سيتحقق ESP32 ويحدّث نفسه في الدورة القادمة.`;
        bus.emit('ota:released', {
          ideaId: idea.id,
          version: record.version,
          sha256: record.sha256,
        });
        toast(`🚀 تم نشر التحديث v${record.version}`);
      } catch (err: any) {
        statusOk = false;
        statusMessage = err?.message || 'تعذّر نشر التحديث اللاسلكي';
        toast(statusMessage);
      } finally {
        busy = false;
        paint();
      }
    });
  }

  async function refresh() {
    const [protos, devs, rels, health] = await Promise.all([
      store.listPrototypes(idea.id),
      listDevicesForIdea(idea.id).catch(() => []),
      listFirmwareReleases(idea.id).catch(() => []),
      checkLocalCompiler(compileUrl).catch(() => ({ ok: false, arduinoCli: false, esp32Core: false })),
    ]);
    latestProto = protos[0];
    devices = devs;
    releases = rels;
    compilerReady = Boolean(health.ok && health.arduinoCli && health.esp32Core);
    paint();
  }

  void refresh();
  return root;
}
