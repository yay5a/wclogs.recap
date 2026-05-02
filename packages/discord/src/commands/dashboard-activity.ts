import { createLogger, serializeError } from '@wcl/shared';
import type { BotActivityEvent, BotActivityStore } from '@wcl/domain';

const logger = createLogger('discord');

export const recordDashboardActivityAfterSuccess = async (
  activityStore: BotActivityStore | undefined,
  event: BotActivityEvent,
): Promise<void> => {
  if (!activityStore) return;

  try {
    await activityStore.recordActivity(event);
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
