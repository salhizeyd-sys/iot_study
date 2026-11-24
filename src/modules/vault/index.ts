import { AppModule, isFeatureEnabled } from '../../core';
import { home } from './ui';

export * from './logic';
export * from './ui';

export const vaultModule: AppModule = {
  id: 'vault',
  enabled: (s) => isFeatureEnabled(s, 'vault'),
  routes: [
    {
      path: '/',
      title: 'خزانة الأفكار',
      render: () => home(),
    },
  ],
};
