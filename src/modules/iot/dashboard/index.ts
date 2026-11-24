import { AppModule, isFeatureEnabled } from '../../../core';
import { renderDashboardTab } from './ui';

export * from './widgets';
export * from './simulator';
export * from './ui';

export const iotDashboardModule: AppModule = {
  id: 'iot.dashboard',
  enabled: (s) => isFeatureEnabled(s, 'iot.dashboard'),
  ideaTabs: [
    {
      id: 'dashboard',
      title: '📊 لوحة التحكم والمحاكاة',
      render: (idea) => renderDashboardTab(idea),
    },
  ],
};
