import { Context } from '@deepseek-ai/cordis'
import { DshStandardAdapter } from '@dsh-std/adapter-dsh'
import { parseManifest, projectManifest } from '@dsh-std/manifest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyCommand, DATA_AGENT_TOOL_NAMES } from '../src/command.ts'
import { createConnectionStore } from '../src/connections.ts'
import { apply as applyTools } from '../src/tool.ts'
import {
  assertSensitiveContentFree,
  collectCurrentInventory,
  createClaim,
  createStandardEffectLedgerRecord,
  effectCleanupDisposition,
  evidenceCeiling,
  loadConformanceMetadata,
  negotiateManifest,
  requireEvidenceLevel,
  runSourceConformance,
  sha256,
  validateClaimV015,
  validateInventory,
  validateManifest,
  validatePackedManifest,
} from '../scripts/lib/dsh-ecosystem-conformance.mjs'

const root = new URL('../', import.meta.url)
const rootPath = root.pathname
const temporaryDirectories: string[] = []

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(new URL(relativePath, root), 'utf8'))
}

function hostFixture(name: 'eligible' | 'degraded' | 'rejected'): any {
  return readJson(`conformance/dsh-ecosystem/fixtures/host-${name}.fixture.json`)
}

function digest(value: string): string {
  return sha256(value)
}

function evidence(overrides: Record<string, unknown> = {}): any {
  return {
    declared: true,
    parsed: true,
    hostDescriptorKind: 'fixture',
    negotiated: true,
    ...overrides,
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  }
})

