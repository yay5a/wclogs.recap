import { createLogger, serializeError } from '@wcl/shared';
import type { BotActivityEvent } from '@wcl/domain';
import type { DashboardActivityStore } from './types.js';

const logger = createLogger('web');

export const recordActivity = async (
  store: DashboardActivityStore | undefined,
  event: Omit<BotActivityEvent, 'createdAt'>,
) => {
  if (!store) return;

  try {
    await store.recordActivity({ ...event, createdAt: new Date() });
  } catch (error) {
    logger.warn(
      {
        guildId: event.guildId,
        kind: event.kind,
        idempotencyKey: event.idempotencyKey,
        error: serializeError(error),
      },
      'dashboard activity recording failed',
    );
  }
};
