import { WclUserAuthModel } from "./models/wcl-user-auth-model.js";

export type UpsertWclUserAuthInput = {
    provider: "warcraftlogs";
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    updatedAt: Date;
};

export class MongoWclUserAuthStore {
    async get() {
        return WclUserAuthModel.findOne({ provider: "warcraftlogs" }).lean();
    }

    async upsert(entry: UpsertWclUserAuthInput) {
        await WclUserAuthModel.findOneAndUpdate(
            { provider: entry.provider },
            entry,
            { upsert: true },
        );
    }
}
