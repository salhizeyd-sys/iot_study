import { AppModule, isFeatureEnabled } from '../../../core';
import { renderPrototypeTab } from './ui';

export * from './schema';
export * from './pinChecker';
export * from './template';
export * from './generator';
export * from './ui';

export const iotPrototypeModule: AppModule = {
  id: 'iot.prototype',
  enabled: (s) => isFeatureEnabled(s, 'iot.prototype'),
  ideaTabs: [
    {
      id: 'prototype',
      title: '💻 الكود والتحذيرات',
      render: (idea) => renderPrototypeTab(idea),
    },
  ],
};
