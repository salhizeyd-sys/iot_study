import { bus, caps, registry } from './core';
import { initStore, S } from './store';
import { setupWindowGlobals, vaultModule, home } from './modules/vault';

registry.register(vaultModule);
registry.bindToBus(bus, () => S.settings);

setupWindowGlobals();
(window as any).caps = caps;

initStore()
  .catch((err) => {
    console.error('Failed to initialize IndexedDB store:', err);
  })
  .finally(() => {
    if (vaultModule.enabled(S.settings)) {
      home();
    }
  });
