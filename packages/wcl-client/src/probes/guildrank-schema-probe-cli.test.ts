import { describe, expect, it } from 'vitest';
import {
  GUILD_RANK_SCHEMA_PROBE_USAGE,
  parseGuildRankSchemaProbeArgs,
} from './guildrank-schema-probe-cli.js';

describe('guildrank schema probe CLI validation', () => {
  it('prints stable usage with env requirements when required args are missing', () => {
    expect(parseGuildRankSchemaProbeArgs([])).toEqual({
      ok: false,
      message: GUILD_RANK_SCHEMA_PROBE_USAGE,
    });
    expect(GUILD_RANK_SCHEMA_PROBE_USAGE).toContain('WCL_OAUTH_CLIENT_TOKEN');
    expect(GUILD_RANK_SCHEMA_PROBE_USAGE).toContain('WCL_CLIENT_ID');
    expect(GUILD_RANK_SCHEMA_PROBE_USAGE).toContain('WCL_CLIENT_SECRET');
    expect(GUILD_RANK_SCHEMA_PROBE_USAGE).toContain('auth secrets are never printed');
  });

  it('rejects invalid numeric arguments with usage context', () => {
    expect(
      parseGuildRankSchemaProbeArgs(['Guild', 'stormrage', 'US', 'zone-100', '4', '10']),
    ).toEqual({
      ok: false,
      message: `zoneId must be an integer\n\n${GUILD_RANK_SCHEMA_PROBE_USAGE}`,
    });
  });
});
