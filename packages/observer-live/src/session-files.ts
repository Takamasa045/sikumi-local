import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  isPlainObject,
  OBSERVER_LIVE_MAX_FILE_BYTES,
  OBSERVER_LIVE_MAX_SESSION_FILES,
  OBSERVER_LIVE_SESSION_MAX_AGE_MS,
  safeJoinUnderRoot,
} from '@sikumi-local/observer-core'
import { matchRegisteredRoot } from './match.js'
import { firstExplicitTitle } from './titles.js'
import type {
  LiveAgentSource,
  LiveSighting,
  RegisteredLiveRoot,
} from './types.js'

export interface SessionFileRecord {
  readonly source: LiveAgentSource
  readonly cwd: string
  readonly title: string | null
  readonly lastObservedAt: string
  readonly externalSessionId: string
}

export function listRecentSessionRecords(input: {
  readonly homeDir: string
  readonly roots: readonly RegisteredLiveRoot[]
  readonly now: number
  readonly maxAgeMs?: number
}): SessionFileRecord[] {
  const maxAgeMs = input.maxAgeMs ?? OBSERVER_LIVE_SESSION_MAX_AGE_MS
  const records: SessionFileRecord[] = [
    ...readCodexSessions(input.homeDir, input.roots, input.now, maxAgeMs),
    ...readClaudeSessions(input.homeDir, input.roots, input.now, maxAgeMs),
    ...readCursorSessions(input.homeDir, input.roots, input.now, maxAgeMs),
    ...readGrokSessions(input.homeDir, input.roots, input.now, maxAgeMs),
  ]
  return dedupeRecords(records)
}

function readCodexSessions(
  homeDir: string,
  roots: readonly RegisteredLiveRoot[],
  now: number,
  maxAgeMs: number,
): SessionFileRecord[] {
  const sessionsRoot = safeJoinUnderRoot(homeDir, '.codex', 'sessions')
  if (!sessionsRoot || !existsSync(sessionsRoot)) {
    return []
  }
  const titles = readCodexTitleIndex(homeDir)
  const records: SessionFileRecord[] = []
  for (const file of listRecentFiles(sessionsRoot, now, maxAgeMs, 3)) {
    if (!file.endsWith('.jsonl')) {
      continue
    }
    const head = readJsonHead(file)
    const meta = asRecord(head?.payload) ?? head
    const cwd = readString(meta?.cwd)
    const matched = matchRegisteredRoot(cwd, roots)
    if (!matched || !cwd) {
      continue
    }
    const id = readString(meta?.id) ?? file
    records.push({
      source: 'codex',
      cwd,
      title: titles.get(id) ?? firstExplicitTitle(meta),
      lastObservedAt: new Date(fileMtime(file) ?? now).toISOString(),
      externalSessionId: `live:codex:${id}`,
    })
    if (records.length >= OBSERVER_LIVE_MAX_SESSION_FILES) {
      break
    }
  }
  return records
}

function readCodexTitleIndex(homeDir: string): Map<string, string> {
  const index = safeJoinUnderRoot(homeDir, '.codex', 'session_index.jsonl')
  const titles = new Map<string, string>()
  if (!index || !existsSync(index)) {
    return titles
  }
  const raw = readBoundedText(index)
  if (!raw) {
    return titles
  }
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseJsonObject(line)
    const id = readString(parsed?.id)
    const title = firstExplicitTitle(parsed, ['thread_name', 'threadName', 'title'])
    if (id && title) {
      titles.set(id, title)
    }
  }
  return titles
}

function readClaudeSessions(
  homeDir: string,
  roots: readonly RegisteredLiveRoot[],
  now: number,
  maxAgeMs: number,
): SessionFileRecord[] {
  const projectsRoot = safeJoinUnderRoot(homeDir, '.claude', 'projects')
  if (!projectsRoot || !existsSync(projectsRoot)) {
    return []
  }
  const records: SessionFileRecord[] = []
  for (const root of roots) {
    const encoded = encodeClaudeProjectDir(root.absolutePath)
    const projectDir = safeJoinUnderRoot(projectsRoot, encoded)
    if (!projectDir || !existsSync(projectDir)) {
      continue
    }
    for (const file of listRecentFiles(projectDir, now, maxAgeMs, 1)) {
      if (!file.endsWith('.jsonl')) {
        continue
      }
      const head = readJsonHead(file)
      const cwd = readString(head?.cwd) ?? root.absolutePath
      const matched = matchRegisteredRoot(cwd, roots)
      if (!matched) {
        continue
      }
      const id =
        readString(head?.sessionId) ??
        file.replace(/\.jsonl$/, '').split('/').pop() ??
        file
      records.push({
        source: 'claude-code',
        cwd,
        title: firstExplicitTitle(head, [
          'customTitle',
          'sessionName',
          'name',
        ]),
        lastObservedAt: new Date(fileMtime(file) ?? now).toISOString(),
        externalSessionId: `live:claude-code:${id}`,
      })
      if (records.length >= OBSERVER_LIVE_MAX_SESSION_FILES) {
        break
      }
    }
  }
  return records
}

