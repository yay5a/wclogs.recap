export type GuildRankSchemaProbeGameFamily = 'retail' | 'mop_classic';

export interface GuildRankSchemaProbeArgs {
  guildNameRaw: string;
  serverSlugRaw: string;
  serverRegionRaw: string;
  zoneId: number;
  difficulty: number;
  size: number;
  gameFamily?: GuildRankSchemaProbeGameFamily;
}

export const GUILD_RANK_SCHEMA_PROBE_USAGE = [
  'Usage:',
  '  pnpm --filter @wcl/wcl-client probe:guildrank-schema <guildName> <serverSlug> <serverRegion> <zoneId> <difficulty> <size> [gameFamily]',
  '',
  'Example:',
  '  WCL_OAUTH_CLIENT_TOKEN=... pnpm --filter @wcl/wcl-client probe:guildrank-schema "Guild Name" stormrage US 100 4 10 retail',
  '',
  'Required env:',
  '  WCL_OAUTH_CLIENT_TOKEN or WCL_CLIENT_ID and WCL_CLIENT_SECRET',
  '',
  'Optional env:',
  '  WCL_API_BASE_URL',
  '',
  'The script loads .env from the package directory or repo root when present.',
  'It prints endpoint/guild/zone metadata only; auth secrets are never printed.',
].join('\n');

type ParseResult = { ok: true; value: GuildRankSchemaProbeArgs } | { ok: false; message: string };

const integerPattern = /^-?\d+$/;

const parseInteger = (value: string, name: string): ParseResult | number => {
  if (!integerPattern.test(value)) {
    return {
      ok: false,
      message: `${name} must be an integer\n\n${GUILD_RANK_SCHEMA_PROBE_USAGE}`,
    };
  }
  return Number.parseInt(value, 10);
};

export const parseGuildRankSchemaProbeArgs = (args: string[]): ParseResult => {
  const [
    guildNameRaw,
    serverSlugRaw,
    serverRegionRaw,
    zoneIdRaw,
    difficultyRaw,
    sizeRaw,
    gameFamilyRaw,
  ] = args;

  if (
    !guildNameRaw ||
    !serverSlugRaw ||
    !serverRegionRaw ||
    !zoneIdRaw ||
    !difficultyRaw ||
    !sizeRaw
  ) {
    return { ok: false, message: GUILD_RANK_SCHEMA_PROBE_USAGE };
  }

  const zoneId = parseInteger(zoneIdRaw, 'zoneId');
  if (typeof zoneId !== 'number') return zoneId;
  const difficulty = parseInteger(difficultyRaw, 'difficulty');
  if (typeof difficulty !== 'number') return difficulty;
  const size = parseInteger(sizeRaw, 'size');
  if (typeof size !== 'number') return size;

  const gameFamily =
    gameFamilyRaw === undefined || gameFamilyRaw === 'retail' || gameFamilyRaw === 'mop_classic'
      ? gameFamilyRaw
      : undefined;
  if (gameFamilyRaw && !gameFamily) {
    return {
      ok: false,
      message: `gameFamily must be retail or mop_classic when provided\n\n${GUILD_RANK_SCHEMA_PROBE_USAGE}`,
    };
  }

  return {
    ok: true,
    value: {
      guildNameRaw,
      serverSlugRaw,
      serverRegionRaw,
      zoneId,
      difficulty,
      size,
      ...(gameFamily ? { gameFamily } : {}),
    },
  };
};
