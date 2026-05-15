export type WclAuthModeKind = "publicClient" | "userLinked";

export type WclPublicClientAuth =
    | {
          kind: "clientCredentials";
          clientId: string;
          clientSecret: string;
      }
    | {
          kind: "clientToken";
          clientToken: string;
      };

export type PublicClientWclAuthMode = {
    kind: "publicClient";
};

export type UserLinkedWclAuthMode = {
    kind: "userLinked";
    discordUserId: string;
    userAccessToken: string;
};

export type WclAuthMode = PublicClientWclAuthMode | UserLinkedWclAuthMode;

export const publicClientAuthMode = (): PublicClientWclAuthMode => ({
    kind: "publicClient",
});

export const userLinkedAuthMode = (
    discordUserId: string,
    userAccessToken: string,
): UserLinkedWclAuthMode => ({
    kind: "userLinked",
    discordUserId,
    userAccessToken,
});

const readNonEmpty = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

export const resolveWclPublicClientAuth = (input: {
    clientId?: string | undefined;
    clientSecret?: string | undefined;
    clientToken?: string | undefined;
}): WclPublicClientAuth => {
    const clientId = readNonEmpty(input.clientId);
    const clientSecret = readNonEmpty(input.clientSecret);
    const clientToken = readNonEmpty(input.clientToken);

    if (clientId && clientSecret) {
        return { kind: "clientCredentials", clientId, clientSecret };
    }

    if (clientId || clientSecret) {
        throw new Error("WCL_CLIENT_ID and WCL_CLIENT_SECRET must be set together.");
    }

    if (clientToken) return { kind: "clientToken", clientToken };

    throw new Error(
        "Missing WCL public client auth. Provide WCL_CLIENT_ID and WCL_CLIENT_SECRET, or WCL_OAUTH_CLIENT_TOKEN.",
    );
};

export const deriveWclUserApiBaseUrl = (publicApiBaseUrl: string): string => {
    const url = new URL(publicApiBaseUrl);
    const normalizedPath = url.pathname.replace(/\/+$/u, "");
    if (normalizedPath.endsWith("/api/v2/client")) {
        url.pathname = normalizedPath.replace(/\/client$/u, "/user");
        return url.toString();
    }
    if (normalizedPath.endsWith("/api/v2/user")) {
        url.pathname = normalizedPath;
        return url.toString();
    }

    url.pathname = "/api/v2/user";
    url.search = "";
    url.hash = "";
    return url.toString();
};

export const resolveWclGraphqlApiBaseUrl = (options: {
    publicApiBaseUrl: string;
    userApiBaseUrl?: string;
    authMode: WclAuthMode;
}): string =>
    options.authMode.kind === "publicClient"
        ? options.publicApiBaseUrl
        : options.userApiBaseUrl ?? deriveWclUserApiBaseUrl(options.publicApiBaseUrl);
