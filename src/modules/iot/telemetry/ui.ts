import { DeviceRecord, Idea, TelemetryReading, bus } from '../../../core';
import {
  S,
  isDeviceOnline,
  isSupabaseConfigured,
  listDevicesForIdea,
  listRecentTelemetry,
  registerDeviceForIdea,
  subscribeIdeaTelemetry,
  syncManager,
} from '../../../store';
import { esc, toast } from '../../../ui';

export function renderTelemetryTab(idea: Idea): HTMLElement {
  const root = document.createElement('div');
  root.className = 'telemetry-tab';
  root.innerHTML = `<p style="color:var(--mu)">جارٍ تحميل الأجهزة…</p>`;

  let oneTimeToken: string | null = null;
  let devices: DeviceRecord[] = [];
  const latestReadingByDevice = new Map<string, TelemetryReading>();
  let unsubRealtime: (() => void) | null = null;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  const intervalMs = 5000;

  function cleanup() {
    unsubRealtime?.();
    unsubRealtime = null;
    if (statusTimer !== null) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  const dlg = document.getElementById('dlg');
  if (dlg) {
    dlg.addEventListener('close', cleanup, { once: true });
  }

  function renderView() {
    const supaOk = isSupabaseConfigured() && Boolean(syncManager.getSnapshot().user);
    const liveIdea = S.ideas.find((x) => x.id === idea.id) || idea;
    const anyOnline = devices.some((d) => isDeviceOnline(d.last_seen_at, intervalMs));

    root.innerHTML = `
      ${
        liveIdea.lifecycle === 'online' || anyOnline
          ? `<div class="warn" style="border-color:var(--ok)">🎉 <b>الجهاز متصل الآن!</b> استقبلت المنصة قراءات حية من العتاد.</div>`
          : ''
      }
      <div class="card" style="cursor:default;margin-bottom:10px">
        <b>🔑 تسجيل جهاز جديد (ESP32)</b>
        ${
          !supaOk
            ? `<p style="color:var(--mu);margin:6px 0 0">سجّل الدخول بحساب Supabase من الإعدادات أولاً لتسجيل الأجهزة واستقبال القراءات الحية.</p>`
            : `<div class="bar" style="margin-bottom:0">
                <input data-role="dev-name" placeholder="اسم الجهاز (مثال: عقدة الغرفة 1)" value="${esc(
                  idea.name + ' - ESP32'
                )}">
                <button type="button" class="btn" data-action="register-device">🔑 سجّل جهازاً</button>
              </div>`
        }
        ${
          oneTimeToken
            ? `<div class="warn" data-role="one-time-token" style="margin-top:10px;border-color:var(--wn)">
                <b>⚠️ رمز الجهاز (يُعرض مرة واحدة فقط — احفظه أو هيّئه الآن):</b>
                <pre dir="ltr" style="margin:6px 0;padding:8px;background:var(--bg);border-radius:8px;font-size:12px">${esc(
                  oneTimeToken
                )}</pre>
                <button type="button" class="btn g" data-action="copy-token">📋 نسخ الرمز</button>
              </div>`
            : ''
        }
      </div>

      <div class="card" style="cursor:default">
        <div class="bar" style="justify-content:space-between;margin-top:0">
          <b>📡 الأجهزة المسجّلة (${devices.length})</b>
          <button type="button" class="btn g" data-action="refresh-devices">🔄 تحديث</button>
        </div>
        ${
          devices.length
            ? devices
                .map((d) => {
                  const online = isDeviceOnline(d.last_seen_at, intervalMs);
                  const latest = latestReadingByDevice.get(d.id);
                  return `<div class="warn" data-device-id="${esc(d.id)}">
                    <div class="bar" style="justify-content:space-between;margin:0">
                      <b>${esc(d.name)}</b>
                      <span class="tag ${online ? 'ok' : 'wn'}" data-role="device-status">${
                        online ? '🟢 متصل (online)' : '⚪ غير متصل (offline)'
                      }</span>
                    </div>
                    <div style="font-size:12px;color:var(--mu);margin-top:4px">
                      آخر ظهور: ${
                        d.last_seen_at
                          ? esc(new Date(d.last_seen_at).toLocaleString('ar'))
                          : 'لم يتصل بعد'
                      }
                    </div>
                    ${
                      latest
                        ? `<pre dir="ltr" style="margin:6px 0 0;padding:6px 8px;background:var(--bg);border-radius:6px;font-size:12px">${esc(
                            JSON.stringify(latest.payload)
                          )}</pre>`
                        : ''
                    }
                  </div>`;
                })
                .join('')
            : '<p style="color:var(--mu)">لا توجد أجهزة مسجّلة لهذه الفكرة بعد.</p>'
        }
      </div>
    `;

    root.querySelector('[data-action="register-device"]')?.addEventListener('click', async () => {
      const nameInput = root.querySelector<HTMLInputElement>('[data-role="dev-name"]');
      const btn = root.querySelector<HTMLButtonElement>('[data-action="register-device"]');
      if (btn) btn.disabled = true;
      try {
        const res = await registerDeviceForIdea(idea.id, nameInput?.value || 'ESP32');
        oneTimeToken = res.rawToken;
        toast('تم تسجيل الجهاز — انسخ الرمز الآن');
        await loadAll();
      } catch (err: any) {
        toast('⚠️ ' + (err?.message || 'تعذّر تسجيل الجهاز'));
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    root.querySelector('[data-action="copy-token"]')?.addEventListener('click', () => {
      if (!oneTimeToken) return;
      navigator.clipboard?.writeText(oneTimeToken).then(() => {
        toast('تم نسخ رمز الجهاز');
      });
    });

    root.querySelector('[data-action="refresh-devices"]')?.addEventListener('click', () => {
      void loadAll();
    });
  }

  async function loadAll() {
    cleanup();
    devices = await listDevicesForIdea(idea.id);
    for (const d of devices) {
      const rows = await listRecentTelemetry(d.id, 1);
      if (rows.length) {
        latestReadingByDevice.set(d.id, rows[rows.length - 1]);
      }
    }

    if (devices.length) {
      unsubRealtime = subscribeIdeaTelemetry(
        idea.id,
        devices.map((d) => d.id),
        (reading) => {
          latestReadingByDevice.set(reading.device_id, reading);
          const dev = devices.find((x) => x.id === reading.device_id);
          const wasOffline = dev ? !dev.last_seen_at : true;
          if (dev) dev.last_seen_at = reading.created_at;

          const liveIdea = S.ideas.find((x) => x.id === idea.id);
          if ((liveIdea && liveIdea.lifecycle !== 'online') || wasOffline) {
            bus.emit('device:online', { deviceId: reading.device_id, ideaId: idea.id });
          }
          renderView();
        },
        (updatedDevice) => {
          const idx = devices.findIndex((x) => x.id === updatedDevice.id);
          if (idx >= 0) devices[idx] = updatedDevice;
          renderView();
        }
      );

      statusTimer = setInterval(() => {
        renderView();
      }, 5000);
    }

    renderView();
  }

  void loadAll();
  return root;
}
