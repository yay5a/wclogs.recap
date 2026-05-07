
import { GraphQLClient } from "graphql-request";
import { resolveWclAccessToken } from "./oauth.js";
import {
    publicClientAuthMode,
    resolveWclGraphqlApiBaseUrl,
    type WclAuthMode,
    type WclAuthModeKind,
} from "./auth-mode.js";

interface WclGraphqlClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    userApiBaseUrl?: string;
    authMode?: WclAuthMode;
    fetchImpl?: typeof fetch;
}

export class WclGraphqlClient {
    private token: string | null = null;
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
        return await this.gqlClient.request<TPayload>(query, variables);
    }

    public async authorize(): Promise<void> {
        const token = await this.getAccessToken();
        this.gqlClient.setHeader("Authorization", `Bearer ${token}`);
    }

    private async getAccessToken(): Promise<string> {
        if (this.token) return this.token;

        if (this.authMode.kind === "userLinked") {
            this.token = this.authMode.accessToken;
            return this.token;
        }

        const tokenOptions = {
            ...(process.env.WCL_OAUTH_TOKEN
                ? { explicitToken: process.env.WCL_OAUTH_TOKEN }
                : {}),
            ...(this.options.clientId
                ? { clientId: this.options.clientId }
                : {}),
            ...(this.options.clientSecret
                ? { clientSecret: this.options.clientSecret }
                : {}),
            ...(this.options.fetchImpl
                ? { fetchImpl: this.options.fetchImpl }
                : {}),
        };

        const token = await resolveWclAccessToken(tokenOptions);

        this.token = token;
        return token;
    }
}
