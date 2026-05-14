import { InteractionResponseType } from 'discord-interactions';
import type { DiscordInteraction, HandleOptions } from '../types.js';

const EPHEMERAL_MESSAGE_FLAG = 64;

export const handleCompareCommand = async (
  _interaction: DiscordInteraction,
  _options: HandleOptions,
): Promise<unknown> => ({
  type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
  data: {
    content: '/compare is temporarily unavailable while the report pipeline migration is in progress.',
    flags: EPHEMERAL_MESSAGE_FLAG,
  },
});
