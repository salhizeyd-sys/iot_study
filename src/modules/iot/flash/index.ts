import { AppModule, isFeatureEnabled } from '../../../core';
import { renderFlashTab } from './ui';

export * from './compiler';
export * from './esptool';
export * from './logic';
export * from './serial';
export * from './ui';

export const iotFlashModule: AppModule = {
  id: 'iot.flash',
  enabled: (s) => isFeatureEnabled(s, 'iot.flash'),
  ideaTabs: [
    {
      id: 'flash',
      title: '⚡ الرفع والتهيئة',
      render: (idea) => renderFlashTab(idea),
    },
  ],
};
