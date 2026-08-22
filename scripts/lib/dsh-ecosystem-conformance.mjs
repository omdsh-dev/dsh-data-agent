import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createDshManifestCatalog, createDshProtocolCatalog } from '@dsh-std/adapter-dsh'
import { defineProtocolDeclaration } from '@dsh-std/core'
import { parseManifest, projectManifest } from '@dsh-std/manifest'

export const EVIDENCE_LEVELS = Object.freeze([
  'Declared', 'Parsed', 'Negotiated', 'Tested', 'Observed', 'Attested',
])

export const REQUIREMENTS = Object.freeze({
  baseline: 'BASELINE-001',
  manifest: 'MANIFEST-001',
  closure: 'DECL-CLOSURE-001',
  native: 'NATIVE-NO-REGRESSION-001',
  presentation: 'PRESENTATION-001',
  lifecycle: 'LIFECYCLE-001',
  dependencies: 'DEPENDENCY-CLOSURE-001',
  claim: 'CLAIM-CEILING-001',
  trust: 'TRUST-001',
})

const EXPECTED_BASELINE = Object.freeze({
  specRevision: 'ec80a4be5d92bbb971655afd0f097bb5586a1a28',
  dshStdRevision: '614dfa1ac168db79fcf4577cf0ebb34e2e3b944b',
  manifestVersion: '0.15',
  profileVersion: 'tui-admission/0.15',
})

const EVIDENCE_KEYS_REJECTED = new Set([
  'password', 'passwordref', 'token', 'accesstoken', 'refreshtoken', 'secret',
  'sql', 'sqltext', 'queryresult', 'queryresults', 'messagebody', 'messages',
  'connectionstring', 'resolvedcredential', 'credentialvalue', 'plaintext',
])

const HOST_DEFINITIONS = Object.freeze({
  'commands.dsh/v1alpha1#Command': '@dsh-std/command',
  'storage.dsh/v1alpha1#LocalStorage': '@dsh-std/storage',
  'presentation.dsh/v1alpha1#UserInteraction': '@dsh-std/presentation',
})

const DECLARED_CONTRACTS = Object.freeze([
  'commands.dsh/v1alpha1#Command',
  'storage.dsh/v1alpha1#LocalStorage',
])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export function digestFile(path) {
  return sha256(readFileSync(path))
}

function sorted(values) {
  return [...new Set(values)].sort()
}

function coordinateKey(reference) {
  return `${reference.apiVersion}#${reference.kind}`
}

function matches(source, expression, select = match => match[1]) {
  return sorted([...source.matchAll(expression)].map(select).filter(value => value !== undefined))
}

function assert(condition, message, requirementId = REQUIREMENTS.manifest) {
  if (!condition) {
    const error = new Error(`${requirementId}: ${message}`)
    error.requirementId = requirementId
    throw error
  }
}

function assertArrayEqual(actual, expected, label, requirementId = REQUIREMENTS.native) {
  assert(
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected)),
    `${label} drifted; expected ${JSON.stringify(sorted(expected))}, got ${JSON.stringify(sorted(actual))}`,
    requirementId,
  )
}

export function conformancePaths(root) {
  const base = join(root, 'conformance', 'dsh-ecosystem')
  return Object.freeze({
    root,
    base,
    baseline: join(base, 'baseline.json'),
    inventory: join(base, 'inventory.json'),
    restrictions: join(base, 'restrictions.json'),
    dependencies: join(base, 'dependencies.json'),
    manifest: join(root, 'dsh-plugin.json'),
    package: join(root, 'package.json'),
    lockfile: join(root, 'pnpm-lock.yaml'),
  })
}

export function loadConformanceMetadata(root) {
  const paths = conformancePaths(root)
  return Object.freeze({
    paths,
    baseline: readJson(paths.baseline),
    inventory: readJson(paths.inventory),
    restrictions: readJson(paths.restrictions),
    dependencies: readJson(paths.dependencies),
  })
}

