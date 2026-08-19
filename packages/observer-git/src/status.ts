import type { ObserverChangeType } from '@sikumi-local/observer-core'
import { sanitizeRepoPath } from './paths.js'

export interface ChangedPath {
  readonly path: string
  readonly previousPath: string | null
  readonly changeType: ObserverChangeType
  readonly addedLines: number | null
  readonly deletedLines: number | null
  readonly staged: boolean
  readonly untracked: boolean
  readonly hash: string | null
}

export function parseWorktreeList(output: string): Array<{
  readonly path: string
  readonly head: string | null
  readonly branch: string | null
}> {
  const items: Array<{ path: string; head: string | null; branch: string | null }> =
    []
  let current: { path: string; head: string | null; branch: string | null } | null =
    null
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('worktree ')) {
      if (current) {
        items.push(current)
      }
      current = { path: line.slice('worktree '.length), head: null, branch: null }
      continue
    }
    if (!current) {
      continue
    }
    if (line.startsWith('HEAD ')) {
      current = { ...current, head: line.slice('HEAD '.length) }
    } else if (line.startsWith('branch ')) {
      current = {
        ...current,
        branch: line.slice('branch '.length).replace(/^refs\/heads\//, ''),
      }
    } else if (line.startsWith('detached')) {
      current = { ...current, branch: null }
    }
  }
  if (current) {
    items.push(current)
  }
  return items
}

export function parseStatusPorcelainV2(
  output: string,
  repositoryRoot: string,
): ChangedPath[] {
  const changed = new Map<string, ChangedPath>()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.length === 0) {
      continue
    }
    if (line.startsWith('? ')) {
      const path = sanitizeRepoPath(line.slice(2), repositoryRoot)
      if (!path) {
        continue
      }
      changed.set(path, {
        path,
        previousPath: null,
        changeType: 'untracked',
        addedLines: null,
        deletedLines: null,
        staged: false,
        untracked: true,
        hash: null,
      })
      continue
    }
    if (line.startsWith('u ')) {
      const path = lastField(line)
      const sanitized = path ? sanitizeRepoPath(path, repositoryRoot) : null
      if (!sanitized) {
        continue
      }
      changed.set(sanitized, {
        path: sanitized,
        previousPath: null,
        changeType: 'unmerged',
        addedLines: null,
        deletedLines: null,
        staged: false,
        untracked: false,
        hash: null,
      })
      continue
    }
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parsed = parseOrdinaryOrRename(line, repositoryRoot)
      if (parsed) {
        changed.set(parsed.path, parsed)
      }
    }
  }
  return [...changed.values()]
}

export function applyNameStatus(
  files: ChangedPath[],
  output: string,
  repositoryRoot: string,
): ChangedPath[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.length === 0) {
      continue
    }
    const parts = line.split('\t')
    const code = parts[0] ?? ''
    if (code.startsWith('R') || code.startsWith('C')) {
      const previous = sanitizeRepoPath(parts[1] ?? '', repositoryRoot)
      const next = sanitizeRepoPath(parts[2] ?? '', repositoryRoot)
      if (!next) {
        continue
      }
      const current = byPath.get(next)
      byPath.set(next, {
        path: next,
        previousPath: previous,
        changeType: code.startsWith('R') ? 'renamed' : 'copied',
        addedLines: current?.addedLines ?? null,
        deletedLines: current?.deletedLines ?? null,
        staged: current?.staged ?? false,
        untracked: false,
        hash: current?.hash ?? null,
      })
      continue
    }
    const path = sanitizeRepoPath(parts[1] ?? '', repositoryRoot)
    if (!path) {
      continue
    }
    const current = byPath.get(path)
    byPath.set(path, {
      path,
      previousPath: current?.previousPath ?? null,
      changeType: nameStatusToType(code),
      addedLines: current?.addedLines ?? null,
      deletedLines: current?.deletedLines ?? null,
      staged: current?.staged ?? false,
      untracked: current?.untracked ?? false,
      hash: current?.hash ?? null,
    })
  }
  return [...byPath.values()]
}

export function applyNumstat(
  files: ChangedPath[],
  output: string,
  repositoryRoot: string,
): ChangedPath[] {
  const byPath = new Map(files.map((file) => [file.path, file]))
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.length === 0) {
      continue
    }
    const parts = line.split('\t')
    const added = parseCount(parts[0])
    const deleted = parseCount(parts[1])
    const pathToken = parts.length > 3 ? (parts[3] ?? parts[2]) : parts[2]
    const path = sanitizeRepoPath(pathToken ?? '', repositoryRoot)
    if (!path) {
      continue
    }
    const current = byPath.get(path) ?? {
      path,
      previousPath: null,
      changeType: 'modified' as const,
      addedLines: null,
      deletedLines: null,
      staged: false,
      untracked: false,
      hash: null,
    }
    byPath.set(path, {
      ...current,
      addedLines: added,
      deletedLines: deleted,
    })
  }
  return [...byPath.values()]
}

function parseOrdinaryOrRename(
  line: string,
  repositoryRoot: string,
): ChangedPath | null {
  const rename = line.startsWith('2 ')
  const rest = line.slice(2)
  const xy = rest.slice(0, 2)
  const tokens = rest.split(' ').filter((token) => token.length > 0)
  const hash = extractPorcelainHash(tokens)
  const pathPart = rename ? rest.split(' ').slice(8).join(' ') : lastField(rest)
  if (!pathPart) {
    return null
  }
  let path = pathPart
  let previousPath: string | null = null
  if (rename && pathPart.includes('\t')) {
    const [left, right] = pathPart.split('\t')
    previousPath = sanitizeRepoPath(left ?? '', repositoryRoot)
    path = right ?? ''
  }
  const sanitized = sanitizeRepoPath(path, repositoryRoot)
  if (!sanitized) {
    return null
  }
  return {
    path: sanitized,
    previousPath,
    changeType: xy.includes('D')
      ? 'deleted'
      : xy.includes('A')
        ? 'added'
        : rename
          ? 'renamed'
          : 'modified',
    addedLines: null,
    deletedLines: null,
    staged: xy[0] !== '.' && xy[0] !== ' ',
    untracked: false,
    hash,
  }
}

function extractPorcelainHash(tokens: readonly string[]): string | null {
  const hashes = tokens.filter((token) => /^[0-9a-f]{7,64}$/i.test(token))
  return hashes.at(-1) ?? null
}

function nameStatusToType(code: string): ObserverChangeType {
  if (code.startsWith('A')) {
    return 'added'
  }
  if (code.startsWith('D')) {
    return 'deleted'
  }
  if (code.startsWith('R')) {
    return 'renamed'
  }
  if (code.startsWith('C')) {
    return 'copied'
  }
  if (code.startsWith('U')) {
    return 'unmerged'
  }
  return 'modified'
}

function parseCount(value: string | undefined): number | null {
  if (!value || value === '-') {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function lastField(line: string): string | null {
  const parts = line.split(' ')
  return parts.at(-1) ?? null
}
