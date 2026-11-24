import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { bus, caps, registry } from './core';
import { initStore, S } from './store';
import { setupWindowGlobals, vaultModule, home } from './modules/vault';
import { iotPrototypeModule } from './modules/iot/prototype';

registry.register(vaultModule);
registry.register(iotPrototypeModule);
registry.bindToBus(bus, () => S.settings);

setupWindowGlobals();
(window as any).caps = caps;

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
