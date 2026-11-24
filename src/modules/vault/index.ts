import { AppModule, isFeatureEnabled } from '../../core';
import { S, save } from '../../store';
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
  onEvent(event) {
    if (event.type === 'prototype:generated') {
      const idea = S.ideas.find((x) => x.id === event.payload.ideaId);
      if (idea && (idea.lifecycle === 'idea' || idea.lifecycle === 'planned')) {
        idea.lifecycle = 'prototype_generated';
        void save();
      }
    }
  },
};
