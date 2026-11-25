import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { bus, caps, registry } from './core';
import { initStore, S, syncManager } from './store';
import {
  home,
  renderSyncPill,
  setupWindowGlobals,
  vaultModule,
} from './modules/vault';
import { iotPrototypeModule } from './modules/iot/prototype';
import { iotDashboardModule } from './modules/iot/dashboard';
import { iotTelemetryModule } from './modules/iot/telemetry';
import { iotFlashModule } from './modules/iot/flash';
import { iotOtaModule } from './modules/iot/ota';

registry.register(vaultModule);
registry.register(iotPrototypeModule);
registry.register(iotDashboardModule);
registry.register(iotTelemetryModule);
registry.register(iotFlashModule);
registry.register(iotOtaModule);
registry.bindToBus(bus, () => S.settings);

setupWindowGlobals();
(window as any).caps = caps;
syncManager.subscribe(renderSyncPill);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

initStore()
  .catch((err) => {
    console.error('Failed to initialize IndexedDB store:', err);
  })
  .finally(() => {
    if (vaultModule.enabled(S.settings)) {
      home();
    }
  });
