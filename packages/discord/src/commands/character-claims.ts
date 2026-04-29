import { InteractionResponseType } from "discord-interactions";
import {
    isCompareOfficer,
    resolveCharacterComparisonIdentity,
} from "@wcl/domain";
import type { DiscordInteraction, HandleOptions } from "../types.js";

const EPHEMERAL_MESSAGE_FLAG = 64;

const getStringOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};

export const getRequesterDiscordUserId = (
    interaction: DiscordInteraction,
): string | undefined => interaction.member?.user?.id ?? interaction.user?.id;

export const getRequesterRoleIds = (
    interaction: DiscordInteraction,
): string[] => interaction.member?.roles ?? [];

export const getRequesterPermissions = (
    interaction: DiscordInteraction,
): string | number | undefined => interaction.member?.permissions;

const trimRequired = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

const normalizeRegionForDisplay = (value: string): string => value.trim().toUpperCase();

export const buildExactCharacterClaimInput = (
    options: unknown,
): {
    characterName: string;
    realm: string;
    region: string;
    participantKey: string;
} | {
    error: string;
} => {
    const characterName = trimRequired(getStringOption(options, "character"));
    const realm = trimRequired(getStringOption(options, "realm"));
    const region = trimRequired(getStringOption(options, "region"));

    if (!characterName || !realm || !region) {
        return { error: "Character, realm, and region are required." };
    }

    const identity = resolveCharacterComparisonIdentity({
        characterName,
        realm,
        region,
    });

    if (identity.status !== "ready" || identity.kind !== "character") {
        return {
            error:
                identity.status === "ready"
                    ? "Character claims require exact character identity."
                    : identity.reason,
        };
    }

    return {
        characterName,
        realm,
        region: normalizeRegionForDisplay(region),
        participantKey: identity.participantKey,
    };
};

const ephemeral = (content: string) => ({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL_MESSAGE_FLAG },
});

const requireGuildAndUser = (
    interaction: DiscordInteraction,
): { guildId: string; requesterDiscordUserId: string } | { response: unknown } => {
    const guildId = interaction.guild_id;
    const requesterDiscordUserId = getRequesterDiscordUserId(interaction);

    if (!guildId) return { response: ephemeral("Guild context is required for this command.") };
    if (!requesterDiscordUserId) {
        return { response: ephemeral("Discord user context is required for this command.") };
    }

    return { guildId, requesterDiscordUserId };
};

const requireCharacterClaimStore = (options: HandleOptions): { response: unknown } | null =>
    options.characterClaimStore
        ? null
        : { response: ephemeral("Character claims are not available for this server yet.") };

const requireExactCharacterInput = (
    interaction: DiscordInteraction,
): ReturnType<typeof buildExactCharacterClaimInput> => buildExactCharacterClaimInput(interaction.data?.options);

const isOfficerForInteraction = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
    guildId: string,
): Promise<boolean> => {
    const guildConfig = await options.guildConfigStore.getGuildConfig(guildId);
    return isCompareOfficer({
        requesterDiscordUserId: getRequesterDiscordUserId(interaction) ?? "",
        requesterRoleIds: getRequesterRoleIds(interaction),
        requesterPermissions: getRequesterPermissions(interaction),
        guildSettings: guildConfig,
    });
};

const formatClaimLine = (claim: {
    characterName: string;
    realm: string;
    region: string;
    status: string;
    peerCompareOptIn: boolean;
    publicPostOptIn: boolean;
}): string =>
    `${claim.characterName} - ${claim.realm}-${claim.region}: ${claim.status} (peer compare: ${claim.peerCompareOptIn ? "allow" : "private"}, public post: ${claim.publicPostOptIn ? "allow" : "deny"})`;

export const handleClaimCharacterCommand = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown> => {
    const context = requireGuildAndUser(interaction);
    if ("response" in context) return context.response;
    const missingStore = requireCharacterClaimStore(options);
    if (missingStore) return missingStore.response;

    const character = requireExactCharacterInput(interaction);
    if ("error" in character) return ephemeral(character.error);

    try {
        await options.characterClaimStore?.requestCharacterClaim({
            guildId: context.guildId,
            discordUserId: context.requesterDiscordUserId,
            participantKey: character.participantKey,
            characterName: character.characterName,
            realm: character.realm,
            region: character.region,
        });
    } catch {
        return ephemeral("An active claim already exists for that exact character identity.");
    }

    return ephemeral("Character claim requested. An authorized raid role must approve it before comparisons are available.");
};

