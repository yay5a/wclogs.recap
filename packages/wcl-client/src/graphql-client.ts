
import { GraphQLClient } from "graphql-request";
import { resolveWclPublicClientBearerToken } from "./oauth.js";
import {
    publicClientAuthMode,
    resolveWclGraphqlApiBaseUrl,
    type WclAuthMode,
    type WclAuthModeKind,
    type WclPublicClientAuth,
} from "./auth-mode.js";

interface WclGraphqlClientOptions {
    publicClientAuth: WclPublicClientAuth;
    apiBaseUrl: string;
    userApiBaseUrl?: string;
    authMode?: WclAuthMode;
    fetchImpl?: typeof fetch;
}

export class WclGraphqlClient {
    private publicClientBearerToken: string | null = null;
    private readonly gqlClient: GraphQLClient;
    private readonly authMode: WclAuthMode;

    public constructor(private readonly options: WclGraphqlClientOptions) {
        this.authMode = options.authMode ?? publicClientAuthMode();
        const apiBaseUrl = resolveWclGraphqlApiBaseUrl({
            publicApiBaseUrl: options.apiBaseUrl,
            ...(options.userApiBaseUrl ? { userApiBaseUrl: options.userApiBaseUrl } : {}),
            authMode: this.authMode,
        });
        this.gqlClient = options.fetchImpl
            ? new GraphQLClient(apiBaseUrl, {
                  fetch: options.fetchImpl,
              })
            : new GraphQLClient(apiBaseUrl);
    }

    public getAuthModeKind(): WclAuthModeKind {
        return this.authMode.kind;
    }

    public async request<TPayload>(
        query: string,
        variables: Record<string, unknown>,
    ): Promise<TPayload> {
        await this.authorize();
        const payload = await this.gqlClient.request<Record<string, unknown>>(
            query,
            variables,
        );
        const wrapped =
            payload && typeof payload === "object" && "data" in payload
                ? payload
                : { data: payload };
        return wrapped as TPayload;
    }

    public async authorize(): Promise<void> {
        const token = await this.getBearerToken();
        this.gqlClient.setHeader("Authorization", `Bearer ${token}`);
    }

    private async getBearerToken(): Promise<string> {
        if (this.authMode.kind === "userLinked") {
            return this.authMode.userAccessToken;
        }

        if (this.publicClientBearerToken) return this.publicClientBearerToken;

        const token = await resolveWclPublicClientBearerToken(
            this.options.publicClientAuth,
            this.options.fetchImpl,
        );

        this.publicClientBearerToken = token;
        return token;
    }
}
