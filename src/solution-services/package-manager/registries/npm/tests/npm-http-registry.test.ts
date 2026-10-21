import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NpmHttpRegistry } from '../npm-http-registry.js'
import { NpmRegistryConnection } from '../npm-connection.js'
import { createTgz, type HttpRequest, type HttpResponse, type HttpTransport } from '../../../registry/index.js'
import { type PublishablePackage } from '../../../engine/package-registry.js'

const REGISTRY = 'https://npm.example'
const GITHUB = 'https://api.example'
const SCOPE = '@acme'
const enc = new TextEncoder()

// A minimal in-memory npm registry + GitHub org API covering the routes the client
// speaks: PUT/GET packument, GET tarball, GET org package list, and a GET on the
// registry base (the Test probe).
class InMemoryNpm implements HttpTransport
{
    private readonly packuments = new Map<string, Record<string, unknown>>()
    private readonly tarballs = new Map<string, Uint8Array>()
    private readonly names = new Set<string>()

    public request(req: HttpRequest): Promise<HttpResponse>
    {
        if (req.url.startsWith(`${GITHUB}/orgs/`)) return this.ok([...this.names].map((name) => ({ name })))
        if (req.url.includes('/-/')) return this.tarball(req.url)
        if (req.url === REGISTRY) return this.raw(200, '{}')
        const key = req.url.slice(REGISTRY.length + 1)
        return req.method === 'PUT' ? this.put(key, req) : this.packument(key)
    }

