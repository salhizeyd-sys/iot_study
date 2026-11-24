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
      title: '🔌 النموذج الأولي (ESP32)',
      render: (idea) => renderPrototypeTab(idea),
    },
  ],
};