export const handleApproveCharacterCommand = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown> => {
    const context = requireGuildAndUser(interaction);
    if ("response" in context) return context.response;
    const missingStore = requireCharacterClaimStore(options);
    if (missingStore) return missingStore.response;

    if (!(await isOfficerForInteraction(interaction, options, context.guildId))) {
        return ephemeral("This action is limited to authorized raid roles.");
    }

    const targetDiscordUserId = getStringOption(interaction.data?.options, "user");
    if (!targetDiscordUserId) return ephemeral("Discord user is required.");

    const character = requireExactCharacterInput(interaction);
    if ("error" in character) return ephemeral(character.error);

    await options.characterClaimStore?.approveCharacterClaim({
        guildId: context.guildId,
        discordUserId: targetDiscordUserId,
        participantKey: character.participantKey,
        characterName: character.characterName,
        realm: character.realm,
        region: character.region,
        reviewedByDiscordUserId: context.requesterDiscordUserId,
    });

    return ephemeral("Character claim approved for the exact character identity.");
};

export const handleRejectCharacterCommand = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown> => {
    const context = requireGuildAndUser(interaction);
    if ("response" in context) return context.response;
    const missingStore = requireCharacterClaimStore(options);
    if (missingStore) return missingStore.response;

    if (!(await isOfficerForInteraction(interaction, options, context.guildId))) {
        return ephemeral("This action is limited to authorized raid roles.");
    }

    const targetDiscordUserId = getStringOption(interaction.data?.options, "user");
    if (!targetDiscordUserId) return ephemeral("Discord user is required.");

    const character = requireExactCharacterInput(interaction);
    if ("error" in character) return ephemeral(character.error);

    const rejected = await options.characterClaimStore?.rejectCharacterClaim({
        guildId: context.guildId,
        discordUserId: targetDiscordUserId,
        participantKey: character.participantKey,
        characterName: character.characterName,
        realm: character.realm,
        region: character.region,
        reviewedByDiscordUserId: context.requesterDiscordUserId,
    });

    return ephemeral(
        rejected
            ? "Character claim rejected."
            : "No pending character claim was found for that exact character identity.",
    );
};

export const handleMyCharactersCommand = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown> => {
    const context = requireGuildAndUser(interaction);
    if ("response" in context) return context.response;
    const missingStore = requireCharacterClaimStore(options);
    if (missingStore) return missingStore.response;

    const claims = await options.characterClaimStore?.listClaimsForUser({
        guildId: context.guildId,
        discordUserId: context.requesterDiscordUserId,
    });

    if (!claims?.length) return ephemeral("No character claims found.");

    return ephemeral(["Your character claims:", ...claims.slice(0, 10).map(formatClaimLine)].join("\n"));
};

export const handleComparePrivacyCommand = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown> => {
    const context = requireGuildAndUser(interaction);
    if ("response" in context) return context.response;
    const missingStore = requireCharacterClaimStore(options);
    if (missingStore) return missingStore.response;

    const character = requireExactCharacterInput(interaction);
    if ("error" in character) return ephemeral(character.error);

    const peerCompare = getStringOption(interaction.data?.options, "peer_compare");
    const publicPost = getStringOption(interaction.data?.options, "public_post");

    if (peerCompare !== "private" && peerCompare !== "allow_guild") {
        return ephemeral("Invalid peer_compare value. Choose private or allow_guild.");
    }
    if (publicPost !== "deny" && publicPost !== "allow") {
        return ephemeral("Invalid public_post value. Choose deny or allow.");
    }

    const updated = await options.characterClaimStore?.updateClaimPrivacy({
        guildId: context.guildId,
        discordUserId: context.requesterDiscordUserId,
        participantKey: character.participantKey,
        peerCompareOptIn: peerCompare === "allow_guild",
        publicPostOptIn: publicPost === "allow",
    });

    if (!updated) {
        return ephemeral("No approved character claim was found for that exact character identity.");
    }

    return ephemeral("Peer comparison access updated. Public posting preference updated.");
};