export function collectCurrentInventory(root) {
  const pkg = readJson(join(root, 'package.json'))
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const preset = readFileSync(join(root, 'preset', 'data-agent', 'agent.cordis.yml'), 'utf8')
  const tool = readFileSync(join(root, 'src', 'tool.ts'), 'utf8')
  const catalogTools = readFileSync(join(root, 'src', 'catalog-tools.ts'), 'utf8')
  const command = readFileSync(join(root, 'src', 'command.ts'), 'utf8')
  const catalogCommand = readFileSync(join(root, 'src', 'catalog-command.ts'), 'utf8')
  const profile = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
  const routes = readFileSync(join(root, 'src', 'routes.ts'), 'utf8')
  const client = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8')
  const storage = readFileSync(join(root, 'src', 'storage.ts'), 'utf8')
  const catalogStorage = readFileSync(join(root, 'src', 'catalog-storage.ts'), 'utf8')
  const databaseTypes = readFileSync(join(root, 'src', 'database-types.ts'), 'utf8')

  const ownTools = matches(tool, /name:\s*'(sql-query|sql-write|sql-cmd|render-analysis)'/gu)
  ownTools.push(...matches(catalogTools, /name:\s*'(catalog-search|catalog-get|metric-get)'/gu))
  if (preset.includes("name: '@deepseek-ai/dsh-tool-str-replace-editor'")) ownTools.push('str_replace_editor')
  const domain = storage.match(/CONNECTION_STORAGE_DOMAIN\s*=\s*'([^']+)'/u)?.[1]
  const domainVersion = storage.match(/CONNECTION_STORAGE_VERSION\s*=\s*(\d+)/u)?.[1]
  const catalogDomain = catalogStorage.match(/CATALOG_STORAGE_DOMAIN\s*=\s*'([^']+)'/u)?.[1]
  const catalogDomainVersion = catalogStorage.match(/CATALOG_STORAGE_VERSION\s*=\s*(\d+)/u)?.[1]
  const typeBlock = databaseTypes.match(/DATABASE_TYPES\s*=\s*\[([\s\S]*?)\]\s*as const/u)?.[1] ?? ''

  return Object.freeze({
    bundleRows: matches(patch, /name:\s*'([^']+)'/gu),
    presetRows: matches(preset, /name:\s*'([^']+)'/gu),
    commands: sorted([
      ...matches(command, /ctx\.commands\.register\(\{[\s\S]*?name:\s*'([^']+)'/gu),
      ...matches(catalogCommand, /ctx\.commands\.register\(\{[\s\S]*?name:\s*'([^']+)'/gu),
    ]),
    tools: sorted(ownTools),
    services: sorted(matches(profile, /provide\('(dataAgent(?:Connections|Catalog|CatalogScanner|CatalogReview))'/gu)),
    routes: sorted([
      ...matches(
        routes,
        /req\.method\s*===\s*'(GET|POST)'\s*&&\s*routeIs\(segments,\s*'([^']+)'\)/gu,
        match => `${match[1]} ${match[2]}`,
      ),
      ...matches(
        routes,
        /req\.method\s*===\s*'(GET|POST)'\s*&&\s*routePathIs\(segments,\s*'catalog',\s*'([^']+)'\)/gu,
        match => `${match[1]} catalog/${match[2]}`,
      ),
      ...(routes.includes("segments[1] === 'assets'") ? ['GET catalog/assets/:assetId'] : []),
      ...(routes.includes("segments[1] === 'semantics'") ? [
        'GET catalog/semantics/:semanticId',
        'POST catalog/semantics/:semanticId/dismiss',
        'POST catalog/semantics/:semanticId/retire',
        'POST catalog/semantics/:semanticId/verify',
      ] : []),
    ]),
    webSlots: matches(client, /slots\.inject\('([^']+)'/gu),
    storageDomains: sorted([
      ...(domain === undefined || domainVersion === undefined ? [] : [`${domain}@${domainVersion}`]),
      ...(catalogDomain === undefined || catalogDomainVersion === undefined ? [] : [`${catalogDomain}@${catalogDomainVersion}`]),
    ]),
    databaseTypes: matches(typeBlock, /'([^']+)'/gu),
    publicExports: sorted(Object.keys(pkg.exports ?? {})),
    packageFiles: sorted(pkg.files ?? []),
  })
}

export function validateBaseline(root, baseline, options = {}) {
  assert(baseline.specification?.revision === EXPECTED_BASELINE.specRevision, 'specification revision drifted', REQUIREMENTS.baseline)
  assert(baseline.dshStd?.revision === EXPECTED_BASELINE.dshStdRevision, 'dsh-std revision drifted', REQUIREMENTS.baseline)
  assert(baseline.specification?.manifestVersion === EXPECTED_BASELINE.manifestVersion, 'manifest version drifted', REQUIREMENTS.baseline)
  assert(baseline.specification?.profileVersion === EXPECTED_BASELINE.profileVersion, 'profile version drifted', REQUIREMENTS.baseline)

  const pkg = readJson(join(root, 'package.json'))
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  for (const [name, pin] of Object.entries(baseline.dshStd.packages)) {
    const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]
    assert(declared === pin.version, `${name} must be pinned to ${pin.version}, got ${String(declared)}`, REQUIREMENTS.baseline)
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const escapedVersion = pin.version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const lockPattern = new RegExp(`['"]?${escapedName}@${escapedVersion}['"]?:\\n\\s+resolution: \\{integrity: ([^}]+)\\}`, 'u')
    const integrity = lockfile.match(lockPattern)?.[1]
    assert(integrity === pin.integrity, `${name}@${pin.version} lockfile integrity drifted`, REQUIREMENTS.baseline)
  }

  const require = createRequire(import.meta.url)
  const installedManifestSchema = require.resolve('@dsh-std/manifest/schema/dsh-plugin-0.15.schema.json')
  assert(
    digestFile(installedManifestSchema) === baseline.sourceDigests.manifestSchema,
    'installed @dsh-std/manifest schema differs from the pinned source digest',
    REQUIREMENTS.baseline,
  )

  if (options.specRoot !== undefined) validatePinnedSpecification(options.specRoot, baseline)
  if (options.dshStdRoot !== undefined) validatePinnedDshStd(options.dshStdRoot, baseline)
  return true
}