function readCursorSessions(
  homeDir: string,
  roots: readonly RegisteredLiveRoot[],
  now: number,
  maxAgeMs: number,
): SessionFileRecord[] {
  const chatsRoot = safeJoinUnderRoot(homeDir, '.cursor', 'chats')
  const records: SessionFileRecord[] = []
  if (chatsRoot && existsSync(chatsRoot)) {
    for (const root of roots) {
      const hashed = createHash('md5').update(root.absolutePath).digest('hex')
      const workspaceDir = safeJoinUnderRoot(chatsRoot, hashed)
      if (!workspaceDir || !existsSync(workspaceDir)) {
        continue
      }
      for (const file of listRecentFiles(workspaceDir, now, maxAgeMs, 2)) {
        if (!file.endsWith('meta.json')) {
          continue
        }
        const meta = readJsonObjectFile(file)
        const cwd = readString(meta?.cwd) ?? root.absolutePath
        if (!matchRegisteredRoot(cwd, roots)) {
          continue
        }
        const id = file.split('/').at(-2) ?? file
        records.push({
          source: 'cursor',
          cwd,
          title: firstExplicitTitle(meta),
          lastObservedAt: new Date(fileMtime(file) ?? now).toISOString(),
          externalSessionId: `live:cursor:${id}`,
        })
        if (records.length >= OBSERVER_LIVE_MAX_SESSION_FILES) {
          break
        }
      }
    }
  }
  return records
}

function readGrokSessions(
  homeDir: string,
  roots: readonly RegisteredLiveRoot[],
  now: number,
  maxAgeMs: number,
): SessionFileRecord[] {
  const sessionsRoot = safeJoinUnderRoot(homeDir, '.grok', 'sessions')
  if (!sessionsRoot || !existsSync(sessionsRoot)) {
    return []
  }
  const records: SessionFileRecord[] = []
  for (const file of listRecentFiles(sessionsRoot, now, maxAgeMs, 2)) {
    if (!file.endsWith('.jsonl') && !file.endsWith('.json')) {
      continue
    }
    const head = readJsonHead(file) ?? readJsonObjectFile(file)
    const cwd = readString(head?.cwd)
    if (!cwd || !matchRegisteredRoot(cwd, roots)) {
      continue
    }
    const id = readString(head?.id) ?? file
    records.push({
      source: 'grok-build',
      cwd,
      title: firstExplicitTitle(head),
      lastObservedAt: new Date(fileMtime(file) ?? now).toISOString(),
      externalSessionId: `live:grok-build:${id}`,
    })
    if (records.length >= OBSERVER_LIVE_MAX_SESSION_FILES) {
      break
    }
  }
  return records
}

export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

function listRecentFiles(
  root: string,
  now: number,
  maxAgeMs: number,
  depth: number,
): string[] {
  const found: Array<{ path: string; mtime: number }> = []
  walk(root, depth, (path, mtime) => {
    if (now - mtime <= maxAgeMs) {
      found.push({ path, mtime })
    }
  })
  return found
    .sort((left, right) => right.mtime - left.mtime)
    .slice(0, OBSERVER_LIVE_MAX_SESSION_FILES)
    .map((item) => item.path)
}

function walk(
  root: string,
  depth: number,
  visit: (path: string, mtime: number) => void,
): void {
  if (depth < 0) {
    return
  }
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(root, entry)
    let stats
    try {
      stats = statSync(path)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      walk(path, depth - 1, visit)
      continue
    }
    if (stats.isFile()) {
      visit(path, stats.mtimeMs)
    }
  }
}

function readJsonHead(path: string): Record<string, unknown> | null {
  const raw = readBoundedText(path)
  if (!raw) {
    return null
  }
  const first = raw.split(/\r?\n/).find((line) => line.trim().length > 0)
  return parseJsonObject(first ?? '')
}

function readJsonObjectFile(path: string): Record<string, unknown> | null {
  return parseJsonObject(readBoundedText(path) ?? '')
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readBoundedText(path: string): string | null {
  try {
    const handle = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(OBSERVER_LIVE_MAX_FILE_BYTES)
      const bytes = readSync(handle, buffer, 0, buffer.length, 0)
      return buffer.subarray(0, bytes).toString('utf8')
    } finally {
      closeSync(handle)
    }
  } catch {
    return null
  }
}

function fileMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null
}

function dedupeRecords(
  records: readonly SessionFileRecord[],
): SessionFileRecord[] {
  const best = new Map<string, SessionFileRecord>()
  for (const record of records) {
    const key = `${record.source}:${record.cwd}`
    const current = best.get(key)
    if (
      !current ||
      Date.parse(record.lastObservedAt) > Date.parse(current.lastObservedAt)
    ) {
      best.set(key, record)
    }
  }
  return [...best.values()]
}

export function toLiveSighting(
  record: SessionFileRecord,
  roots: readonly RegisteredLiveRoot[],
): LiveSighting | null {
  const matched = matchRegisteredRoot(record.cwd, roots)
  if (!matched) {
    return null
  }
  return {
    source: record.source,
    surface:
      record.source === 'cursor'
        ? 'cursor-agent'
        : record.source === 'claude-code'
          ? 'cli'
          : record.source === 'grok-build'
            ? 'cli'
            : 'cli',
    kind: 'session-file',
    cwd: record.cwd,
    repositoryId: matched.repositoryId,
    workspaceId: matched.workspaceId,
    title: record.title,
    lastObservedAt: record.lastObservedAt,
    attributionConfidence: 'correlated',
    ingestionMethod: 'session-file',
    externalSessionId: record.externalSessionId,
    pid: null,
  }
}
