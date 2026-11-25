import { AppModule, isFeatureEnabled } from '../../../core';
import { renderTelemetryTab } from './ui';

export * from './logic';
export * from './ui';

export const iotTelemetryModule: AppModule = {
  id: 'iot.telemetry',
  enabled: (s) => isFeatureEnabled(s, 'iot.telemetry'),
  ideaTabs: [
    {
      id: 'telemetry',
      title: '📡 الأجهزة والبث الحي',
      render: (idea) => renderTelemetryTab(idea),
    },
  ],
};
