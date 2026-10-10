import type { IServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import type { ConnectorSpec, ResolvedConnection } from "./connector-plan.js";
import type { IConnectionResolver } from "./data-source-adapter.js";
import { ConnectionStoreKey } from "../solution-services/package-manager/engine/connection-store.js";
import { SecretStoreKey } from "../solution-services/package-manager/engine/secret-store.js";
import { EnvironmentVariablesKey } from "../solution-services/package-manager/engine/environment-variables.js";
import { TokenSource, type ConnectionSpec } from "../solution-services/package-manager/engine/registry-connection.js";

/**
 * Resolves a connector spec against the named-connection store (base settings),
 * the inline config (overrides) and the secret/environment stores (secret value).
 */
export class ConnectionResolver implements IConnectionResolver
{
    private static readonly MissingConnectionPrefix = "connector '";
    private static readonly MissingConnectionMiddle = "': named connection '";
    private static readonly MissingConnectionSuffix = "' was not found";

    public async Resolve(spec: ConnectorSpec, services: IServiceProvider): Promise<ResolvedConnection>
    {
        const config: Record<string, string> = {};
        let named: ConnectionSpec | undefined;
        if (spec.Connection !== undefined)
        {
            named = await services.getRequired(ConnectionStoreKey).Get(spec.Connection);
            if (named === undefined)
            {
                throw new Error(
                    ConnectionResolver.MissingConnectionPrefix + spec.Name
                    + ConnectionResolver.MissingConnectionMiddle + spec.Connection
                    + ConnectionResolver.MissingConnectionSuffix);
            }
            Object.assign(config, named.Settings);
        }
        Object.assign(config, spec.Config);

        const secret = await this.ResolveSecret(spec, named, services);
        return secret === undefined
            ? { Kind: spec.Kind, Config: config }
            : { Kind: spec.Kind, Config: config, Secret: secret };
    }

    private async ResolveSecret(spec: ConnectorSpec, named: ConnectionSpec | undefined, services: IServiceProvider): Promise<string | undefined>
    {
        if (spec.Secret !== undefined)
        {
            return services.getRequired(SecretStoreKey).Get(spec.Secret);
        }
        if (named !== undefined && named.TokenSource === TokenSource.Env && named.TokenEnvVar !== undefined)
        {
            return services.get(EnvironmentVariablesKey)?.Get(named.TokenEnvVar);
        }
        return undefined;
    }
}
