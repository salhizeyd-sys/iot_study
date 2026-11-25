import { AppModule, isFeatureEnabled } from '../../core';
import { S, save } from '../../store';
import { toast } from '../../ui';
import { focusView, home } from './ui';

export * from './logic';
export * from './focus';
export * from './ui';

export const vaultModule: AppModule = {
  id: 'vault',
  enabled: (s) => isFeatureEnabled(s, 'vault'),
  routes: [
    {
      path: '/',
      title: 'Sharara',
      render: () => home(),
    },
    {
      path: '/focus',
      title: '🎯 التركيز',
      render: () => focusView(),
    },
  ],
  onEvent(event) {
    if (event.type === 'prototype:generated') {
      const idea = S.ideas.find((x) => x.id === event.payload.ideaId);
      if (
        idea &&
        (idea.lifecycle === 'idea' ||
          idea.lifecycle === 'planned' ||
          idea.lifecycle === 'cooldown')
      ) {
        idea.lifecycle = 'prototype_generated';
        void save();
      }
    } else if (event.type === 'device:online') {
      const idea = S.ideas.find((x) => x.id === event.payload.ideaId);
      if (idea && idea.lifecycle !== 'online' && idea.lifecycle !== 'done') {
        idea.lifecycle = 'online';
        void save();
        toast('🎉 تهانينا! الجهاز متصل الآن ووصلت أول قراءة حية.');
      }
    } else if (event.type === 'idea:updated') {
      if (typeof document !== 'undefined' && document.getElementById('grid')) {
        home();
      }
    }
  },
};
