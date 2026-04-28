
import { GraphQLClient } from "graphql-request";
import { resolveWclAccessToken } from "./oauth.js";

interface WclGraphqlClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
}

export class WclGraphqlClient {
    private token: string | null = null;
    private readonly gqlClient: GraphQLClient;

    public constructor(private readonly options: WclGraphqlClientOptions) {
        this.gqlClient = options.fetchImpl
            ? new GraphQLClient(options.apiBaseUrl, {
                  fetch: options.fetchImpl,
              })
            : new GraphQLClient(options.apiBaseUrl);
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
