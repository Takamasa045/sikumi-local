import { OBSERVER_MAX_PATH_CHARS } from './limits.js'
import { containsParentTraversal } from './paths.js'

export const SAFE_COMMAND_CATEGORIES = [
  'test',
  'build',
  'lint',
  'format',
  'git',
  'install',
  'typecheck',
  'other',
  'unknown',
] as const
export type SafeCommandCategory = (typeof SAFE_COMMAND_CATEGORIES)[number]

const FILE_EDIT_TOOLS = new Set([
  'apply_patch',
  'applypatch',
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'strreplace',
  'create',
])

const FILE_READ_TOOLS = new Set(['read', 'readfile', 'read_file'])

export function firstCommandToken(command: string): string {
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    return ''
  }
  const withoutEnv = trimmed.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, '')
  const token = withoutEnv.split(/\s+/)[0] ?? ''
  return token.replace(/^.*[/\\]/, '').toLowerCase()
}

export function classifyCommandCategory(command: unknown): SafeCommandCategory {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return 'unknown'
  }
  const token = firstCommandToken(command)
  if (token.length === 0) {
    return 'unknown'
  }
  if (token === 'git') {
    return 'git'
  }
  if (
    token === 'vitest' ||
    token === 'jest' ||
    token === 'playwright' ||
    token === 'mocha' ||
    token === 'pytest' ||
    (token === 'go' && /\btest\b/.test(command))
  ) {
    return 'test'
  }
  if (token === 'eslint' || token === 'lint') {
    return 'lint'
  }
  if (token === 'prettier' || token === 'format') {
    return 'format'
  }
  if (token === 'tsc' || token === 'typecheck') {
    return 'typecheck'
  }
  if (
    token === 'pnpm' ||
    token === 'npm' ||
    token === 'yarn' ||
    token === 'npx' ||
    token === 'bun'
  ) {
    const rest = command.toLowerCase()
    if (/\b(test|vitest|jest|playwright)\b/.test(rest)) {
      return 'test'
    }
    if (/\b(lint|eslint)\b/.test(rest)) {
      return 'lint'
    }
    if (/\b(format|prettier)\b/.test(rest)) {
      return 'format'
    }
    if (/\b(typecheck|tsc)\b/.test(rest)) {
      return 'typecheck'
    }
    if (/\b(build|vite)\b/.test(rest)) {
      return 'build'
    }
    if (/\b(i|install|ci|add)\b/.test(rest)) {
      return 'install'
    }
    return 'other'
  }
  if (token === 'make' || token === 'cargo' || token === 'vite') {
    return 'build'
  }
  return 'other'
}

export function extractToolFilePaths(input: {
  readonly toolName?: string | null
  readonly toolInput?: unknown
}): string[] {
  const toolInput = input.toolInput
  const names = new Set<string>()
  collectPathLikeValues(toolInput, names)
  if (isPlainObject(toolInput)) {
    const patch = readString(toolInput.patch) ?? readString(toolInput.diff)
    if (patch) {
      for (const path of extractApplyPatchPaths(patch)) {
        names.add(path)
      }
    }
    if (isPlainObject(toolInput.changes)) {
      for (const key of Object.keys(toolInput.changes)) {
        const safe = sanitizeObservedPath(key)
        if (safe) {
          names.add(safe)
        }
      }
    }
  }
  return [...names]
}

export function extractApplyPatchPaths(patch: string): string[] {
  const paths: string[] = []
  const patterns = [
    /^\*\*\*\s+(?:Add|Update|Delete|Move)\s+File:\s+(.+)$/gm,
    /^\*\*\*\s+Move to:\s+(.+)$/gm,
    /^(?:---|\+\+\+)\s+[ab]\/(.+)$/gm,
  ]
  for (const pattern of patterns) {
    for (const match of patch.matchAll(pattern)) {
      const safe = sanitizeObservedPath(match[1] ?? '')
      if (safe) {
        paths.push(safe)
      }
    }
  }
  return [...new Set(paths)]
}

export function toolActionForName(
  toolName: string | null | undefined,
): 'read' | 'write' | 'execute' | null {
  if (!toolName) {
    return null
  }
  const normalized = toolName
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  if (FILE_READ_TOOLS.has(normalized) || normalized.includes('read')) {
    return 'read'
  }
  if (
    FILE_EDIT_TOOLS.has(normalized) ||
    normalized.includes('edit') ||
    normalized.includes('write') ||
    normalized.includes('applypatch')
  ) {
    return 'write'
  }
  if (
    normalized === 'bash' ||
    normalized === 'shell' ||
    normalized.includes('command')
  ) {
    return 'execute'
  }
  return null
}

export function sanitizeObservedPath(value: string): string | null {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  if (
    trimmed.length === 0 ||
    trimmed.length > OBSERVER_MAX_PATH_CHARS ||
    trimmed.includes('\0') ||
    containsParentTraversal(trimmed)
  ) {
    return null
  }
  return trimmed.replaceAll('\\', '/')
}

function collectPathLikeValues(
  value: unknown,
  into: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || into.size >= 16) {
    return
  }
  if (typeof value === 'string') {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPathLikeValues(item, into, depth + 1)
    }
    return
  }
  if (!isPlainObject(value)) {
    return
  }
  const pathKeys = [
    'file_path',
    'filePath',
    'path',
    'target_file',
    'targetFile',
    'pathA',
    'pathB',
    'notebook_path',
    'notebookPath',
  ]
  for (const key of pathKeys) {
    const candidate = value[key]
    if (typeof candidate === 'string') {
      const safe = sanitizeObservedPath(candidate)
      if (safe) {
        into.add(safe)
      }
    }
  }
  for (const nested of Object.values(value)) {
    if (isPlainObject(nested) || Array.isArray(nested)) {
      collectPathLikeValues(nested, into, depth + 1)
    }
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
