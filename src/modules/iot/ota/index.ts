import { AppModule, isFeatureEnabled } from '../../../core';
import { renderOtaTab } from './ui';

export * from './logic';
export * from './ui';

export const iotOtaModule: AppModule = {
  id: 'iot.ota',
  enabled: (s) => isFeatureEnabled(s, 'iot.ota'),
  ideaTabs: [
    {
      id: 'ota',
      title: '🚀 التحديث اللاسلكي',
      render: (idea) => renderOtaTab(idea),
    },
  ],
};