export function validatePinnedSpecification(specRoot, baseline) {
  const checks = {
    tuiRegistry: 'registry/registry-0.15.json',
    permissionRegistry: 'registry/permissions-0.1.json',
    requirements: 'conformance/requirements-v0.15.json',
    hostDescriptorSchema: 'schemas/host-descriptor.schema.json',
    claimSchema: 'schemas/conformance-claim.schema.json',
    effectLedgerSchema: 'schemas/effect-ledger-record.schema.json',
  }
  for (const [key, relative] of Object.entries(checks)) {
    const path = join(specRoot, relative)
    assert(existsSync(path), `pinned specification file is missing: ${relative}`, REQUIREMENTS.baseline)
    assert(digestFile(path) === baseline.sourceDigests[key], `pinned specification file drifted: ${relative}`, REQUIREMENTS.baseline)
  }
}

export function validatePinnedDshStd(dshStdRoot, baseline) {
  const schema = join(dshStdRoot, 'packages', 'manifest', 'schema', 'dsh-plugin-0.15.schema.json')
  assert(existsSync(schema), 'pinned dsh-std manifest schema is missing', REQUIREMENTS.baseline)
  assert(digestFile(schema) === baseline.sourceDigests.manifestSchema, 'pinned dsh-std manifest schema drifted', REQUIREMENTS.baseline)
}

export function validateInventory(root, expected, restrictions) {
  const actual = collectCurrentInventory(root)
  const native = expected.nativeRuntime
  for (const key of [
    'bundleRows', 'presetRows', 'commands', 'tools', 'services', 'routes',
    'webSlots', 'storageDomains', 'databaseTypes',
  ]) assertArrayEqual(actual[key], native[key], key)
  for (const value of native.publicExports) {
    assert(actual.publicExports.includes(value), `native public export was removed: ${value}`, REQUIREMENTS.native)
  }
  for (const value of native.packageFiles) {
    assert(actual.packageFiles.includes(value), `native package file rule was removed: ${value}`, REQUIREMENTS.native)
  }

  const restrictionIds = new Set(restrictions.items.map(item => item.id))
  for (const ability of expected.abilities) {
    assert(['declared', 'restriction', 'upstream-gap'].includes(ability.disposition), `ability ${ability.id} has no disposition`, REQUIREMENTS.closure)
    if (ability.disposition !== 'declared') {
      assert(restrictionIds.has(ability.restrictionId), `ability ${ability.id} references an unknown restriction`, REQUIREMENTS.closure)
    }
  }
  return actual
}

export function validateDependencyInventory(root, expected) {
  const pkg = readJson(join(root, 'package.json'))
  assertArrayEqual(Object.keys(pkg.dependencies ?? {}), expected.runtime.packaged, 'packaged runtime dependencies', REQUIREMENTS.dependencies)
  const allowedPeer = expected.runtime.peerFamilies.map(value => new RegExp(`^${value.replaceAll('*', '.*')}$`, 'u'))
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    assert(allowedPeer.some(pattern => pattern.test(name)), `peer dependency is not inventoried: ${name}`, REQUIREMENTS.dependencies)
  }

  const clients = readFileSync(join(root, 'src', 'clients.ts'), 'utf8')
  for (const [type, executable] of Object.entries(expected.runtime.externalExecutables)) {
    assert(clients.includes(`${type}: '${executable}'`), `external database client drifted: ${type}`, REQUIREMENTS.dependencies)
  }
  const query = readFileSync(join(root, 'src', 'query.ts'), 'utf8')
  assert(query.includes("from '@clickhouse/client'"), 'ClickHouse packaged HTTP client is not used', REQUIREMENTS.dependencies)
  assert(existsSync(join(root, 'cordis.patch.yml')), 'Cordis bundle patch is missing', REQUIREMENTS.dependencies)
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  for (const [name, allowed] of Object.entries(expected.build.nativeBuildPolicy)) {
    assert(workspace.includes(`  ${name}: ${String(allowed)}`) || workspace.includes(`  '${name}': ${String(allowed)}`), `native build policy drifted: ${name}`, REQUIREMENTS.dependencies)
  }
  return true
}

