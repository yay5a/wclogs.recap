export type WclAuthModeKind = "publicClient" | "userLinked";

export type PublicClientWclAuthMode = {
    kind: "publicClient";
};

export type UserLinkedWclAuthMode = {
    kind: "userLinked";
    discordUserId: string;
    accessToken: string;
};

export type WclAuthMode = PublicClientWclAuthMode | UserLinkedWclAuthMode;

export const publicClientAuthMode = (): PublicClientWclAuthMode => ({
    kind: "publicClient",
});

export const userLinkedAuthMode = (
    discordUserId: string,
    accessToken: string,
): UserLinkedWclAuthMode => ({
    kind: "userLinked",
    discordUserId,
    accessToken,
});

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
