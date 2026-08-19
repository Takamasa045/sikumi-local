import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { CLAUDE_DESKTOP_INSTRUCTION, SIKUMI_MCP_TOOLS } from './events.js'
import { listSikumiTools } from './tools.js'

export const MCPB_MANIFEST_VERSION = '0.3'
export const MCPB_PACKAGE_NAME = 'sikumi-observer-claude-desktop'
export const MCPB_DISPLAY_NAME = 'Sikumi Observer（Claudeアプリ・協調報告）'

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'module',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'process',
  'stream',
  'string_decoder',
  'timers',
  'tty',
  'url',
  'util',
  'zlib',
])

export function claudeDesktopPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const parent = basename(here)
  return parent === 'dist' || parent === 'src' ? join(here, '..') : here
}

export function claudeDesktopExtensionRoot(): string {
  return join(claudeDesktopPackageRoot(), 'extension')
}

export function claudeDesktopManifestPath(): string {
  return join(claudeDesktopExtensionRoot(), 'manifest.json')
}

export function renderClaudeDesktopManifest(): Record<string, unknown> {
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: MCPB_PACKAGE_NAME,
    display_name: MCPB_DISPLAY_NAME,
    version: '0.1.0',
    description:
      'Sikumi-local への協調報告用 MCP。通常チャットの自動全観測ではありません。登録Repositoryの作業開始・更新・完了だけを自己申告します。',
    long_description: [
      'この Desktop Extension は Claude アプリの通常チャット向けの制限付き観測口です。',
      'Claude が Tool を呼んだときだけ記録します。チャット一覧の受動取得はしません。',
      '',
      CLAUDE_DESKTOP_INSTRUCTION,
    ].join('\n'),
    author: {
      name: 'Sikumi-local',
    },
    server: {
      type: 'node',
      entry_point: 'server/index.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/index.js'],
        env: {
          SIKUMI_LOCAL_DATA_DIR: '${user_config.data_directory}',
        },
      },
    },
    tools: listSikumiTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
    tools_generated: false,
    prompts: [
      {
        name: 'sikumi_cooperative_reporting',
        description: '登録Repositoryでの協調報告手順',
        text: CLAUDE_DESKTOP_INSTRUCTION,
      },
    ],
    keywords: ['sikumi', 'observer', 'cooperative', 'claude-desktop'],
    license: 'UNLICENSED',
    compatibility: {
      platforms: ['darwin', 'win32'],
      runtimes: {
        node: '>=22.0.0',
      },
    },
    user_config: {
      data_directory: {
        type: 'directory',
        title: 'Sikumi-local データフォルダ',
        description:
          'Sikumi-local のデータディレクトリ。通常は ~/.shikumi-local です。Claude Desktop の設定ファイルは使いません。',
        required: false,
        default: '${HOME}/.shikumi-local',
      },
    },
  }
}

export function renderBundledServerSource(): string {
  return `#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataDirectory =
  process.env.SIKUMI_LOCAL_DATA_DIR &&
  process.env.SIKUMI_LOCAL_DATA_DIR.trim().length > 0
    ? process.env.SIKUMI_LOCAL_DATA_DIR
    : join(homedir(), '.shikumi-local')

try {
  const mod = await import(new URL('./cli.js', import.meta.url).href)
  const code = await mod.runClaudeDesktopMcpServer(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
  })
  process.exit(code ?? 0)
} catch (error) {
  process.stderr.write(
    String(error instanceof Error ? error.message : error ?? 'mcp server failed') +
      '\\n',
  )
  process.exit(0)
}
`
}

