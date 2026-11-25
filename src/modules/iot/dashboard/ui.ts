import {
  DashboardMode,
  DeviceRecord,
  Idea,
  IoTCommandRecord,
  bus,
} from '../../../core';
import {
  getCommandStatus,
  isDeviceOnline,
  listDeviceCommands,
  listDevicesForIdea,
  listRecentTelemetry,
  sendDeviceCommand,
  store,
  subscribeDeviceCommands,
  subscribeIdeaTelemetry,
} from '../../../store';
import { esc, toast } from '../../../ui';
import { SimulationController } from './simulator';
import { renderDashboardWidgets, TelemetryHistory, TelemetryState } from './widgets';

export function renderDashboardTab(idea: Idea): HTMLElement {
  const root = document.createElement('div');
  root.className = 'dash-tab';
  root.innerHTML = `<p style="color:var(--mu)">جارٍ تحميل لوحة التحكم…</p>`;

  let mode: DashboardMode = 'simulation';
  let controller: SimulationController | null = null;
  let unsubscribeBus: (() => void) | null = null;
  let unsubscribeLive: (() => void) | null = null;
  let unsubscribeCommands: (() => void) | null = null;
  let liveDevices: DeviceRecord[] = [];
  let liveCommands: IoTCommandRecord[] = [];
  let liveState: TelemetryState = {};
  let liveHistory: TelemetryHistory = {};

  function stopLiveSubscription() {
    unsubscribeLive?.();
    unsubscribeLive = null;
    unsubscribeCommands?.();
    unsubscribeCommands = null;
  }

  function cleanup() {
    if (controller?.isRunning()) {
      controller.stop();
    }
    controller = null;
    stopLiveSubscription();
    unsubscribeBus?.();
    unsubscribeBus = null;
  }

  const dlg = document.getElementById('dlg');
  if (dlg) {
    dlg.addEventListener('close', cleanup, { once: true });
  }

  function pushLiveValues(payload: Record<string, number | boolean | string>) {
    for (const [k, v] of Object.entries(payload)) {
      liveState[k] = v;
      if (typeof v === 'number' && Number.isFinite(v)) {
        const arr = liveHistory[k] ? [...liveHistory[k], v] : [v];
        liveHistory[k] = arr.slice(-20);
      }
    }
  }

  async function loadAndRender() {
    if (controller?.isRunning()) {
      controller.stop();
    }
    stopLiveSubscription();

    const latest = await store.getLatestPrototype(idea.id);
    if (!latest) {
      root.innerHTML = `<div class="warn">ولّد نموذجاً أولياً أولاً لتظهر لوحة التحكم والمحاكاة.</div>`;
      return;
    }

    const { dashboard, simulation } = latest.data;

    if (mode === 'live') {
      liveDevices = await listDevicesForIdea(idea.id);
      liveState = {};
      liveHistory = {};
      liveCommands = [];
      if (liveDevices.length) {
        const primaryDevice = liveDevices[0];
        const [recent, cmds] = await Promise.all([
          listRecentTelemetry(primaryDevice.id, 20),
          listDeviceCommands(primaryDevice.id, 8),
        ]);
        for (const r of recent) {
          pushLiveValues(r.payload || {});
        }
        liveCommands = cmds;
      }
    }

    const anyOnline = liveDevices.some((d) => isDeviceOnline(d.last_seen_at, 5000));

    root.innerHTML = `
      <div class="bar" style="justify-content:space-between">
        <div class="bar" style="margin:0">
          <button type="button" class="btn ${mode === 'simulation' ? '' : 'g'}" data-mode="simulation">🎮 محاكاة</button>
          <button type="button" class="btn ${mode === 'live' ? '' : 'g'}" data-mode="live">📡 بث حي (Realtime)</button>
        </div>
        ${
          mode === 'simulation'
            ? `<button type="button" class="btn" data-action="toggle-sim">▶ تشغيل المحاكاة</button>`
            : `<span class="tag ${anyOnline ? 'ok' : 'wn'}" data-role="live-badge">${
                anyOnline ? '🟢 جهاز متصل' : '⚪ بانتظار قراءة حية'
              }</span>`
        }
      </div>
      <div class="bar" style="margin-top:0">
        ${
          mode === 'simulation'
            ? `<span class="tag" data-role="sim-status">المحاكاة متوقفة</span>
               <span class="tag">الفاصل: ${simulation.interval_ms}ms</span>
               <span class="tag" data-role="frame-badge">الإطارات: ${simulation.frames.length}</span>`
            : `<span class="tag">${
                liveDevices.length
                  ? `الأجهزة: ${liveDevices.length}`
                  : 'لا يوجد جهاز مسجّل — افتح تبويب «📡 الأجهزة والبث الحي»'
              }</span>`
        }
      </div>
      <div class="dash-grid" data-role="widgets-host"></div>
      <div class="warn" style="font-size:13px" data-role="sim-state-line">الحالة المحلية: جاهزة</div>
      ${
        mode === 'live'
          ? `<div class="card" style="cursor:default;margin-top:10px" data-role="commands-box"></div>`
          : ''
      }
    `;

    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.mode as DashboardMode;
        if (nextMode && nextMode !== mode) {
          mode = nextMode;
          void loadAndRender();
        }
      });
    });

    const widgetsHost = root.querySelector<HTMLElement>('[data-role="widgets-host"]')!;
    const stateLine = root.querySelector<HTMLElement>('[data-role="sim-state-line"]')!;

    if (mode === 'simulation') {
      const statusBadge = root.querySelector<HTMLElement>('[data-role="sim-status"]')!;
      const frameBadge = root.querySelector<HTMLElement>('[data-role="frame-badge"]')!;
      const simBtn = root.querySelector<HTMLButtonElement>('[data-action="toggle-sim"]')!;

      const paintWidgets = (
        state: TelemetryState,
        history: TelemetryHistory,
        frameIdx: number
      ) => {
        const running = Boolean(controller?.isRunning());
        statusBadge.textContent = running ? 'قيد المحاكاة (حية)' : 'المحاكاة متوقفة';
        statusBadge.className = `tag ${running ? 'ok' : ''}`;
        simBtn.textContent = running ? '⏹ إيقاف المحاكاة' : '▶ تشغيل المحاكاة';
        frameBadge.textContent = simulation.frames.length
          ? `إطار ${frameIdx + 1}/${simulation.frames.length}`
          : 'لا إطارات';

        const pairs = Object.entries(state)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' · ');
        stateLine.textContent = `الحالة المحلية: ${pairs || '—'}`;

        renderDashboardWidgets(widgetsHost, dashboard, state, history, (key, value) => {
          controller?.setControlValue(key, value);
        });
      };

      controller = new SimulationController(
        simulation.frames,
        simulation.interval_ms,
        paintWidgets
      );

      paintWidgets(controller.getState(), controller.getHistory(), controller.getFrameIndex());

      simBtn.addEventListener('click', () => {
        if (!controller) return;
        if (controller.isRunning()) {
          controller.stop();
        } else {
          controller.start();
        }
      });
    } else {
      const renderCommandsList = () => {
        const box = root.querySelector<HTMLElement>('[data-role="commands-box"]');
        if (!box) return;
        box.innerHTML = `
          <b>🎛️ أوامر التحكم المرسلة للجهاز (${liveCommands.length})</b>
          ${
            liveCommands.length
              ? `<ul style="margin-top:6px">${liveCommands
                  .map((c) => {
                    const st = getCommandStatus(c);
                    const badge =
                      st === 'executed'
                        ? '<span class="tag ok">✅ نُفّذ</span>'
                        : st === 'expired'
                          ? '<span class="tag er">⌛ منتهي الصلاحية</span>'
                          : '<span class="tag wn">⏳ قيد الانتظار</span>';
                    return `<li><code>${esc(c.action)} = ${esc(
                      JSON.stringify(c.value)
                    )}</code> ${badge}</li>`;
                  })
                  .join('')}</ul>`
              : '<p style="color:var(--mu);margin:4px 0 0">استخدم المفاتيح أو المنزلقات أعلاه لإرسال أمر للجهاز.</p>'
          }`;
      };

      const paintLive = () => {
        const pairs = Object.entries(liveState)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' · ');
        stateLine.textContent = `البث الحي: ${pairs || 'بانتظار قراءات من الجهاز…'}`;

        const badge = root.querySelector<HTMLElement>('[data-role="live-badge"]');
        const onlineNow = liveDevices.some((d) => isDeviceOnline(d.last_seen_at, 5000));
        if (badge) {
          badge.className = `tag ${onlineNow ? 'ok' : 'wn'}`;
          badge.textContent = onlineNow ? '🟢 جهاز متصل' : '⚪ بانتظار قراءة حية';
        }

        renderCommandsList();

        renderDashboardWidgets(widgetsHost, dashboard, liveState, liveHistory, (key, val) => {
          liveState[key] = val;
          paintLive();

          const primary = liveDevices[0];
          if (primary) {
            void sendDeviceCommand(primary.id, key, val)
              .then((created) => {
                liveCommands = [
                  created,
                  ...liveCommands.filter((x) => x.id !== created.id),
                ].slice(0, 8);
                renderCommandsList();
                toast(`أُرسل الأمر «${key}» للجهاز`);
              })
              .catch((err: any) => {
                toast('⚠️ ' + (err?.message || 'تعذّر إرسال الأمر'));
              });
          } else {
            toast('⚠️ سجّل جهازاً أولاً لإرسال أوامر التحكم');
          }
        });
      };

      paintLive();

      if (liveDevices.length) {
        const primaryDeviceId = liveDevices[0].id;
        unsubscribeLive = subscribeIdeaTelemetry(
          idea.id,
          liveDevices.map((d) => d.id),
          (reading) => {
            pushLiveValues(reading.payload || {});
            const dev = liveDevices.find((d) => d.id === reading.device_id);
            if (dev) dev.last_seen_at = reading.created_at;
            paintLive();
          },
          (updatedDevice) => {
            const idx = liveDevices.findIndex((d) => d.id === updatedDevice.id);
            if (idx >= 0) liveDevices[idx] = updatedDevice;
            paintLive();
          }
        );

        unsubscribeCommands = subscribeDeviceCommands(primaryDeviceId, (cmd) => {
          const idx = liveCommands.findIndex((c) => c.id === cmd.id);
          if (idx >= 0) {
            liveCommands[idx] = cmd;
          } else {
            liveCommands = [cmd, ...liveCommands].slice(0, 8);
          }
          renderCommandsList();
        });
      }
    }
  }

  unsubscribeBus = bus.on('prototype:generated', (payload) => {
    if (payload.ideaId === idea.id) {
      void loadAndRender();
    }
  });

  root.dataset.ideaId = esc(idea.id);
  void loadAndRender();
  return root;
}
