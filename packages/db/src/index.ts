import mongoose from 'mongoose';

export * from './models/wcl-user-auth-model.js';
export * from './models/character-claim-model.js';
export * from './models/dashboard-activity-model.js';
export * from './models/dashboard-onboarding-model.js';
export * from './models/guild-settings-model.js';
export * from './models/auto-report-prompt-state-model.js';
export * from './models/auto-report-duplicate-tracking-model.js';
export * from './models/guild-report-metadata-model.js';
export * from './models/report-rankings-model.js';
export * from './models/report-index-cache-model.js';
export * from './mongo-wcl-user-auth-store.js';
export * from './wcl-token-encryption.js';
export * from './stores/character-claim-store.js';
export * from './stores/guild-config-store.js';
export * from './stores/dashboard-activity-store.js';
export * from './stores/dashboard-onboarding-store.js';
export * from './stores/auto-report-prompt-state-store.js';
export * from './stores/auto-report-duplicate-tracking-store.js';
export * from './stores/guild-report-metadata-store.js';
export * from './stores/report-rankings-store.js';
export * from './stores/report-index-cache-store.js';

export const connectMongo = async (uri: string) => mongoose.connect(uri);