export function writeExtensionSources(targetRoot: string): readonly string[] {
  mkdirSync(join(targetRoot, 'server'), { recursive: true, mode: 0o700 })
  const manifestPath = join(targetRoot, 'manifest.json')
  const serverPath = join(targetRoot, 'server/index.js')
  const instructionPath = join(targetRoot, 'instructions.txt')
  const rootPackagePath = join(targetRoot, 'package.json')
  const serverPackagePath = join(targetRoot, 'server/package.json')
  writeFileSync(
    manifestPath,
    `${JSON.stringify(renderClaudeDesktopManifest(), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  writeFileSync(instructionPath, `${CLAUDE_DESKTOP_INSTRUCTION}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  writeFileSync(
    rootPackagePath,
    `${JSON.stringify(
      {
        name: MCPB_PACKAGE_NAME,
        version: '0.1.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  writeFileSync(
    serverPackagePath,
    `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  copyRuntimeEntry(targetRoot)
  copyWorkspaceRuntime(targetRoot)
  copyExternalRuntime(targetRoot, 'zod')
  writeFileSync(serverPath, `${renderBundledServerSource()}\n`, {
    encoding: 'utf8',
    mode: 0o700,
  })
  const missing = assertArchiveRuntimeComplete(targetRoot)
  if (missing.length > 0) {
    throw new Error(
      `MCPB runtime is incomplete: missing ${missing.slice(0, 8).join(', ')}`,
    )
  }
  return [manifestPath, serverPath, instructionPath, rootPackagePath]
}

export function validateClaudeDesktopManifest(
  manifest: unknown = renderClaudeDesktopManifest(),
): { readonly ok: boolean; readonly errors: readonly string[] } {
  const errors: string[] = []
  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ['manifest が object ではありません'] }
  }
  if (manifest.manifest_version !== MCPB_MANIFEST_VERSION) {
    errors.push('manifest_version が 0.3 ではありません')
  }
  if (manifest.name !== MCPB_PACKAGE_NAME) {
    errors.push('name が不正です')
  }
  if (typeof manifest.version !== 'string') {
    errors.push('version がありません')
  }
  if (typeof manifest.description !== 'string') {
    errors.push('description がありません')
  }
  if (!isPlainObject(manifest.author) || typeof manifest.author.name !== 'string') {
    errors.push('author.name がありません')
  }
  if (!isPlainObject(manifest.server) || manifest.server.type !== 'node') {
    errors.push('server.type は node である必要があります')
  }
  if (!isPlainObject(manifest.server) || manifest.server.entry_point !== 'server/index.js') {
    errors.push('server.entry_point が server/index.js ではありません')
  }
  const config =
    isPlainObject(manifest.server) && isPlainObject(manifest.server.mcp_config)
      ? manifest.server.mcp_config
      : null
  if (!config || config.command !== 'node') {
    errors.push('mcp_config.command は node である必要があります')
  }
  if (
    !config ||
    !Array.isArray(config.args) ||
    !config.args.includes('${__dirname}/server/index.js')
  ) {
    errors.push('mcp_config.args に ${__dirname}/server/index.js が必要です')
  }
  const tools = Array.isArray(manifest.tools) ? manifest.tools : []
  const names = tools
    .map((tool) => (isPlainObject(tool) ? tool.name : null))
    .filter((name): name is string => typeof name === 'string')
  for (const expected of SIKUMI_MCP_TOOLS) {
    if (!names.includes(expected)) {
      errors.push(`tools に ${expected} がありません`)
    }
  }
  const longDescription =
    typeof manifest.long_description === 'string' ? manifest.long_description : ''
  if (!longDescription.includes('sikumi.begin_work')) {
    errors.push('long_description に協調報告の指示がありません')
  }
  if (isPlainObject(manifest.compatibility)) {
    const platforms = Array.isArray(manifest.compatibility.platforms)
      ? manifest.compatibility.platforms
      : []
    if (platforms.includes('linux')) {
      errors.push('Linux Claude Desktop 対応は未検証のため platforms に linux を入れません')
    }
    if ('claude_desktop' in manifest.compatibility) {
      errors.push('未検証の claude_desktop バージョン条件は書けません')
    }
  }
  return { ok: errors.length === 0, errors }
}