    private put(key: string, req: HttpRequest): Promise<HttpResponse>
    {
        const body = JSON.parse(req.body as string) as {
            name: string
            'dist-tags': Record<string, string>
            versions: Record<string, { dist: { tarball: string } }>
            _attachments: Record<string, { data: string }>
        }
        this.packuments.set(key, body)
        for (const [file, attachment] of Object.entries(body._attachments))
        {
            const match = Object.values(body.versions).find((v) => v.dist.tarball.endsWith(file))
            if (match !== undefined) this.tarballs.set(match.dist.tarball, new Uint8Array(Buffer.from(attachment.data, 'base64')))
        }
        this.names.add(body.name.replace(/^@[^/]+\//, ''))
        return this.raw(201, '{}')
    }

    private packument(key: string): Promise<HttpResponse>
    {
        const packument = this.packuments.get(key)
        return packument === undefined ? this.ok({ error: 'not found' }, 404) : this.ok(packument)
    }

    private tarball(url: string): Promise<HttpResponse>
    {
        const bytes = this.tarballs.get(url)
        return bytes === undefined ? this.ok({ error: 'not found' }, 404) : Promise.resolve({ status: 200, headers: {}, body: bytes })
    }

    private ok(value: unknown, status = 200): Promise<HttpResponse>
    {
        return Promise.resolve({ status, headers: {}, body: enc.encode(JSON.stringify(value)) })
    }

    private raw(status: number, text: string): Promise<HttpResponse>
    {
        return Promise.resolve({ status, headers: {}, body: enc.encode(text) })
    }
}

function connection(github: boolean = true): NpmRegistryConnection
{
    return new NpmRegistryConnection({
        Id: 'gh',
        DisplayName: 'GitHub',
        Registry: REGISTRY,
        Scope: SCOPE,
        Token: 'tok',
        ...(github ? { GithubApi: GITHUB, Org: 'acme' } : {}),
    })
}

// A transport answering canned responses by exact URL (GET only); anything else 404s.
class ScriptedTransport implements HttpTransport
{
    private readonly routes = new Map<string, HttpResponse>()

    public Route(url: string, status: number, body: unknown, headers: Record<string, string> = {}): this
    {
        this.routes.set(url, { status, headers, body: enc.encode(JSON.stringify(body)) })
        return this
    }

    public request(req: HttpRequest): Promise<HttpResponse>
    {
        const hit = this.routes.get(req.url.split('?')[0]!)
        return Promise.resolve(hit ?? { status: 404, headers: {}, body: enc.encode('{}') })
    }
}

function publishable(name: string, version: string): PublishablePackage
{
    const manifest = { name, version }
    const tarball = createTgz([{ path: 'package/package.json', bytes: enc.encode(JSON.stringify(manifest)) }])
    return { Manifest: manifest, Tarball: tarball }
}

test('publishes and reads a package back over the wire', async () =>
{
    const registry = new NpmHttpRegistry(connection(), new InMemoryNpm())
    const pkg = publishable('@acme/one', '1.0.0')

    await registry.Publish(pkg)

    assert.deepEqual((await registry.ListVersions('@acme/one')).versions, ['1.0.0'])
    assert.deepEqual([...(await registry.GetContent({ name: '@acme/one', version: '1.0.0' }))], [...pkg.Tarball])
    assert.equal((await registry.GetManifest({ name: '@acme/one', version: '1.0.0' })).version, '1.0.0')
})

test('lists packages published under the org', async () =>
{
    const registry = new NpmHttpRegistry(connection(), new InMemoryNpm())
    await registry.Publish(publishable('@acme/one', '1.0.0'))

    assert.deepEqual(await registry.ListPackages(), ['one'])
})

test('a reachable registry tests ok', async () =>
{
    const registry = new NpmHttpRegistry(connection(), new InMemoryNpm())

    assert.equal((await registry.Test()).Ok, true)
})

test('an unauthorized registry tests not-ok', async () =>
{
    const rejecting: HttpTransport = {
        request: () => Promise.resolve({ status: 401, headers: {}, body: new Uint8Array() }),
    }
    const registry = new NpmHttpRegistry(connection(), rejecting)

    const status = await registry.Test()
    assert.equal(status.Ok, false)
    assert.match(status.Message, /401/)
})

const USER_URL = `${GITHUB}/user`
const PACKAGES_URL = `${GITHUB}/orgs/acme/packages`
const WHOAMI_URL = `${REGISTRY}/-/whoami`

test('Inspect reports identity, scopes and packages for a classic PAT', async () =>
{
    const transport = new ScriptedTransport()
        .Route(REGISTRY, 200, {})
        .Route(USER_URL, 200, { login: 'octocat' }, { 'x-oauth-scopes': 'read:packages' })
        .Route(PACKAGES_URL, 200, [{ name: 'pkg-a' }])

    const result = await new NpmHttpRegistry(connection(), transport).Inspect()

    assert.equal(result.Ok, true)
    assert.equal(result.Identity, 'octocat')
    assert.deepEqual(result.Scopes, ['read:packages'])
    assert.equal(result.ScopesSupported, true)
    assert.deepEqual(result.Packages, ['pkg-a'])
    assert.equal(result.PackagesSupported, true)
})

test('Inspect on a fine-grained token has no scopes but still supports them', async () =>
{
    const transport = new ScriptedTransport()
        .Route(REGISTRY, 200, {})
        .Route(USER_URL, 200, { login: 'octocat' })
        .Route(PACKAGES_URL, 200, [])

    const result = await new NpmHttpRegistry(connection(), transport).Inspect()

    assert.deepEqual(result.Scopes, [])
    assert.equal(result.ScopesSupported, true)
    assert.equal(result.Identity, 'octocat')
})

test('Inspect on an unauthorized registry is not-ok and empty', async () =>
{
    const transport = new ScriptedTransport().Route(REGISTRY, 401, {})

    const result = await new NpmHttpRegistry(connection(), transport).Inspect()

    assert.equal(result.Ok, false)
    assert.equal(result.Identity, '')
    assert.deepEqual(result.Scopes, [])
    assert.deepEqual(result.Packages, [])
})

test('Inspect degrades when listing packages fails', async () =>
{
    const transport = new ScriptedTransport()
        .Route(REGISTRY, 200, {})
        .Route(USER_URL, 200, { login: 'octocat' })
        .Route(PACKAGES_URL, 404, {})

    const result = await new NpmHttpRegistry(connection(), transport).Inspect()

    assert.equal(result.Identity, 'octocat')
    assert.deepEqual(result.Packages, [])
    assert.equal(result.PackagesSupported, true)
})

test('Inspect on a generic npm registry reports only the whoami identity', async () =>
{
    const transport = new ScriptedTransport()
        .Route(REGISTRY, 200, {})
        .Route(WHOAMI_URL, 200, { username: 'alice' })

    const result = await new NpmHttpRegistry(connection(false), transport).Inspect()

    assert.equal(result.Identity, 'alice')
    assert.equal(result.ScopesSupported, false)
    assert.deepEqual(result.Scopes, [])
    assert.equal(result.PackagesSupported, false)
    assert.deepEqual(result.Packages, [])
})
