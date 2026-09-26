import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createTgz } from "../tar.js";
import { TarReader } from "../tar-reader.js";
import { TarArchive, type TarEntry } from "../tar-archive.js";
import { WebTgz } from "../web-tgz.js";

class TgzFixtures
{
    private static readonly Encoder = new TextEncoder();
    // > 100 bytes so the USTAR prefix/name split is exercised.
    private static readonly LongPath = `package/resources/${"deeply/nested/".repeat(6)}asset.json`;

    public static Entries(): TarEntry[]
    {
        return [
            { path: "package/package.json", bytes: TgzFixtures.Encoder.encode('{"name":"x","version":"1.0.0"}') },
            { path: "package/model.json", bytes: TgzFixtures.Encoder.encode('{"nodes":[]}') },
            { path: "package/src/model.todl", bytes: TgzFixtures.Encoder.encode("namespace acme {}\n") },
            { path: TgzFixtures.LongPath, bytes: new Uint8Array(777).fill(7) },
            { path: "package/empty.txt", bytes: new Uint8Array(0) },
        ];
    }

    public static AssertSameEntries(actual: readonly { path: string; bytes: Uint8Array }[], expected: readonly TarEntry[]): void
    {
        assert.deepEqual(actual.map((f) => f.path), expected.map((e) => e.path));
        for (let i = 0; i < expected.length; i++)
        {
            assert.deepEqual([...actual[i]!.bytes], [...expected[i]!.bytes], `bytes differ for ${expected[i]!.path}`);
        }
    }
}

describe("WebTgz (browser-safe CompressionStream codec)", () =>
{
    test("Create output is npm-compatible: node:zlib gunzips it and TarReader reads every entry back", async () =>
    {
        const entries = TgzFixtures.Entries();
        const tgz = await WebTgz.Create(entries);

        assert.deepEqual([...gunzipSync(tgz)], [...TarArchive.Pack(entries)], "gunzipped payload is the exact USTAR archive");
        TgzFixtures.AssertSameEntries(TarReader.read(tgz), entries);
    });

    test("Read unpacks a node:zlib createTgz archive", async () =>
    {
        const entries = TgzFixtures.Entries();

        TgzFixtures.AssertSameEntries(await WebTgz.Read(createTgz(entries)), entries);
    });

    test("Create -> Read round-trips paths and exact bytes", async () =>
    {
        const entries = TgzFixtures.Entries();

        TgzFixtures.AssertSameEntries(await WebTgz.Read(await WebTgz.Create(entries)), entries);
    });

    test("createTgz and WebTgz.Create share one tar layout", async () =>
    {
        const entries = TgzFixtures.Entries();

        assert.deepEqual([...gunzipSync(createTgz(entries))], [...gunzipSync(await WebTgz.Create(entries))]);
    });

    test("Read rejects bytes that are not gzip", async () =>
    {
        await assert.rejects(() => WebTgz.Read(new TextEncoder().encode("not a gzip stream")));
    });
});
