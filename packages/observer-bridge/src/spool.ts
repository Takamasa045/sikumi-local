import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  isObserverSourceId,
  nowIso,
  type NormalizedObserverEvent,
  type ObserverSourceId,
} from '@sikumi-local/observer-core'

export type RejectedSpoolCategory =
  | 'json-parse'
  | 'validation'
  | 'read-error'
  | 'oversized'
  | 'unknown'

export interface RejectedSpoolRecord {
  readonly source: string
  readonly fileName: string
  readonly fileHash: string
  readonly errorCategory: RejectedSpoolCategory
  readonly occurredAt: string
}

export const OBSERVER_INBOX_SOURCES = [
  'codex',
  'cursor',
  'grok-build',
  'claude-code',
  'claude-desktop',
  'git',
] as const

export function observerRoot(dataDirectory: string): string {
  return join(dataDirectory, 'observer')
}

export function observerInboxDir(
  dataDirectory: string,
  source: ObserverSourceId,
): string {
  return join(observerRoot(dataDirectory), 'inbox', source)
}

export function observerProcessedDir(dataDirectory: string): string {
  return join(observerRoot(dataDirectory), 'processed')
}

export function observerFailedDir(dataDirectory: string): string {
  return join(observerRoot(dataDirectory), 'failed')
}

export function ensureObserverLayout(dataDirectory: string): void {
  mkdirSync(observerRoot(dataDirectory), { recursive: true, mode: 0o700 })
  for (const source of OBSERVER_INBOX_SOURCES) {
    mkdirSync(observerInboxDir(dataDirectory, source), {
      recursive: true,
      mode: 0o700,
    })
  }
  mkdirSync(observerProcessedDir(dataDirectory), {
    recursive: true,
    mode: 0o700,
  })
  mkdirSync(observerFailedDir(dataDirectory), { recursive: true, mode: 0o700 })
}

export function safeSpoolFileId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export function hashSpoolBytes(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function writeSpoolEvent(
  dataDirectory: string,
  event: NormalizedObserverEvent,
): { readonly written: boolean; readonly path: string } {
  if (!isObserverSourceId(event.source)) {
    return { written: false, path: '' }
  }
  ensureObserverLayout(dataDirectory)
  const directory = observerInboxDir(dataDirectory, event.source)
  const fileId = safeSpoolFileId(event.idempotencyKey)
  const filePath = join(directory, `${fileId}.ndjson`)
  if (!isInsideDirectory(filePath, directory)) {
    return { written: false, path: '' }
  }
  if (existsSync(filePath)) {
    return { written: false, path: filePath }
  }

  const line = `${JSON.stringify(event)}\n`
  const tempPath = join(directory, `.tmp-${safeSpoolFileId(`${event.id}:${fileId}`)}`)
  if (!isInsideDirectory(tempPath, directory)) {
    return { written: false, path: '' }
  }
  try {
    writeFileSync(tempPath, line, { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, filePath)
    return { written: true, path: filePath }
  } catch {
    try {
      if (existsSync(tempPath)) {
        rmSync(tempPath, { force: true })
      }
    } catch {
      // fail-open
    }
    return { written: false, path: filePath }
  }
}

export function readSpoolDirectory(
  directory: string,
): Array<{ readonly path: string; readonly lines: string[] }> {
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ndjson') && !name.startsWith('.'))
    .sort()
    .map((name) => {
      const path = join(directory, name)
      let text: string
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        text = ''
      }
      return {
        path,
        lines: text.split(/\r?\n/).filter((line) => line.trim().length > 0),
      }
    })
}

export function listInboxFiles(
  dataDirectory: string,
): Array<{ readonly source: ObserverSourceId; readonly path: string }> {
  const files: Array<{ source: ObserverSourceId; path: string }> = []
  for (const source of OBSERVER_INBOX_SOURCES) {
    const directory = observerInboxDir(dataDirectory, source)
    if (!existsSync(directory)) {
      continue
    }
    for (const file of readSpoolDirectory(directory)) {
      files.push({ source, path: file.path })
    }
  }
  return files
}

export function recordRejectedSpool(
  dataDirectory: string,
  record: RejectedSpoolRecord,
): void {
  ensureObserverLayout(dataDirectory)
  const failed = join(observerFailedDir(dataDirectory), 'rejected.ndjson')
  mkdirSync(dirname(failed), { recursive: true, mode: 0o700 })
  const safe: RejectedSpoolRecord = {
    source: record.source,
    fileName: safeSpoolFileId(record.fileName),
    fileHash: record.fileHash,
    errorCategory: record.errorCategory,
    occurredAt: record.occurredAt,
  }
  appendFileSync(failed, `${JSON.stringify(safe)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export function quarantineSpoolFile(
  fromPath: string,
  dataDirectory: string,
  record: Omit<RejectedSpoolRecord, 'occurredAt'> & {
    readonly occurredAt?: string
  },
): void {
  ensureObserverLayout(dataDirectory)
  const failedDir = observerFailedDir(dataDirectory)
  mkdirSync(failedDir, { recursive: true, mode: 0o700 })
  const dest = join(failedDir, `${safeSpoolFileId(fromPath)}.ndjson`)
  const safe: RejectedSpoolRecord = {
    source: record.source,
    fileName: safeSpoolFileId(basename(fromPath)),
    fileHash: record.fileHash,
    errorCategory: record.errorCategory,
    occurredAt: record.occurredAt ?? nowIso(),
  }
  try {
    writeFileSync(dest, `${JSON.stringify(safe)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch {
    // still try to drop the raw source
  }
  try {
    if (existsSync(fromPath)) {
      rmSync(fromPath, { force: true })
    }
  } catch {
    // leave in place if delete fails; ingest can retry
  }
}

export function moveSpoolFile(fromPath: string, toDirectory: string): void {
  mkdirSync(toDirectory, { recursive: true, mode: 0o700 })
  const originalName = fromPath.split(/[/\\]/).at(-1) ?? 'event.ndjson'
  const destName = /^[A-Za-z0-9._-]+$/.test(originalName)
    ? originalName
    : `${safeSpoolFileId(originalName)}.ndjson`
  const dest = join(toDirectory, destName)
  if (!isInsideDirectory(dest, toDirectory)) {
    return
  }
  try {
    renameSync(fromPath, dest)
  } catch {
    // leave in place if move fails; ingest can retry
  }
}

function isInsideDirectory(target: string, directory: string): boolean {
  const resolvedTarget = resolve(target)
  const resolvedDirectory = resolve(directory)
  return (
    resolvedTarget === resolvedDirectory ||
    resolvedTarget.startsWith(`${resolvedDirectory}${sep}`)
  )
}