function validateManifestDocument({ source, packageVersion, baseline, entryPresent, sourceName }) {
  const parsed = parseManifest(source, { source: sourceName })
  assert(parsed.version === packageVersion, `manifest version ${parsed.version} differs from package version ${packageVersion}`)
  assert(parsed.id === 'io.github.omdsh-dev.dsh-data-agent', 'plugin id is not stable')
  assert(parsed.license === 'MIT', 'manifest license must be MIT')
  assert(parsed.source?.repository === 'https://github.com/omdsh-dev/dsh-data-agent', 'manifest repository differs from package source')
  assert(parsed.facets.host.entry === 'lib/ecosystem.js', 'host facet must use the side-effect-free ecosystem entry')
  assert(!isAbsolute(parsed.facets.host.entry) && !parsed.facets.host.entry.split('/').includes('..'), 'host facet entry escapes the package')
  assert(entryPresent(parsed.facets.host.entry), `host facet entry is not packaged: ${parsed.facets.host.entry}`)
  assert(baseline.acceptedFacetApiVersions.includes(parsed.facets.host.apiVersion), 'host facet API is not accepted by the pinned profile')
  assert(parsed.artifact === undefined, 'source manifest must not contain a self-referential artifact digest')
  assert((parsed.requires.services ?? []).length === 0, 'Community v0.15 services must remain empty')
  assert(parsed.subscriptions.length === 0, 'the declaration must not subscribe to native events')

  const acceptedContracts = new Set(baseline.acceptedContracts)
  for (const requirement of parsed.requires.contracts) {
    assert(acceptedContracts.has(coordinateKey(requirement)), `protocol is not admitted by the pinned profile: ${coordinateKey(requirement)}`, REQUIREMENTS.closure)
    if (requirement.optional === true) assert(Boolean(requirement.fallback), `optional protocol lacks fallback: ${coordinateKey(requirement)}`, REQUIREMENTS.closure)
  }
  assertArrayEqual(parsed.requires.contracts.map(coordinateKey), DECLARED_CONTRACTS, 'declared protocol contracts', REQUIREMENTS.closure)
  const commandRequirement = parsed.requires.contracts.find(row => coordinateKey(row) === DECLARED_CONTRACTS[0])
  const storageRequirement = parsed.requires.contracts.find(row => coordinateKey(row) === DECLARED_CONTRACTS[1])
  assert(commandRequirement?.optional !== true, 'Command must remain required', REQUIREMENTS.closure)
  assert(storageRequirement?.optional === true && Boolean(storageRequirement.fallback), 'LocalStorage must remain optional with a fallback', REQUIREMENTS.closure)
  assert(
    !parsed.requires.contracts.some(row => coordinateKey(row) === 'presentation.dsh/v1alpha1#UserInteraction'),
    'UserInteraction must remain undeclared while its requirement spec cannot be represented by Community v0.15',
    REQUIREMENTS.presentation,
  )
  for (const permission of parsed.permissions) {
    assert(Object.hasOwn(baseline.acceptedPermissions, permission.name), `permission is not admitted: ${permission.name}`, REQUIREMENTS.closure)
  }
  const commandScopes = parsed.contributes.commands.map(command => command.id).sort()
  assert(parsed.permissions.length === 1, 'only one package-scoped commands.invoke permission may be declared', REQUIREMENTS.closure)
  assert(parsed.permissions[0].scope === 'io.github.omdsh-dev.dsh-data-agent', 'command permission scope drifted', REQUIREMENTS.closure)
  assertArrayEqual(
    commandScopes,
    ['io.github.omdsh-dev.dsh-data-agent.catalog', 'io.github.omdsh-dev.dsh-data-agent.database'],
    'declared native commands',
    REQUIREMENTS.closure,
  )
  assert(parsed.contributes.panels.length === 0, 'the ecosystem declaration must not publish a panel', REQUIREMENTS.native)

  const projected = projectManifest(parsed)
  const protocols = createDshProtocolCatalog()
  const definitions = createDshManifestCatalog()
  const validation = definitions.validate(projected, protocols, { source: sourceName, digest: sha256(source) })
  const errors = validation.issues.filter(issue => issue.severity === 'error')
  assert(errors.length === 0, errors.map(issue => `${issue.path}: ${issue.message}`).join('; ') || 'manifest definition validation failed')
  const facet = projected.spec.facets[0]
  const commands = facet?.extensions?.filter(extension => coordinateKey(extension) === 'commands.dsh/v1alpha1#Command') ?? []
  assertArrayEqual(commands.map(command => command.metadata.name).sort(), ['catalog', 'database'], 'projected command leaves', REQUIREMENTS.closure)
  return Object.freeze({ source, digest: sha256(source), parsed, projected, validation, protocols })
}

