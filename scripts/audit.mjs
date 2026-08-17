import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function fail(message) {
  failures.push(message)
}

const corePackage = readJson('packages/core/package.json')
const serverPackage = readJson('apps/server/package.json')
const rootPackage = readJson('package.json')

if (corePackage.exports?.['.']?.import !== './dist/index.js') {
  fail('core exports.import must point at ./dist/index.js')
}
if (corePackage.exports?.['.']?.types !== './dist/index.d.ts') {
  fail('core exports.types must point at ./dist/index.d.ts')
}
if (corePackage.main !== './dist/index.js') {
  fail('core main must point at ./dist/index.js')
}
if (!Array.isArray(corePackage.files) || !corePackage.files.includes('dist')) {
  fail('core files must include dist')
}
if (JSON.stringify(corePackage.exports).includes('./src/')) {
  fail('core exports must not point at TypeScript source')
}

if (serverPackage.scripts?.start !== 'node dist/server.js') {
  fail('server start must be node dist/server.js')
}
if (String(serverPackage.scripts?.start ?? '').includes('tsx')) {
  fail('server start must not use tsx')
}

if (
  rootPackage.scripts?.['test:smoke'] !==
  'node scripts/smoke-compiled-server.mjs'
) {
  fail('root test:smoke script is missing')
}

const requiredFiles = [
  'packages/core/dist/index.js',
  'packages/core/dist/index.d.ts',
  'apps/server/dist/server.js',
  'apps/server/dist/security/http-guard.js',
  'scripts/smoke-compiled-server.mjs',
]
for (const relativePath of requiredFiles) {
  if (!existsSync(join(root, relativePath))) {
    fail(`missing compiled or audit file: ${relativePath}`)
  }
}

const compiledServer = readFileSync(
  join(root, 'apps/server/dist/server.js'),
  'utf8',
)
if (compiledServer.includes('@sikumi-local/core/src/')) {
  fail('compiled server still imports core TypeScript source')
}

try {
  const require = createRequire(join(root, 'apps/server/package.json'))
  const resolved = require.resolve('@sikumi-local/core')
  if (!resolved.endsWith(`${join('packages', 'core', 'dist', 'index.js')}`)) {
    fail(`@sikumi-local/core resolved to ${resolved}, expected dist/index.js`)
  }
  await import(pathToFileURL(resolved).href)
} catch (error) {
  fail(`failed to import compiled @sikumi-local/core: ${error.message}`)
}

if (failures.length > 0) {
  console.error('Audit failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log('Audit passed')
  console.log('core exports: dist/index.js')
  console.log('server start: node dist/server.js')
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}
