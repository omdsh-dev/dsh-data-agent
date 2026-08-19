/**
 * Standalone build config for the merged data-agent package: the node-half
 * library (lib/index.js server half + lib/tool.js sql-cmd tool half +
 * lib/invariant.js) and the browser client bundle (lib/client.js), replicating
 * the harness's shared client preset (packages/client/tsdown.client.ts): a
 * closure-factory artifact calling window.__ModuleLoader__.load({id, factory}),
 * with platform modules resolved through the injected require (the loader
 * module table) and CSS Modules compiled by lightningcss and injected as
 * plugin-owned style tags.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

/** Plugin id (package name), stamped into the __ModuleLoader__.load handoff. */
const PLUGIN_ID = '@yejiming/dsh-data-agent'

/** Shared browser platform modules the shell seeds into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Node-half library: server, routes, tool, human command, invariant, and ecosystem entries. */
const nodeHalf: UserConfig = {
  name: PLUGIN_ID,
  entry: {
    index: 'src/index.ts',
    routes: 'src/routes.ts',
    tool: 'src/tool.ts',
    command: 'src/command.ts',
    invariant: 'src/invariant.ts',
    ecosystem: 'src/ecosystem.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/**
 * Browser bundle: CJS closure-factory artifact. Externals resolve from the
 * loader module table; everything else inlines. CSS Modules compile to a
 * hashed class map plus an idempotent <style data-plugin> injection.
 */
const client: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  // Inlined browser dependencies such as ECharts/zrender use Node-style
  // environment probes. DSH executes this artifact inside a browser factory
  // with no global `process`, so substitute the same environment keys as the
  // harness client preset before the bundle is emitted.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  // No opinion for table entries (external wins above); bundle everything else.
  noExternal: (id: string) => PLATFORM_MODULES.includes(id as (typeof PLATFORM_MODULES)[number]) ? undefined : true,
  plugins: [{
    // Bundle purity gate (mirror of the module-edge rules): platform seed
    // entries stay external, every other @deepseek-ai value import is a
    // build error — cross-plugin collaboration goes through cordis services.
    // Also inspect the final chunk because dependency condition resolution can
    // introduce a Node built-in after source-level resolve hooks have run.
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (PLATFORM_MODULES.includes(source as (typeof PLATFORM_MODULES)[number])) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module — cross-plugin value imports are forbidden; `
        + 'collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const match of output.code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)) {
          const dependency = match[2]!
          if (PLATFORM_MODULES.includes(dependency as (typeof PLATFORM_MODULES)[number])) continue
          this.error(
            `client bundle purity: emitted require("${dependency}") is not a platform module — `
            + 'bundle the browser implementation or remove the unsupported runtime dependency',
          )
        }
      }
    },
  }, {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, entry] of Object.entries(cssExports ?? {})) classMap[local] = entry.name
      const tagId = `${PLUGIN_ID}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeHalf, client]

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}
