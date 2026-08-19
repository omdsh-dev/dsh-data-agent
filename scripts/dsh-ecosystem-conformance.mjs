#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digestFile, runSourceConformance } from './lib/dsh-ecosystem-conformance.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const name = process.argv[index]
  if (!name?.startsWith('--')) throw new Error(`unknown argument: ${String(name)}`)
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  args.set(name, value)
  index += 1
}

const hostPath = resolve(args.get('--host') ?? join(root, 'conformance', 'dsh-ecosystem', 'fixtures', 'host-eligible.fixture.json'))
const hostDescriptor = JSON.parse(readFileSync(hostPath, 'utf8'))

try {
  const result = runSourceConformance({
    root,
    hostDescriptor,
    hostDescriptorDigest: digestFile(hostPath),
    hostDescriptorKind: args.get('--host-kind') ?? 'fixture',
    requestedEvidence: args.get('--requested') ?? 'Parsed',
    specRoot: args.has('--spec-root') ? resolve(args.get('--spec-root')) : undefined,
    dshStdRoot: args.has('--dsh-std-root') ? resolve(args.get('--dsh-std-root')) : undefined,
  })
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
