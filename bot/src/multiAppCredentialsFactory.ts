import {
  AuthenticationConstants,
  GovernmentConstants,
  MicrosoftAppCredentials,
  MicrosoftGovernmentAppCredentials,
  type ServiceClientCredentials,
  type ServiceClientCredentialsFactory,
} from "botframework-connector";
import type { TeamsAppsStore } from "./teamsAppsStore";

/**
 * Bot Framework credentials factory that accepts multiple single-tenant app registrations.
 * Reloads the TeamsAppsStore on each call (store caches by file mtime).
 */
export class MultiAppCredentialsFactory implements ServiceClientCredentialsFactory {
  constructor(private readonly store: TeamsAppsStore) {}

  async isValidAppId(appId = ""): Promise<boolean> {
    return Boolean(this.store.getByAppId(appId));
  }

  async isAuthenticationDisabled(): Promise<boolean> {
    return this.store.list().length === 0;
  }

  async createCredentials(
    appId: string,
    audience: string | undefined,
    loginEndpoint: string,
    validateAuthority: boolean
  ): Promise<ServiceClientCredentials> {
    if (await this.isAuthenticationDisabled()) {
      return MicrosoftAppCredentials.Empty;
    }
    const app = this.store.getByAppId(appId);
    if (!app) throw new Error("Invalid appId.");

    const scope = audience || AuthenticationConstants.ToBotFromChannelTokenIssuer;
    const normalizedEndpoint = (loginEndpoint || "").toLowerCase();

    if (normalizedEndpoint.startsWith(AuthenticationConstants.ToChannelFromBotLoginUrlPrefix)) {
      return new MicrosoftAppCredentials(app.appId, app.appPassword, app.tenantId, scope);
    }
    if (normalizedEndpoint.startsWith(GovernmentConstants.ToChannelFromBotLoginUrlPrefix)) {
      return new MicrosoftGovernmentAppCredentials(app.appId, app.appPassword, app.tenantId, scope);
    }

    // Private cloud / custom login host
    const creds = new MicrosoftAppCredentials(app.appId, app.appPassword, app.tenantId, scope);
    (creds as MicrosoftAppCredentials & { oAuthEndpoint: string }).oAuthEndpoint = normalizedEndpoint;
    void validateAuthority;
    return creds;
  }
}
