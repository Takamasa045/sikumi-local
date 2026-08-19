import { classifyChangedPath } from '../labels.js'

export const conflictResourceClasses = [
  'schema',
  'migration',
  'api',
  'config',
  'package-manifest',
  'lockfile',
  'generated',
  'test',
  'other',
] as const
export type ConflictResourceClass = (typeof conflictResourceClasses)[number]

export interface ClassifiedConflictPath {
  readonly path: string
  readonly class: ConflictResourceClass
  readonly stem: string
  readonly directory: string
  readonly tokens: readonly string[]
  readonly migrationNumber: string | null
  readonly packageName: string | null
  readonly isGenerated: boolean
  readonly areaLabel: string
}

const TOKEN_STOPWORDS = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'pkg',
  'dist',
  'build',
  'out',
  'public',
  'private',
  'internal',
  'index',
  'main',
  'user',
  'util',
  'utils',
  'helper',
  'helpers',
  'common',
  'shared',
  'core',
  'types',
  'type',
  'ts',
  'js',
  'tsx',
  'jsx',
  'mjs',
  'cjs',
  'page',
  'pages',
  'view',
  'views',
  'component',
  'components',
  'hook',
  'hooks',
  'api',
  'apis',
  'route',
  'routes',
  'router',
  'schema',
  'schemas',
  'config',
  'configs',
  'test',
  'tests',
  'spec',
  'e2e',
  'node_modules',
  'server',
  'client',
  'web',
  'db',
  'data',
  'model',
  'models',
  'service',
  'services',
  'controller',
  'controllers',
  'module',
  'modules',
])

const LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
])

const MANIFEST_NAMES = new Set([
  'package.json',
  'cargo.toml',
  'pyproject.toml',
  'go.mod',
  'composer.json',
  'gemfile',
])

export function classifyConflictPath(input: string): ClassifiedConflictPath {
  const path = normalizeConflictPath(input)
  const fileName = fileNameOf(path)
  const lowerName = fileName.toLowerCase()
  const directory = directoryOf(path)
  const isGenerated = isGeneratedPath(path)
  const migrationNumber = extractMigrationNumber(path)
  const stem = stemOf(fileName)
  const className = classifyResourceClass(
    path,
    lowerName,
    isGenerated,
    migrationNumber,
  )
  const tokens = significantTokens(path, stem)
  return {
    path,
    class: className,
    stem,
    directory,
    tokens,
    migrationNumber,
    packageName: packageNameOf(path),
    isGenerated,
    areaLabel: classifyChangedPath(path).label,
  }
}

export function normalizeConflictPath(input: string): string {
  return input.trim().replaceAll('\\', '/').replace(/^\.\//, '')
}

export function directoryOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '.' : path.slice(0, index)
}

export function fileNameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

export function stemOf(fileName: string): string {
  return fileName
    .replace(/\.(test|spec|e2e)(\.[^.]+)?$/i, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
}

export function isLockfilePath(path: string): boolean {
  return LOCKFILE_NAMES.has(fileNameOf(path).toLowerCase())
}

export function isPackageManifestPath(path: string): boolean {
  return MANIFEST_NAMES.has(fileNameOf(path).toLowerCase())
}

export function isGeneratedPath(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    /\.generated\./.test(lower) ||
    /\.gen\./.test(lower) ||
    /_generated\./.test(lower) ||
    /(^|\/)generated\//.test(lower) ||
    /(^|\/)__generated__\//.test(lower) ||
    (/\.d\.ts$/.test(lower) && /openapi|graphql|generated/.test(lower))
  )
}

export function extractMigrationNumber(path: string): string | null {
  const flyway = /(?:^|\/)v(\d{1,6})__/i.exec(path)
  if (flyway?.[1]) {
    return flyway[1]
  }
  const numbered = /(?:^|\/)(\d{6,})[_/]/.exec(path)
  if (numbered?.[1]) {
    return numbered[1]
  }
  if (/(^|\/)migrations?\//i.test(path)) {
    const digits = /(\d{4,})/.exec(fileNameOf(path))
    return digits?.[1] ?? null
  }
  return null
}

export function packageNameOf(path: string): string | null {
  const match = /^(?:packages|apps)\/([^/]+)/.exec(path)
  return match?.[1] ?? null
}

export function significantTokens(path: string, stem: string): string[] {
  const parts = [...path.split('/'), stem]
  const tokens = new Set<string>()
  for (const part of parts) {
    for (const piece of splitToken(part)) {
      if (
        piece.length < 3 ||
        TOKEN_STOPWORDS.has(piece) ||
        /^\d+$/.test(piece)
      ) {
        continue
      }
      tokens.add(piece)
    }
  }
  return [...tokens]
}

export function sharedSignificantTokens(
  left: ClassifiedConflictPath,
  right: ClassifiedConflictPath,
): string[] {
  const rightTokens = new Set(right.tokens)
  return left.tokens.filter((token) => rightTokens.has(token))
}

function classifyResourceClass(
  path: string,
  lowerName: string,
  generated: boolean,
  migrationNumber: string | null,
): ConflictResourceClass {
  if (isLockfilePath(path)) {
    return 'lockfile'
  }
  if (isPackageManifestPath(path)) {
    return 'package-manifest'
  }
  if (generated) {
    return 'generated'
  }
  if (
    migrationNumber ||
    /(^|\/)migrations?\//i.test(path) ||
    /migration/i.test(lowerName)
  ) {
    return 'migration'
  }
  if (/(schema|prisma|drizzle|\.sql$)/i.test(path)) {
    return 'schema'
  }
  if (/(^|\/)(api|routes?|endpoints?|controllers?)(\/|$)/i.test(path)) {
    return 'api'
  }
  if (/(config|\.env|settings|\.ya?ml$|\.toml$)/i.test(path)) {
    return 'config'
  }
  if (/(test|spec|e2e)/i.test(path)) {
    return 'test'
  }
  return 'other'
}

function splitToken(value: string): string[] {
  return value
    .replace(/\.[^.]+$/, '')
    .split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0)
}
