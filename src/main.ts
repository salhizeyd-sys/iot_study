import { setupWindowGlobals, home } from './ui';
import { initStore } from './store';

setupWindowGlobals();

initStore()
  .catch((err) => {
    console.error('Failed to initialize IndexedDB store:', err);
  })
  .finally(() => {
    home();
  });