export function validateManifest(root, baseline) {
  const paths = conformancePaths(root)
  const source = readFileSync(paths.manifest, 'utf8')
  const pkg = readJson(paths.package)
  return validateManifestDocument({
    source,
    packageVersion: pkg.version,
    baseline,
    sourceName: 'dsh-plugin.json',
    entryPresent: entryPath => {
      const entry = resolve(root, entryPath)
      return !relative(root, entry).startsWith('..') && existsSync(entry)
    },
  })
}

export function validatePackedManifest(source, packageVersion, packedFiles, baseline) {
  const available = new Set(packedFiles)
  return validateManifestDocument({
    source,
    packageVersion,
    baseline,
    sourceName: 'package/dsh-plugin.json',
    entryPresent: entryPath => available.has(entryPath),
  })
}

export function validateHostDescriptor(host, baseline) {
  assert(host?.$schema === 'urn:dsh-tui:host-descriptor:0.15', 'Host Descriptor schema id is invalid', REQUIREMENTS.claim)
  assert(typeof host.hostId === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(host.hostId), 'Host id is invalid', REQUIREMENTS.claim)
  assert(Array.isArray(host.facetApiVersions) && host.facetApiVersions.length > 0, 'Host facet API versions are missing', REQUIREMENTS.claim)
  assert(Array.isArray(host.contracts), 'Host contracts are missing', REQUIREMENTS.claim)
  assert(host.trustLevel === 'trusted-in-process', 'unsupported Host trust level', REQUIREMENTS.trust)
  const seen = new Set()
  for (const contract of host.contracts) {
    const key = coordinateKey(contract)
    assert(!seen.has(key), `Host declares duplicate contract: ${key}`, REQUIREMENTS.claim)
    seen.add(key)
    assert(baseline.acceptedContracts.includes(key), `Host declares a contract outside the pinned profile: ${key}`, REQUIREMENTS.claim)
    assert(contract.definition?.source === 'dsh-std', `Host contract does not use a dsh-std definition: ${key}`, REQUIREMENTS.claim)
    assert(contract.definition?.package === HOST_DEFINITIONS[key], `Host contract definition package drifted: ${key}`, REQUIREMENTS.claim)
    assert(Array.isArray(contract.permissions), `Host contract permissions are missing: ${key}`, REQUIREMENTS.claim)
  }
  return true
}

export function negotiateManifest(manifestResult, host, baseline) {
  validateHostDescriptor(host, baseline)
  if (!host.facetApiVersions.includes(manifestResult.parsed.facets.host.apiVersion)) {
    return Object.freeze({ decision: 'rejected', reasonCode: 'FACET_API_VERSION_UNAVAILABLE', missingRequired: [], missingOptional: [] })
  }
  const facet = manifestResult.projected.spec.facets[0]
  const requirements = facet.protocols?.requires ?? []
  const supported = new Set(host.contracts.map(coordinateKey))
  const missingRequired = requirements.filter(row => row.optional !== true && !supported.has(coordinateKey(row))).map(coordinateKey)
  const missingOptional = requirements.filter(row => row.optional === true && !supported.has(coordinateKey(row))).map(coordinateKey)
  if (missingRequired.length > 0) {
    return Object.freeze({ decision: 'rejected', reasonCode: 'REQUIRED_PROTOCOL_UNAVAILABLE', missingRequired, missingOptional })
  }

  const hostPermissions = new Set(host.contracts.flatMap(contract => contract.permissions))
  const deniedPermissions = manifestResult.parsed.permissions
    .filter(permission => !hostPermissions.has(permission.name))
    .map(permission => permission.name)
  if (deniedPermissions.length > 0) {
    return Object.freeze({ decision: 'rejected', reasonCode: 'PERMISSION_NOT_GRANTED', deniedPermissions, missingRequired, missingOptional })
  }

  const declaration = defineProtocolDeclaration({
    participant: { id: manifestResult.parsed.id },
    requires: requirements,
  })
  const hostDeclaration = defineProtocolDeclaration({
    participant: { id: host.hostId },
    supports: host.contracts.map(contract => ({
      apiVersion: contract.apiVersion,
      kind: contract.kind,
      ...(contract.spec === undefined ? {} : { spec: contract.spec }),
    })),
  })
  const negotiation = manifestResult.protocols.negotiate([declaration, hostDeclaration])
  if (!negotiation.compatible && missingOptional.length === 0) {
    return Object.freeze({ decision: 'rejected', reasonCode: 'PROTOCOL_NEGOTIATION_FAILED', issues: negotiation.issues, missingRequired, missingOptional })
  }
  return Object.freeze({
    decision: missingOptional.length > 0 ? 'compatible_degraded' : 'compatible',
    reasonCode: missingOptional.length > 0 ? 'OPTIONAL_PROTOCOL_FALLBACK' : 'COMPATIBLE',
    missingRequired,
    missingOptional,
    fallbacks: manifestResult.parsed.requires.contracts
      .filter(row => missingOptional.includes(coordinateKey(row)))
      .map(row => ({ contract: coordinateKey(row), fallback: row.fallback })),
  })
}

