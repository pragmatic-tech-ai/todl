import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceProvider } from "@pragmatic-tech-ai/todl-runtime";
import { DataSourceKind } from "../connector-plan.js";
import { ConnectionResolver } from "../connection-resolver.js";
import { ConnectionStoreKey } from "../../solution-services/package-manager/engine/connection-store.js";
import { SecretStoreKey } from "../../solution-services/package-manager/engine/secret-store.js";
import { EnvironmentVariablesKey } from "../../solution-services/package-manager/engine/environment-variables.js";
import { TokenSource } from "../../solution-services/package-manager/engine/registry-connection.js";
import {
    FakeConnectionStore,
    FakeEnvironmentVariables,
    FakeSecretStore,
} from "../../solution-services/package-manager/engine/tests/fakes.js";

class ResolverFixture
{
    public static async Build(env?: Record<string, string>): Promise<ServiceProvider>
    {
        const store = new FakeConnectionStore();
        await store.Save({ Id: "crm", DisplayName: "CRM", RegistryType: "sql", Settings: { host: "catalog-host", database: "crm" } });
        await store.Save({
            Id: "envconn",
            DisplayName: "Env",
            RegistryType: "sql",
            Settings: { host: "h" },
            TokenSource: TokenSource.Env,
            TokenEnvVar: "DB_TOKEN",
        });
        const secrets = new FakeSecretStore();
        await secrets.Set("s", "pw");
        const services = new ServiceProvider();
        services.registerInstance(ConnectionStoreKey, store);
        services.registerInstance(SecretStoreKey, secrets);
        if (env !== undefined)
        {
            services.registerInstance(EnvironmentVariablesKey, new FakeEnvironmentVariables(env));
        }
        return services;
    }
}

test("named connection settings are overridden by inline config and secret is resolved", async () =>
{
    const services = await ResolverFixture.Build();
    const result = await new ConnectionResolver().Resolve(
        { Name: "x", Kind: DataSourceKind.Sql, Connection: "crm", Config: { host: "override" }, Secret: "s" },
        services);
    assert.equal(result.Kind, DataSourceKind.Sql);
    assert.equal(result.Config["host"], "override");
    assert.equal(result.Config["database"], "crm");
    assert.equal(result.Secret, "pw");
});

test("missing named connection rejects with a connector message", async () =>
{
    const services = await ResolverFixture.Build();
    await assert.rejects(
        () => new ConnectionResolver().Resolve({ Name: "x", Kind: DataSourceKind.Sql, Connection: "missing", Config: {} }, services),
        /connector.*missing/);
});

test("inline-only spec yields its config and no secret", async () =>
{
    const services = await ResolverFixture.Build();
    const result = await new ConnectionResolver().Resolve({ Name: "x", Kind: DataSourceKind.Rest, Config: { url: "u" } }, services);
    assert.deepEqual(result.Config, { url: "u" });
    assert.equal("Secret" in result, false);
});

test("env token source supplies the secret from the environment", async () =>
{
    const services = await ResolverFixture.Build({ DB_TOKEN: "tok" });
    const result = await new ConnectionResolver().Resolve({ Name: "x", Kind: DataSourceKind.Sql, Connection: "envconn", Config: {} }, services);
    assert.equal(result.Secret, "tok");
});

test("env token source tolerates a missing environment service", async () =>
{
    const services = await ResolverFixture.Build();
    const result = await new ConnectionResolver().Resolve({ Name: "x", Kind: DataSourceKind.Sql, Connection: "envconn", Config: {} }, services);
    assert.equal("Secret" in result, false);
});