export function packageClaudeDesktopMcpb(outputPath: string): {
  readonly ok: boolean
  readonly path: string
  readonly digest: string | null
  readonly files: readonly string[]
  readonly usedOfficialCli: boolean
} {
  const staging = mkdtempSync(join(tmpdir(), 'sikumi-mcpb-'))
  try {
    writeExtensionSources(staging)
    const files = listRelativeFiles(staging)
    const stagedValidation = runOfficialMcpbValidate(join(staging, 'manifest.json'))
    if (!stagedValidation.ok) {
      throw new Error(
        `official mcpb validate failed on staged manifest:\n${stagedValidation.output}`,
      )
    }
    packWithOfficialCli(staging, outputPath)
    verifyPackedArchive(outputPath)
    const digest = existsSync(outputPath)
      ? createHash('sha256').update(readFileSync(outputPath)).digest('hex')
      : null
    return {
      ok: existsSync(outputPath),
      path: outputPath,
      digest,
      files,
      usedOfficialCli: true,
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export function officialMcpbCliPath(): string | null {
  const local = join(
    claudeDesktopPackageRoot(),
    'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js',
  )
  if (existsSync(local)) {
    return local
  }
  const workspace = join(
    claudeDesktopPackageRoot(),
    '../../node_modules/@anthropic-ai/mcpb/dist/cli/cli.js',
  )
  return existsSync(workspace) ? workspace : null
}

export function runOfficialMcpbValidate(manifestPath = claudeDesktopManifestPath()): {
  readonly ok: boolean
  readonly output: string
} {
  const cli = officialMcpbCliPath()
  if (!cli) {
    return {
      ok: false,
      output: 'official @anthropic-ai/mcpb CLI is required',
    }
  }
  const spawned = spawnSync(process.execPath, [cli, 'validate', manifestPath], {
    encoding: 'utf8',
  })
  return {
    ok: spawned.status === 0,
    output: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`,
  }
}

export function unpackClaudeDesktopMcpb(
  archivePath: string,
  outputDir: string,
): void {
  const cli = officialMcpbCliPath()
  if (!cli) {
    throw new Error('official @anthropic-ai/mcpb CLI is required to unpack')
  }
  mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  const spawned = spawnSync(
    process.execPath,
    [cli, 'unpack', archivePath, outputDir],
    { encoding: 'utf8' },
  )
  if (spawned.status !== 0) {
    throw new Error(spawned.stderr || spawned.stdout || 'mcpb unpack failed')
  }
}

export function assertArchiveRuntimeComplete(root: string): readonly string[] {
  const entry = join(root, 'server/index.js')
  if (!existsSync(entry)) {
    return ['server/index.js']
  }
  const missing: string[] = []
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop()
    if (!current || seen.has(current)) {
      continue
    }
    seen.add(current)
    if (!existsSync(current)) {
      missing.push(relative(root, current).replaceAll('\\', '/'))
      continue
    }
    if (!current.endsWith('.js') && !current.endsWith('.mjs') && !current.endsWith('.cjs')) {
      continue
    }
    let source: string
    try {
      source = readFileSync(current, 'utf8')
    } catch {
      missing.push(relative(root, current).replaceAll('\\', '/'))
      continue
    }
    for (const specifier of collectImportSpecifiers(source)) {
      if (!specifier) {
        continue
      }
      const resolved = resolveArchiveImport(current, specifier, root)
      if (resolved === 'builtin') {
        continue
      }
      if (!resolved) {
        missing.push(`${relative(root, current).replaceAll('\\', '/') } -> ${specifier}`)
        continue
      }
      queue.push(resolved)
    }
  }
  return [...new Set(missing)].sort()
}

function packWithOfficialCli(staging: string, outputPath: string): void {
  const cli = officialMcpbCliPath()
  if (!cli) {
    throw new Error('official @anthropic-ai/mcpb CLI is required to pack')
  }
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 })
  if (existsSync(outputPath)) {
    rmSync(outputPath, { force: true })
  }
  const spawned = spawnSync(
    process.execPath,
    [cli, 'pack', staging, outputPath],
    { encoding: 'utf8' },
  )
  if (spawned.status !== 0 || !existsSync(outputPath)) {
    throw new Error(spawned.stderr || spawned.stdout || 'official mcpb pack failed')
  }
}

function verifyPackedArchive(outputPath: string): void {
  const extracted = mkdtempSync(join(tmpdir(), 'sikumi-mcpb-verify-'))
  try {
    unpackClaudeDesktopMcpb(outputPath, extracted)
    const unpackedRoot = resolveUnpackedRoot(extracted)
    const validated = runOfficialMcpbValidate(join(unpackedRoot, 'manifest.json'))
    if (!validated.ok) {
      throw new Error(
        `official mcpb validate failed on packed archive:\n${validated.output}`,
      )
    }
    const missing = assertArchiveRuntimeComplete(unpackedRoot)
    if (missing.length > 0) {
      throw new Error(
        `packed MCPB runtime is incomplete: ${missing.slice(0, 8).join(', ')}`,
      )
    }
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}

function resolveUnpackedRoot(extracted: string): string {
  if (existsSync(join(extracted, 'manifest.json'))) {
    return extracted
  }
  const children = readdirSync(extracted)
  for (const child of children) {
    const candidate = join(extracted, child)
    if (statSync(candidate).isDirectory() && existsSync(join(candidate, 'manifest.json'))) {
      return candidate
    }
  }
  return extracted
}

function copyExternalRuntime(targetRoot: string, name: string): void {
  const source = resolveInstalledPackage(name)
  if (!source) {
    throw new Error(`runtime dependency ${name} was not found`)
  }
  copyPackageFiles(source, join(targetRoot, 'server/node_modules', name))
}

function copyWorkspaceRuntime(targetRoot: string): void {
  const packagesRoot = join(claudeDesktopPackageRoot(), '..')
  const names = ['core', 'observer-core', 'observer-bridge'] as const
  for (const name of names) {
    const source = join(packagesRoot, name)
    if (!existsSync(join(source, 'package.json'))) {
      throw new Error(`workspace package ${name} is missing`)
    }
    const destination = join(
      targetRoot,
      'server/node_modules/@sikumi-local',
      name,
    )
    mkdirSync(destination, { recursive: true, mode: 0o700 })
    copyFileSync(join(source, 'package.json'), join(destination, 'package.json'))
    const dist = join(source, 'dist')
    if (!existsSync(dist)) {
      throw new Error(`workspace package ${name} has no dist/. Build first.`)
    }
    copyPackageFiles(dist, join(destination, 'dist'))
  }
}

const SERVER_RUNTIME_FILES = [
  'catalog.js',
  'cli.js',
  'events.js',
  'mcp-protocol.js',
  'normalize.js',
  'paths.js',
  'sessions.js',
  'tools.js',
] as const

function copyRuntimeEntry(targetRoot: string): void {
  const distDir = join(claudeDesktopPackageRoot(), 'dist')
  const serverDir = join(targetRoot, 'server')
  mkdirSync(serverDir, { recursive: true, mode: 0o700 })
  if (!existsSync(join(distDir, 'cli.js'))) {
    throw new Error(
      'observer-claude-desktop dist/cli.js is missing. Build the package before packing.',
    )
  }
  for (const name of SERVER_RUNTIME_FILES) {
    const source = join(distDir, name)
    if (!existsSync(source)) {
      throw new Error(`runtime file dist/${name} is missing. Build first.`)
    }
    copyFileSync(source, join(serverDir, name))
  }
}

function copyPackageFiles(from: string, to: string): void {
  mkdirSync(to, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(from)) {
    if (name === 'node_modules' || name === '.git' || name === 'src') {
      continue
    }
    const source = join(from, name)
    const destination = join(to, name)
    if (statSync(source).isDirectory()) {
      copyPackageFiles(source, destination)
      continue
    }
    if (
      name.endsWith('.js') ||
      name.endsWith('.mjs') ||
      name.endsWith('.cjs') ||
      name.endsWith('.json')
    ) {
      copyFileSync(source, destination)
    }
  }
}

function resolveInstalledPackage(name: string): string | null {
  const roots = [
    claudeDesktopPackageRoot(),
    join(claudeDesktopPackageRoot(), '../observer-core'),
    join(claudeDesktopPackageRoot(), '../core'),
    join(claudeDesktopPackageRoot(), '../observer-bridge'),
    join(claudeDesktopPackageRoot(), '../..'),
  ]
  for (const root of roots) {
    const packageJson = join(root, 'package.json')
    if (!existsSync(packageJson)) {
      continue
    }
    try {
      const require = createRequire(pathToFileURL(packageJson).href)
      const resolved = require.resolve(`${name}/package.json`)
      if (existsSync(resolved)) {
        return dirname(resolved)
      }
    } catch {
      // try the next resolution root
    }
  }
  return null
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /(?:import|export)\s+[^'"()\n]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
    /export\s+\*\s+from\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        specifiers.push(match[1])
      }
    }
  }
  return specifiers
}

function resolveArchiveImport(
  fromFile: string,
  specifier: string,
  archiveRoot: string,
): string | 'builtin' | null {
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) {
    return 'builtin'
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return resolveExistingModuleFile(resolve(dirname(fromFile), specifier))
  }
  if (specifier.startsWith('/')) {
    return null
  }
  return resolveNodeModuleFrom(dirname(fromFile), specifier, archiveRoot)
}

function resolveNodeModuleFrom(
  startDir: string,
  specifier: string,
  archiveRoot: string,
): string | null {
  const [pkgName, subpath] = splitPackageName(specifier)
  let current = startDir
  const root = resolve(archiveRoot)
  while (current.startsWith(root)) {
    const packageDir = join(current, 'node_modules', pkgName)
    const packageJsonPath = join(packageDir, 'package.json')
    if (existsSync(packageJsonPath)) {
      if (!subpath) {
        return resolvePackageEntry(packageDir)
      }
      return resolveExistingModuleFile(join(packageDir, subpath))
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return null
}

function splitPackageName(specifier: string): readonly [string, string] {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return [parts.slice(0, 2).join('/'), parts.slice(2).join('/')]
  }
  const slash = specifier.indexOf('/')
  if (slash < 0) {
    return [specifier, '']
  }
  return [specifier.slice(0, slash), specifier.slice(slash + 1)]
}

function resolvePackageEntry(packageDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      readonly exports?: unknown
      readonly module?: string
      readonly main?: string
    }
    const exported = resolveExportTarget(pkg.exports)
    const candidates = [
      exported,
      typeof pkg.module === 'string' ? pkg.module : null,
      typeof pkg.main === 'string' ? pkg.main : null,
      'index.js',
    ]
    for (const candidate of candidates) {
      if (!candidate) {
        continue
      }
      const resolved = resolveExistingModuleFile(join(packageDir, candidate))
      if (resolved) {
        return resolved
      }
    }
  } catch {
    return resolveExistingModuleFile(join(packageDir, 'index.js'))
  }
  return null
}

function resolveExportTarget(exportsField: unknown): string | null {
  if (typeof exportsField === 'string') {
    return exportsField
  }
  if (!isPlainObject(exportsField)) {
    return null
  }
  const direct = exportsField['.'] ?? exportsField.import ?? exportsField.default
  if (typeof direct === 'string') {
    return direct
  }
  if (isPlainObject(direct)) {
    for (const key of ['import', 'default', 'module', 'require']) {
      const value = direct[key]
      if (typeof value === 'string') {
        return value
      }
    }
  }
  return null
}

function resolveExistingModuleFile(path: string): string | null {
  const candidates = [
    path,
    `${path}.js`,
    `${path}.mjs`,
    `${path}.cjs`,
    join(path, 'index.js'),
    join(path, 'index.mjs'),
    join(path, 'index.cjs'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

function listRelativeFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else {
        files.push(relative(root, full).replaceAll('\\', '/'))
      }
    }
  }
  walk(root)
  return files.sort()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
