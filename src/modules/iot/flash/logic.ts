import { Idea } from '../../../core';

export function canStartFlash(options: {
  reviewConfirmed: boolean;
  binsCount: number;
}): { allowed: boolean; reason?: string } {
  if (!options.reviewConfirmed) {
    return { allowed: false, reason: 'يجب تأكيد المراجعة الإجبارية أولاً' };
  }
  if (options.binsCount <= 0) {
    return { allowed: false, reason: 'قم بالترجمة المحلية أولاً للحصول على ملفات .bin' };
  }
  return { allowed: true };
}

export function markIdeaReadyToFlash(idea: Idea): Idea {
  return {
    ...idea,
    lifecycle: 'ready_to_flash',
    updatedAt: Date.now(),
  };
}

export function markIdeaFlashed(idea: Idea): Idea {
  return {
    ...idea,
    lifecycle: 'flashed',
    updatedAt: Date.now(),
  };
}