export function evidenceCeiling(input) {
  let index = input.declared === true ? 0 : -1
  if (index === 0 && input.parsed === true) index = 1
  if (index === 1 && input.hostDescriptorKind === 'real' && input.negotiated === true) index = 2
  if (index === 2 && input.artifactDigest !== undefined && input.suitePassed === true) index = 3
  if (index === 3 && input.lifecycleObserved === true && input.presentationObserved === true) index = 4
  if (index === 4 && typeof input.signer === 'string' && input.signer.length > 0) index = 5
  return index < 0 ? undefined : EVIDENCE_LEVELS[index]
}

function evidenceResult(level, status, failedRequirements = []) {
  return Object.freeze({ level, status, failedRequirements: Object.freeze(sorted(failedRequirements)) })
}

export function evidenceResults(input) {
  const declared = input.declared === true
  const parsed = declared && input.parsed === true
  const realHost = input.hostDescriptorKind === 'real'
  const negotiated = parsed && input.negotiated === true
  const tested = realHost && negotiated && input.artifactDigest !== undefined && input.suitePassed === true
  const observed = tested && input.lifecycleObserved === true && input.presentationObserved === true
  const attested = observed && typeof input.signer === 'string' && input.signer.length > 0
  return Object.freeze({
    Declared: evidenceResult('Declared', declared ? 'pass' : 'fail', declared ? [] : [REQUIREMENTS.manifest]),
    Parsed: evidenceResult('Parsed', parsed ? 'pass' : 'not-reached', parsed ? [] : [REQUIREMENTS.baseline, REQUIREMENTS.manifest]),
    Negotiated: evidenceResult(
      'Negotiated',
      negotiated ? (realHost ? 'pass' : 'fixture-only') : (input.negotiated === false ? 'fail' : 'not-run'),
      negotiated && realHost ? [] : [REQUIREMENTS.claim],
    ),
    Tested: evidenceResult('Tested', tested ? 'pass' : 'not-run', tested ? [] : [REQUIREMENTS.dependencies, REQUIREMENTS.claim]),
    Observed: evidenceResult('Observed', observed ? 'pass' : 'not-run', observed ? [] : [REQUIREMENTS.lifecycle, REQUIREMENTS.presentation]),
    Attested: evidenceResult('Attested', attested ? 'pass' : 'not-run', attested ? [] : [REQUIREMENTS.claim]),
  })
}

export function requireEvidenceLevel(requested, input) {
  assert(EVIDENCE_LEVELS.includes(requested), `unknown evidence level: ${requested}`, REQUIREMENTS.claim)
  const ceiling = evidenceCeiling(input)
  assert(ceiling !== undefined, 'no evidence is available', REQUIREMENTS.claim)
  assert(EVIDENCE_LEVELS.indexOf(requested) <= EVIDENCE_LEVELS.indexOf(ceiling), `requested ${requested} exceeds evidence ceiling ${ceiling}`, REQUIREMENTS.claim)
  return ceiling
}

export function assertSensitiveContentFree(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSensitiveContentFree(item, `${path}[${index}]`))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
      assert(!EVIDENCE_KEYS_REJECTED.has(normalized), `prohibited evidence field at ${path}.${key}`, REQUIREMENTS.trust)
      assertSensitiveContentFree(child, `${path}.${key}`)
    }
    return
  }
  if (typeof value !== 'string') return
  assert(!/[a-z][a-z0-9+.-]*:\/\/[^\s:/]+:[^\s@/]+@/iu.test(value), `connection URI with embedded credential at ${path}`, REQUIREMENTS.trust)
  assert(!/^\s*(?:select|insert|update|delete|with|alter|drop|create|show|describe|pragma)\b/iu.test(value), `SQL text at ${path}`, REQUIREMENTS.trust)
  assert(!/\bBearer\s+[A-Za-z0-9._~+/=-]+/u.test(value), `bearer token at ${path}`, REQUIREMENTS.trust)
  assert(!/\bsk-[A-Za-z0-9_-]{8,}\b/u.test(value), `token-shaped value at ${path}`, REQUIREMENTS.trust)
}

