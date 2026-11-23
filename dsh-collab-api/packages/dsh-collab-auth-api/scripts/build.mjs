import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { WorkspaceTypertGenerator, writeWorkspaceArtifacts } from '@deepseek-ai/dsh-typert-generator'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = dirname(dirname(packageRoot))
const node = process.execPath

// 1. Generate the Host manifest and the Client Remote contribution.
const generator = new WorkspaceTypertGenerator(workspaceRoot, { checkDiagnostics: false })
const artifacts = generator.generateContributors(['host'])
writeWorkspaceArtifacts(workspaceRoot, artifacts)

// 2. Compile the Host entry (the generated artifacts stay untouched).
execFileSync(node, [join(workspaceRoot, 'node_modules/typescript/bin/tsc'), '-p', join(packageRoot, 'tsconfig.host.json')], { stdio: 'inherit' })

// 3. Bundle the Client entry as a DSH module-loader factory.
mkdirSync(join(packageRoot, 'lib'), { recursive: true })
const bundle = await build({
  entryPoints: [join(packageRoot, 'src/client-entry.ts')],
  absWorkingDir: packageRoot,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  logLevel: 'silent',
  external: ['zod'],
})
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const wrapped = `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:function(require){var module={exports:{}};var exports=module.exports;\n${bundle.outputFiles[0].text}\nreturn module.exports;}});\n`
writeFileSync(join(packageRoot, 'lib/client.js'), wrapped)
console.log(`built ${manifest.name}`)