describe('Community v0.15 manifest and frozen native inventory', () => {
  it('parses the source manifest offline and keeps the evidence ceiling at Parsed for fixtures', () => {
    const result = runSourceConformance({
      root: rootPath,
      hostDescriptor: hostFixture('eligible'),
      hostDescriptorKind: 'fixture',
      requestedEvidence: 'Parsed',
    })

    expect(result.report).toMatchObject({
      subject: 'io.github.omdsh-dev.dsh-data-agent',
      result: 'pass',
      evidenceLevel: 'Parsed',
      evidenceCeiling: 'Parsed',
      hostDescriptorKind: 'fixture',
      negotiation: { decision: 'compatible' },
    })
    expect(result.report.evidenceResults).toMatchObject({
      Declared: { status: 'pass' },
      Parsed: { status: 'pass' },
      Negotiated: { status: 'fixture-only' },
      Tested: { status: 'not-run' },
      Observed: { status: 'not-run' },
      Attested: { status: 'not-run' },
    })
    expect(result.manifest.parsed.requires.contracts.map((row: any) => `${row.apiVersion}#${row.kind}`)).toEqual([
      'commands.dsh/v1alpha1#Command',
      'storage.dsh/v1alpha1#LocalStorage',
    ])
    expect(JSON.stringify(result.manifest.parsed)).not.toContain('UserInteraction')
    expect(result.report.restrictions).toContain('user-interaction-negotiation-spec-gap')
    expect(() => validatePackedManifest(
      result.manifest.source,
      readJson('package.json').version,
      ['dsh-plugin.json', 'lib/ecosystem.js'],
      result.metadata.baseline,
    )).not.toThrow()
    expect(() => validatePackedManifest(
      result.manifest.source,
      readJson('package.json').version,
      ['dsh-plugin.json'],
      result.metadata.baseline,
    )).toThrow(/entry is not packaged/u)
  })

  it('freezes commands, tools, routes, slots, service, storage, database types, exports, and package rows', () => {
    const metadata = loadConformanceMetadata(rootPath)
    const inventory = collectCurrentInventory(rootPath)

    expect(inventory).toMatchObject({
      bundleRows: ['@yejiming/dsh-data-agent', '@yejiming/dsh-data-agent/routes'],
      commands: ['catalog', 'database'],
      tools: ['catalog-get', 'catalog-search', 'metric-get', 'render-analysis', 'sql-cmd', 'sql-query', 'sql-write', 'str_replace_editor'],
      services: ['dataAgentCatalog', 'dataAgentCatalogReview', 'dataAgentCatalogScanner', 'dataAgentConnections'],
      routes: expect.arrayContaining([
        'GET catalog/assets/:assetId', 'GET catalog/diff', 'GET catalog/runs', 'GET catalog/search',
        'GET catalog/semantics/:semanticId', 'GET catalog/sources', 'GET catalog/status',
        'POST catalog/cancel', 'POST catalog/scan', 'POST catalog/semantics',
        'POST catalog/semantics/:semanticId/retire', 'POST catalog/semantics/:semanticId/verify',
      ]),
      webSlots: ['conversation.input.right', 'tool.call.toolview'],
      storageDomains: ['data_agent_catalog@1', 'data_agent_connections@1'],
      databaseTypes: ['clickhouse', 'doris', 'hive', 'impala', 'mysql', 'oracle', 'postgres', 'sqlite', 'sqlserver'],
    })
    expect(inventory.publicExports).toEqual(expect.arrayContaining(metadata.inventory.nativeRuntime.publicExports))
    expect(inventory.packageFiles).toEqual(expect.arrayContaining(metadata.inventory.nativeRuntime.packageFiles))
    expect(() => validateInventory(rootPath, metadata.inventory, metadata.restrictions)).not.toThrow()

    const staleInventory = structuredClone(metadata.inventory)
    staleInventory.nativeRuntime.routes = staleInventory.nativeRuntime.routes.slice(0, -1)
    expect(() => validateInventory(rootPath, staleInventory, metadata.restrictions)).toThrow(/routes drifted/u)
  })

  it('rejects an unknown protocol instead of accepting a local definition', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-data-agent-manifest-negative-'))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, 'lib'), { recursive: true })
    writeFileSync(join(directory, 'package.json'), readFileSync(new URL('package.json', root)))
    writeFileSync(join(directory, 'lib', 'ecosystem.js'), 'export default {}\n')
    const manifest = readJson('dsh-plugin.json')
    manifest.requires.contracts.push({ apiVersion: 'private.example/v1alpha1', kind: 'InventedProtocol' })
    writeFileSync(join(directory, 'dsh-plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)

    expect(() => validateManifest(directory, loadConformanceMetadata(rootPath).baseline)).toThrow(/not admitted|unknown|definition/iu)
  })
})

describe('fixture negotiation and actual adapter coexistence', () => {
  it('distinguishes eligible, optional-fallback, and rejected fixture decisions', () => {
    const metadata = loadConformanceMetadata(rootPath)
    const manifest = validateManifest(rootPath, metadata.baseline)

    expect(negotiateManifest(manifest, hostFixture('eligible'), metadata.baseline)).toMatchObject({
      decision: 'compatible',
      missingRequired: [],
      missingOptional: [],
    })
    expect(negotiateManifest(manifest, hostFixture('degraded'), metadata.baseline)).toMatchObject({
      decision: 'compatible_degraded',
      missingRequired: [],
      missingOptional: ['storage.dsh/v1alpha1#LocalStorage'],
      fallbacks: [{ contract: 'storage.dsh/v1alpha1#LocalStorage' }],
    })
    expect(negotiateManifest(manifest, hostFixture('rejected'), metadata.baseline)).toMatchObject({
      decision: 'rejected',
      reasonCode: 'REQUIRED_PROTOCOL_UNAVAILABLE',
      missingRequired: ['commands.dsh/v1alpha1#Command'],
    })
    for (const name of ['eligible', 'degraded', 'rejected'] as const) {
      expect(hostFixture(name).hostId).toContain('fixture.')
      expect(hostFixture(name).hostVersion).toContain('fixture')
    }
  })

  it.runIf(existsSync(new URL('lib/ecosystem.js', root)))('mounts and unmounts the built declaration without a second functional handler', async () => {
    const facet = (await import('../lib/ecosystem.js')).default
    const ctx = new Context()
    const adapter = new DshStandardAdapter(ctx, {
      profileBaseUrl: 'dsh://fixture/data-agent',
      runtimeId: 'fixture-data-agent',
      discover: false,
    })
    const manifest = projectManifest(parseManifest(readFileSync(new URL('dsh-plugin.json', root), 'utf8')))
    const dispose = await adapter.mount({
      manifest,
      facet: 'host',
      activate: context => facet.activate(context),
      deactivate: reason => facet.deactivate?.(reason),
      snapshot: () => facet.snapshot?.() ?? {},
    })

    try {
      const snapshot = await adapter.snapshot()
      expect(snapshot.facets).toHaveLength(1)
      expect(snapshot.facets[0]).toMatchObject({ state: 'degraded', extensions: [] })

      const nativeTools: string[] = []
      applyTools({
        tools: { register(definition: { name: string }) { nativeTools.push(definition.name) } },
        subprocess: {
          resolveExecutable: async (command: string) => `/usr/bin/${command}`,
          spawn: () => ({ done: Promise.resolve({ exitCode: 0, signal: null }), collected: {} }),
        },
        dataAgentConnections: createConnectionStore(),
        dataAgentCatalog: {
          resolveSource: async () => ({ id: 'source-a' }),
          search: async () => ({ sourceId: 'source-a', query: '*', items: [], truncated: false, warnings: [] }),
          getAsset: () => { throw new Error('unused') },
          getMetric: () => { throw new Error('unused') },
        },
        get() { return undefined },
      } as never, {
        queryTimeoutMs: 5000,
        maxResultChars: 20000,
        maxRows: 100,
        maxQueryChars: 65536,
        readonly: false,
        clients: {},
      })

      const nativeCommands: string[] = []
      applyCommand({
        tools: { restrict() {}, schemas: () => DATA_AGENT_TOOL_NAMES.map(name => ({ name })) },
        commands: { register(definition: { name: string }) { nativeCommands.push(definition.name) } },
        dataAgentConnections: createConnectionStore(),
        get() { return undefined },
        emit() {},
        effect(setup: () => () => void) { return { dispose: setup() } },
      } as never, { isDshTuiPluginLoaded: () => true })

      expect(nativeTools).toEqual(['sql-query', 'sql-write', 'sql-cmd', 'render-analysis', 'catalog-search', 'catalog-get', 'metric-get'])
      expect(nativeCommands).toEqual(['database', 'catalog'])
      expect(collectCurrentInventory(rootPath)).toMatchObject({
        commands: ['catalog', 'database'],
        services: ['dataAgentCatalog', 'dataAgentCatalogReview', 'dataAgentCatalogScanner', 'dataAgentConnections'],
        storageDomains: ['data_agent_catalog@1', 'data_agent_connections@1'],
      })
    } finally {
      await dispose()
    }

    expect((await adapter.snapshot()).facets).toEqual([])
  })

  it.runIf(existsSync(new URL('lib/ecosystem.js', root)))('keeps the built entry declaration-only and process-I/O free', async () => {
    const source = readFileSync(new URL('src/ecosystem.ts', root), 'utf8')
    const built = readFileSync(new URL('lib/ecosystem.js', root), 'utf8')
    for (const marker of ["'./index", "'./command", "'./routes", "'./tool", 'process.stdin', 'process.stdout', 'node:child_process', 'node:net']) {
      expect(source).not.toContain(marker)
      expect(built).not.toContain(marker)
    }
    const facet = (await import('../lib/ecosystem.js')).default
    expect(await facet.activate({} as never)).toBeUndefined()
    expect(await facet.deactivate?.('test')).toBeUndefined()
    expect(await facet.snapshot?.()).toMatchObject({ state: 'degraded', extensions: [] })
  })

  it('ships clearly labelled disposable profile fixtures', () => {
    const native = readJson('conformance/dsh-ecosystem/fixtures/profiles/native-only/package.json')
    const adapter = readJson('conformance/dsh-ecosystem/fixtures/profiles/native-plus-adapter/package.json')
    expect(native).toMatchObject({ private: true, fixture: true })
    expect(adapter).toMatchObject({ private: true, fixture: true })
    expect(native.dependencies['@yejiming/dsh-data-agent']).toBe('file:../../../../..')
    expect(adapter.dependencies).toMatchObject({
      '@dsh-std/adapter-dsh': '0.1.0-rc3',
      '@yejiming/dsh-data-agent': 'file:../../../../..',
    })
  })
})

describe('evidence ceilings, lifecycle ownership, and sensitive-content rejection', () => {
  it('never promotes fixture negotiation or source-only checks beyond Parsed', () => {
    expect(evidenceCeiling(evidence())).toBe('Parsed')
    expect(evidenceCeiling(evidence({ artifactDigest: digest('artifact'), suitePassed: true }))).toBe('Parsed')
    expect(() => requireEvidenceLevel('Negotiated', evidence())).toThrow(/exceeds evidence ceiling Parsed/u)
    expect(() => requireEvidenceLevel('Tested', evidence({ artifactDigest: digest('dry-run'), suitePassed: true }))).toThrow(/exceeds evidence ceiling Parsed/u)
    expect(evidenceCeiling(evidence({
      hostDescriptorKind: 'real',
      artifactDigest: digest('artifact'),
      suitePassed: true,
      lifecycleObserved: true,
      presentationObserved: false,
    }))).toBe('Tested')
  })

  it('binds a schema-valid claim to immutable provenance outside the claim schema', () => {
    const metadata = loadConformanceMetadata(rootPath)
    const claimResult = createClaim({
      subject: 'io.github.omdsh-dev.dsh-data-agent',
      hostDescriptorDigest: digest('fixture-host'),
      artifactDigest: digest('real-tarball'),
      suiteVersion: metadata.baseline.specification.suiteVersion,
      specificationRevision: metadata.baseline.specification.revision,
      dshStdRevision: metadata.baseline.dshStd.revision,
      manifestDigest: digest('manifest'),
      restrictions: metadata.restrictions.items.map((item: any) => item.id),
      provenance: { kind: 'isolated-npm-pack', hostDescriptorKind: 'fixture' },
      evidenceLevel: 'Parsed',
      result: 'pass',
      testedAt: '2026-08-19T00:00:00.000Z',
      evidence: evidence({ artifactDigest: digest('real-tarball') }),
    })

    expect(() => validateClaimV015(claimResult.claim)).not.toThrow()
    expect(claimResult.ceiling).toBe('Parsed')
    expect(claimResult.binding).toMatchObject({
      specificationRevision: metadata.baseline.specification.revision,
      dshStdRevision: metadata.baseline.dshStd.revision,
      manifestDigest: digest('manifest'),
      provenance: { kind: 'isolated-npm-pack', hostDescriptorKind: 'fixture' },
    })
    expect(claimResult.binding.restrictions).toContain('user-interaction-negotiation-spec-gap')
    expect(() => validateClaimV015({ ...claimResult.claim, certification: 'official' })).toThrow(/not allowed/u)
  })

  it('refuses fabricated standard ownership and keeps cleanup failure residual and retryable', () => {
    const base = {
      ownership: 'standard',
      activationInstance: 'activation-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      timestamp: '2026-08-19T00:00:00.000Z',
      operation: 'cleanup-failed',
      resource: { kind: 'fixture', id: 'bounded-resource-id' },
      errorCode: 'RELEASE_FAILED',
    }
    expect(() => createStandardEffectLedgerRecord({ ...base, ownership: 'native' })).toThrow(/native Cordis effects/u)
    expect(() => createStandardEffectLedgerRecord({ ...base, activationInstance: '' })).toThrow(/activation instance/u)
    expect(() => createStandardEffectLedgerRecord({ ...base, runtimeGenerationId: '' })).toThrow(/runtime generation/u)

    const record = createStandardEffectLedgerRecord(base)
    expect(record).toMatchObject({ operation: 'cleanup-failed', result: 'failed', errorCode: 'RELEASE_FAILED' })
    expect(effectCleanupDisposition(record)).toEqual({
      residual: true,
      diagnosable: true,
      retryable: true,
      errorCode: 'RELEASE_FAILED',
    })
  })

  it.each([
    [{ password: 'secret-value' }, 'password'],
    [{ token: 'opaque-value' }, 'token'],
    [{ resolvedCredential: 'opaque-value' }, 'resolved credential'],
    [{ connectionString: 'postgres://db.example/app' }, 'connection string'],
    [{ sqlText: 'select * from accounts' }, 'SQL text'],
    [{ queryResults: [{ id: 1 }] }, 'query results'],
    [{ messageBody: 'private prompt' }, 'message body'],
    [{ note: 'postgres://user:password@db.example/app' }, 'credential URI'],
    [{ note: 'SELECT * FROM private_table' }, 'SQL-shaped value'],
    [{ note: 'Bearer opaque-token-value' }, 'bearer token'],
  ])('rejects prohibited evidence content: %s (%s)', (value) => {
    expect(() => assertSensitiveContentFree(value)).toThrow(/TRUST-001/u)
  })
})