export function createStandardEffectLedgerRecord(input) {
  assert(input.ownership === 'standard', 'native Cordis effects cannot be emitted as standard ledger records', REQUIREMENTS.lifecycle)
  assert(typeof input.activationInstance === 'string' && input.activationInstance.length > 0, 'activation instance is required', REQUIREMENTS.lifecycle)
  assert(typeof input.runtimeGenerationId === 'string' && /^[A-Za-z0-9._:-]+$/u.test(input.runtimeGenerationId), 'runtime generation is required', REQUIREMENTS.lifecycle)
  assert(['create', 'bind', 'replace', 'release', 'cleanup-failed'].includes(input.operation), 'ledger operation is invalid', REQUIREMENTS.lifecycle)
  const record = Object.freeze({
    ledgerVersion: '0.15',
    sequence: input.sequence,
    timestamp: input.timestamp,
    pluginId: 'io.github.omdsh-dev.dsh-data-agent',
    activationInstance: input.activationInstance,
    runtimeGenerationId: input.runtimeGenerationId,
    operation: input.operation,
    resource: Object.freeze({ kind: input.resource.kind, id: input.resource.id }),
    result: input.operation === 'cleanup-failed' ? 'failed' : input.result,
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    ...(input.valueDigest === undefined ? {} : { valueDigest: input.valueDigest }),
  })
  assert(Number.isInteger(record.sequence) && record.sequence >= 0, 'ledger sequence is invalid', REQUIREMENTS.lifecycle)
  assert(!Number.isNaN(Date.parse(record.timestamp)), 'ledger timestamp is invalid', REQUIREMENTS.lifecycle)
  if (record.operation === 'cleanup-failed') assert(typeof record.errorCode === 'string' && record.errorCode.length > 0, 'cleanup failure requires errorCode', REQUIREMENTS.lifecycle)
  assertSensitiveContentFree(record)
  return record
}

export function effectCleanupDisposition(record) {
  assert(record?.ledgerVersion === '0.15', 'effect ledger record is invalid', REQUIREMENTS.lifecycle)
  return Object.freeze(record.operation === 'cleanup-failed'
    ? { residual: true, diagnosable: true, retryable: true, errorCode: record.errorCode }
    : { residual: false, diagnosable: false, retryable: false })
}

export function validateClaimV015(claim) {
  const required = ['claimVersion', 'subject', 'specVersion', 'hostDescriptorDigest', 'artifactDigest', 'suiteVersion', 'evidenceLevel', 'result', 'testedAt']
  const allowed = new Set([...required, 'runtime', 'signer', 'expiresAt', 'revoked', 'failedRequirements'])
  for (const key of Object.keys(claim)) assert(allowed.has(key), `claim field is not allowed: ${key}`, REQUIREMENTS.claim)
  for (const key of required) assert(Object.hasOwn(claim, key), `claim field is missing: ${key}`, REQUIREMENTS.claim)
  assert(claim.claimVersion === '0.15' && claim.specVersion === 'community-v0.15', 'claim version is invalid', REQUIREMENTS.claim)
  assert(typeof claim.subject === 'string' && claim.subject.length > 0, 'claim subject is invalid', REQUIREMENTS.claim)
  assert(typeof claim.suiteVersion === 'string' && claim.suiteVersion.length > 0, 'claim suite version is invalid', REQUIREMENTS.claim)
  assert(/^sha256:[a-f0-9]{64}$/u.test(claim.hostDescriptorDigest), 'Host Descriptor digest is invalid', REQUIREMENTS.claim)
  assert(/^sha256:[a-f0-9]{64}$/u.test(claim.artifactDigest), 'artifact digest is invalid', REQUIREMENTS.claim)
  assert(EVIDENCE_LEVELS.includes(claim.evidenceLevel), 'claim evidence level is invalid', REQUIREMENTS.claim)
  assert(['pass', 'fail'].includes(claim.result), 'claim result is invalid', REQUIREMENTS.claim)
  assert(!Number.isNaN(Date.parse(claim.testedAt)), 'claim timestamp is invalid', REQUIREMENTS.claim)
  if (claim.expiresAt !== undefined) assert(!Number.isNaN(Date.parse(claim.expiresAt)), 'claim expiry is invalid', REQUIREMENTS.claim)
  if (claim.failedRequirements !== undefined) {
    assert(Array.isArray(claim.failedRequirements) && claim.failedRequirements.every(value => typeof value === 'string'), 'failed requirements are invalid', REQUIREMENTS.claim)
  }
  assertSensitiveContentFree(claim)
  return true
}

