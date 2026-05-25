import type { FastifyPluginAsync } from 'fastify';
import { registerDashboardClaimRoutes } from './dashboard/claim-routes.js';
import { registerDashboardGuildRoutes } from './dashboard/guild-routes.js';
import { registerDashboardSessionRoutes } from './dashboard/session-routes.js';
import type { DashboardRouteOptions } from './dashboard/types.js';

export { compareDashboardAdminSecret } from './dashboard/auth.js';
export { DASHBOARD_COOKIE_NAME } from './dashboard/types.js';
export type {
  DashboardActivityRecord,
  DashboardActivityStore,
  DashboardAuthContext,
  DashboardCapability,
  DashboardCharacterClaimStore,
  DashboardDirectory,
  DashboardGuildConfigStore,
  DashboardGuildConfigSummary,
  DashboardOnboardingStore,
} from './dashboard/types.js';

export const registerDashboardRoutes: FastifyPluginAsync<DashboardRouteOptions> = async (
  app,
  options,
) => {
  registerDashboardSessionRoutes(app, options);
  registerDashboardGuildRoutes(app, options);
  registerDashboardClaimRoutes(app, options);
};
