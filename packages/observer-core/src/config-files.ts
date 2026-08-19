import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { AppError } from '@sikumi-local/core'
import {
  containsParentTraversal,
  isContainedPath,
  looksWindowsAbsolutePath,
} from './paths.js'
import type { ObserverInstallFilePlan } from './types.js'

const SHELL_METACHARACTERS = /[|&;<>()$`\\'\n\r*?[\]{}!#~]/

export function realUserHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME && env.HOME.trim().length > 0
    ? resolve(env.HOME)
    : resolve(homedir())
}

export function realpathIfExists(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

export function isInsideRoot(target: string, root: string): boolean {
  if (looksWindowsAbsolutePath(target) || looksWindowsAbsolutePath(root)) {
    return isContainedPath(target, root)
  }
  const resolvedTarget = resolve(target)
  const resolvedRoot = resolve(root)
  return isContainedPath(resolvedTarget, resolvedRoot)
}

export function isInsideResolvedRoot(target: string, root: string): boolean {
  return isInsideRoot(realpathIfExists(target), realpathIfExists(root))
}

export function isRealUserHomePath(
  candidate: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!candidate) {
    return false
  }
  const home = realUserHome(env)
  const resolved = resolve(candidate)
  return (
    resolved === home ||
    isInsideRoot(resolved, join(home, '.codex')) ||
    isInsideRoot(resolved, join(home, '.claude')) ||
    isInsideRoot(resolved, join(home, '.cursor')) ||
    isInsideRoot(resolved, join(home, '.grok'))
  )
}

export function refuseRealUserApplyMessage(): string {
  return '実ユーザーの設定ファイルへは、許可のない適用は書き込みません。差分の確認だけできます。'
}

export function safeJoinUnderRoot(
  root: string,
  ...segments: string[]
): string | null {
  if (!isAbsolute(root) || containsParentTraversal(root)) {
    return null
  }
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment.includes('\0') ||
      containsParentTraversal(segment) ||
      isAbsolute(segment)
    ) {
      return null
    }
  }
  const joined = resolve(root, ...segments)
  if (!isInsideRoot(joined, root)) {
    return null
  }
  return joined
}

export function resolveExistingPathInside(
  path: string,
  root: string,
): string | null {
  try {
    const real = realpathSync(path)
    return isInsideResolvedRoot(real, root) ? real : null
  } catch {
    return isInsideResolvedRoot(path, root) ? resolve(path) : null
  }
}

export function assertConfigPathWritable(
  root: string,
  relativeSegments: readonly string[],
): string {
  const target = safeJoinUnderRoot(root, ...relativeSegments)
  if (!target) {
    throw new AppError('PATH_TRAVERSAL', 'Config path is not safe', 400)
  }
  let current = root
  if (!isInsideRoot(current, root)) {
    throw new AppError('PATH_TRAVERSAL', 'Config root is not safe', 400)
  }
  for (const segment of relativeSegments) {
    current = join(current, segment)
    if (!isInsideRoot(current, root)) {
      throw new AppError(
        'PATH_TRAVERSAL',
        'Config path escaped the sandbox',
        400,
      )
    }
    if (!existsSync(current)) {
      continue
    }
    try {
      if (lstatSync(current).isSymbolicLink()) {
        const real = realpathSync(current)
        if (!isInsideRoot(real, root)) {
          throw new AppError(
            'PATH_TRAVERSAL',
            'Config path symlink leaves the sandbox',
            400,
          )
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }
    }
  }
  return target
}

export function toSafeHookCommand(absolutePath: string): string | null {
  if (
    (!isAbsolute(absolutePath) && !looksWindowsAbsolutePath(absolutePath)) ||
    absolutePath.includes('\0')
  ) {
    return null
  }
  if (containsParentTraversal(absolutePath)) {
    return null
  }
  if (SHELL_METACHARACTERS.test(absolutePath) || absolutePath.includes('"')) {
    return null
  }
  return absolutePath
}

export function quoteTomlString(value: string): string {
  return JSON.stringify(value)
}

export function unquoteHookCommand(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export const ALLOWED_HOOK_COMMAND_NAMES = new Set([
  'sikumi-observer-codex.mjs',
  'sikumi-observer-cursor.mjs',
  'sikumi-observer-claude-code.mjs',
  'sikumi-observer-grok.mjs',
])

export function hookCommandFilename(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop() ?? ''
}

export function hookCommandMatches(
  command: unknown,
  expectedAbsolutePath: string,
): boolean {
  const expected = expectedAbsolutePath.replaceAll('\\', '/')
  if (typeof command === 'string') {
    return unquoteHookCommand(command).replaceAll('\\', '/') === expected
  }
  if (Array.isArray(command) && typeof command[0] === 'string') {
    return unquoteHookCommand(command[0]).replaceAll('\\', '/') === expected
  }
  return false
}

export function isOurHookCommandPath(
  command: unknown,
  expectedAbsolutePath: string,
): boolean {
  if (hookCommandMatches(command, expectedAbsolutePath)) {
    return true
  }
  const actual =
    typeof command === 'string'
      ? unquoteHookCommand(command).replaceAll('\\', '/')
      : commandFromHookEntry(command)?.replaceAll('\\', '/')
  if (!actual) {
    return false
  }
  const filename = hookCommandFilename(expectedAbsolutePath)
  if (!ALLOWED_HOOK_COMMAND_NAMES.has(filename)) {
    return false
  }
  return actual === filename || actual.endsWith(`/${filename}`)
}

export function commandFromHookEntry(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0]
  }
  return null
}

export function readJsonObject(path: string): {
  readonly ok: boolean
  readonly value: Record<string, unknown>
  readonly raw: string | null
} {
  if (!existsSync(path)) {
    return { ok: true, value: {}, raw: null }
  }
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.trim().length === 0) {
      return { ok: true, value: {}, raw }
    }
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ok: false, value: {}, raw }
    }
    return { ok: true, value: parsed as Record<string, unknown>, raw }
  } catch {
    return { ok: false, value: {}, raw: null }
  }
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, formatJson(value), { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, path)
}

export function restoreFile(path: string, previous: string | undefined): void {
  try {
    if (previous === undefined) {
      if (existsSync(path)) {
        rmSync(path, { force: true })
      }
      return
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, previous, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // rollback is best-effort
  }
}

export function applyFilePlans(files: readonly ObserverInstallFilePlan[]): {
  readonly ok: boolean
  readonly changed: boolean
} {
  const applied: ObserverInstallFilePlan[] = []
  try {
    for (const file of files) {
      if (file.action === 'keep') {
        continue
      }
      if (file.action === 'remove') {
        if (existsSync(file.path)) {
          rmSync(file.path, { force: true })
        }
        applied.push(file)
        continue
      }
      mkdirSync(dirname(file.path), { recursive: true, mode: 0o700 })
      writeFileSync(file.path, file.preview, { encoding: 'utf8', mode: 0o600 })
      applied.push(file)
    }
    return { ok: true, changed: applied.length > 0 }
  } catch {
    for (const file of applied.reverse()) {
      restoreFile(file.path, file.previous)
    }
    return { ok: false, changed: false }
  }
}

export function previewForFiles(
  files: readonly ObserverInstallFilePlan[],
): string {
  return files
    .map((file) => `${file.action} ${file.path}\n${file.preview}`)
    .join('\n---\n')
}

export function isHookEntryOurs(
  entry: unknown,
  expectedCommandPath: string,
): boolean {
  if (!isPlainObject(entry)) {
    return false
  }
  if (isOurHookCommandPath(entry.command, expectedCommandPath)) {
    return true
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) =>
      isHookEntryOurs(hook, expectedCommandPath),
    )
  }
  return false
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readTextIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}