export function createClaim(input) {
  assert(input.specificationRevision === EXPECTED_BASELINE.specRevision, 'claim specification revision is not pinned', REQUIREMENTS.claim)
  assert(input.dshStdRevision === EXPECTED_BASELINE.dshStdRevision, 'claim dsh-std revision is not pinned', REQUIREMENTS.claim)
  assert(/^sha256:[a-f0-9]{64}$/u.test(input.manifestDigest), 'claim manifest digest is invalid', REQUIREMENTS.claim)
  assert(Array.isArray(input.restrictions), 'claim restrictions are required', REQUIREMENTS.claim)
  assert(typeof input.provenance?.kind === 'string' && input.provenance.kind.length > 0, 'claim provenance is required', REQUIREMENTS.claim)
  const ceiling = requireEvidenceLevel(input.evidenceLevel, input.evidence)
  const claim = Object.freeze({
    claimVersion: '0.15',
    subject: input.subject,
    specVersion: 'community-v0.15',
    hostDescriptorDigest: input.hostDescriptorDigest,
    artifactDigest: input.artifactDigest,
    suiteVersion: input.suiteVersion,
    evidenceLevel: input.evidenceLevel,
    result: input.result,
    testedAt: input.testedAt,
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
    ...(input.signer === undefined ? {} : { signer: input.signer }),
    ...(input.failedRequirements?.length > 0 ? { failedRequirements: sorted(input.failedRequirements) } : {}),
  })
  validateClaimV015(claim)
  const binding = Object.freeze({
    bindingVersion: 'dsh-data-agent-claim-binding/1',
    claimDigest: sha256(JSON.stringify(claim)),
    specificationRevision: input.specificationRevision,
    dshStdRevision: input.dshStdRevision,
    manifestDigest: input.manifestDigest,
    restrictions: Object.freeze(sorted(input.restrictions)),
    provenance: Object.freeze({ ...input.provenance }),
  })
  assertSensitiveContentFree(binding)
  return Object.freeze({ claim, ceiling, binding })
}

export function runSourceConformance(options) {
  const root = resolve(options.root)
  const metadata = loadConformanceMetadata(root)
  validateBaseline(root, metadata.baseline, options)
  const actualInventory = validateInventory(root, metadata.inventory, metadata.restrictions)
  validateDependencyInventory(root, metadata.dependencies)
  const manifest = validateManifest(root, metadata.baseline)
  const host = options.hostDescriptor === undefined ? undefined : options.hostDescriptor
  const negotiation = host === undefined ? undefined : negotiateManifest(manifest, host, metadata.baseline)
  const negotiated = negotiation !== undefined && ['compatible', 'compatible_degraded'].includes(negotiation.decision)
  const evidence = Object.freeze({
    declared: true,
    parsed: true,
    hostDescriptorKind: options.hostDescriptorKind ?? 'fixture',
    negotiated,
    artifactDigest: options.artifactDigest,
    suitePassed: options.suitePassed === true,
    lifecycleObserved: options.lifecycleObserved === true,
    presentationObserved: options.presentationObserved === true,
    signer: options.signer,
  })
  const ceiling = evidenceCeiling(evidence)
  const levels = evidenceResults(evidence)
  const requested = options.requestedEvidence ?? ceiling
  if (requested !== undefined) requireEvidenceLevel(requested, evidence)
  const restrictions = sorted(metadata.restrictions.items.map(item => item.id))
  const failedRequirements = negotiation?.decision === 'rejected'
    ? [negotiation.reasonCode === 'PERMISSION_NOT_GRANTED' ? REQUIREMENTS.closure : REQUIREMENTS.manifest]
    : []
  const report = Object.freeze({
    reportVersion: 'dsh-data-agent-ecosystem/1',
    subject: manifest.parsed.id,
    result: failedRequirements.length === 0 ? 'pass' : 'fail',
    evidenceLevel: requested,
    evidenceCeiling: ceiling,
    evidenceResults: levels,
    hostDescriptorKind: options.hostDescriptorKind ?? (host === undefined ? 'none' : 'fixture'),
    manifestDigest: manifest.digest,
    hostDescriptorDigest: host === undefined ? undefined : options.hostDescriptorDigest ?? sha256(JSON.stringify(host)),
    specification: Object.freeze({
      revision: metadata.baseline.specification.revision,
      dshStdRevision: metadata.baseline.dshStd.revision,
      profileVersion: metadata.baseline.specification.profileVersion,
      suiteVersion: metadata.baseline.specification.suiteVersion,
    }),
    negotiation,
    restrictions,
    failedRequirements,
    inventory: actualInventory,
  })
  assertSensitiveContentFree(report)
  return Object.freeze({ report, manifest, metadata, evidence })
}

export function repositoryRootFrom(importMetaUrl) {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..')
}
