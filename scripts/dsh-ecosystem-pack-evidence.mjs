#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import {
  assertSensitiveContentFree,
  createClaim,
  digestFile,
  runSourceConformance,
  validatePackedManifest,
} from './lib/dsh-ecosystem-conformance.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const outputDir = resolve(args.get('--output-dir') ?? mkdtempSync(join(tmpdir(), 'dsh-data-agent-evidence-')))
const relativeOutput = relative(root, outputDir)
if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !isAbsolute(relativeOutput))) {
  throw new Error('artifact evidence output must be outside the source working tree')
}
mkdirSync(outputDir, { recursive: true })

const buildRoot = mkdtempSync(join(tmpdir(), 'dsh-data-agent-pack-build-'))
try {
  copyBuildInputs(root, buildRoot)
  symlinkSync(join(root, 'node_modules'), join(buildRoot, 'node_modules'), 'dir')
  run(join(root, 'node_modules', '.bin', 'tsdown'), [], buildRoot)
  run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.build.json'], buildRoot)
  run(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.client.json'], buildRoot)

  const pack = run('npm', ['pack', '--json', '--pack-destination', outputDir], buildRoot)
  const packRows = JSON.parse(pack.stdout)
  if (!Array.isArray(packRows) || packRows.length !== 1) throw new Error('npm pack did not report exactly one artifact')
  const packed = packRows[0]
  const tarballPath = join(outputDir, packed.filename)
  const artifactDigest = digestFile(tarballPath)
  const packedFiles = [...packed.files.map(file => file.path)].sort()
  for (const required of [
    'dsh-plugin.json',
    'lib/ecosystem.js',
    'lib/types/ecosystem.d.ts',
    'conformance/dsh-ecosystem/baseline.json',
    'conformance/dsh-ecosystem/inventory.json',
    'conformance/dsh-ecosystem/restrictions.json',
    'conformance/dsh-ecosystem/dependencies.json',
  ]) {
    if (!packedFiles.includes(required)) throw new Error(`packed artifact is missing ${required}`)
  }

  const packedManifestSource = readTarballEntry(tarballPath, 'package/dsh-plugin.json').toString('utf8')
  const packedPackage = JSON.parse(readTarballEntry(tarballPath, 'package/package.json').toString('utf8'))

  const hostPath = join(buildRoot, 'conformance', 'dsh-ecosystem', 'fixtures', 'host-eligible.fixture.json')
  const hostDescriptor = JSON.parse(readFileSync(hostPath, 'utf8'))
  const result = runSourceConformance({
    root: buildRoot,
    hostDescriptor,
    hostDescriptorDigest: digestFile(hostPath),
    hostDescriptorKind: 'fixture',
    requestedEvidence: 'Parsed',
    artifactDigest,
    suitePassed: args.get('--suite-passed') === 'true',
  })
  const packedManifest = validatePackedManifest(
    packedManifestSource,
    packedPackage.version,
    packedFiles,
    result.metadata.baseline,
  )
  if (packedManifest.digest !== result.report.manifestDigest) {
    throw new Error('packed manifest differs from the validated source manifest')
  }
  const testedAt = new Date().toISOString()
  const { claim, ceiling, binding } = createClaim({
    subject: result.report.subject,
    hostDescriptorDigest: result.report.hostDescriptorDigest,
    artifactDigest,
    suiteVersion: result.metadata.baseline.specification.suiteVersion,
    specificationRevision: result.metadata.baseline.specification.revision,
    dshStdRevision: result.metadata.baseline.dshStd.revision,
    manifestDigest: result.report.manifestDigest,
    restrictions: result.report.restrictions,
    provenance: { kind: 'isolated-npm-pack', hostDescriptorKind: 'fixture' },
    evidenceLevel: 'Parsed',
    result: result.report.result,
    testedAt,
    failedRequirements: result.report.failedRequirements,
    evidence: result.evidence,
  })
  const pkg = JSON.parse(readFileSync(join(buildRoot, 'package.json'), 'utf8'))
  const sidecar = {
    evidenceVersion: 'dsh-data-agent-ecosystem/1',
    claim,
    claimBinding: binding,
    provenance: { hostDescriptorKind: 'fixture', evidenceCeiling: ceiling },
    artifact: {
      packageName: pkg.name,
      packageVersion: pkg.version,
      fileName: basename(tarballPath),
      digest: artifactDigest,
      files: packedFiles,
      lockfileDigest: digestFile(join(buildRoot, 'pnpm-lock.yaml')),
      bundlePatchDigest: digestFile(join(buildRoot, 'cordis.patch.yml')),
      dependencies: pkg.dependencies,
      peerDependencies: pkg.peerDependencies,
      peerDependenciesMeta: pkg.peerDependenciesMeta,
      externalRequirements: result.metadata.dependencies.runtime,
      buildRequirements: result.metadata.dependencies.build,
    },
    validation: {
      build: 'isolated-copy',
      packaging: 'npm-pack-json',
      sourceWorkingTreeModified: false,
      generatedAt: testedAt,
    },
  }
  assertSensitiveContentFree(sidecar)
  const sidecarPath = join(outputDir, `${packed.filename}.ecosystem-evidence.json`)
  writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ tarballPath, sidecarPath, artifactDigest, evidenceLevel: claim.evidenceLevel, evidenceCeiling: ceiling }, null, 2)}\n`)
} finally {
  rmSync(buildRoot, { recursive: true, force: true })
}

function parseArgs(values) {
  const result = new Map()
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index]
    if (!name?.startsWith('--')) throw new Error(`unknown argument: ${String(name)}`)
    if (name === '--suite-passed') {
      result.set(name, 'true')
      continue
    }
    const value = values[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    result.set(name, value)
    index += 1
  }
  return result
}

function copyBuildInputs(sourceRoot, targetRoot) {
  const entries = [
    'src', 'preset', 'conformance', 'scripts', 'assets',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml',
    'dsh-plugin.json', 'tsdown.config.ts', 'tsconfig.json', 'tsconfig.build.json',
    'tsconfig.client.json', 'README.md', 'README.en.md', 'LICENSE',
  ]
  for (const entry of entries) {
    const source = join(sourceRoot, entry)
    if (!existsSync(source)) continue
    cpSync(source, join(targetRoot, entry), { recursive: true })
  }
}

function readTarballEntry(tarballPath, requestedName) {
  const archive = gunzipSync(readFileSync(tarballPath))
  let offset = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name
    const sizeText = tarString(header, 124, 12).trim()
    const size = Number.parseInt(sizeText || '0', 8)
    if (!Number.isFinite(size) || size < 0) throw new Error(`invalid tar entry size for ${fullName}`)
    const contentOffset = offset + 512
    if (fullName === requestedName) return archive.subarray(contentOffset, contentOffset + size)
    offset = contentOffset + Math.ceil(size / 512) * 512
  }
  throw new Error(`tarball entry is missing: ${requestedName}`)
}

function tarString(header, offset, length) {
  const value = header.subarray(offset, offset + length).toString('utf8')
  const terminator = value.indexOf('\0')
  return (terminator < 0 ? value : value.slice(0, terminator)).trim()
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      npm_config_cache: join(cwd, '.npm-cache'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`${basename(command)} ${commandArgs.join(' ')} failed (${String(result.status)}):\n${result.stdout}${result.stderr}`)
  }
  return result
}
