import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectInboundEvent } from '@sikumi-local/observer-core'
import { defaultDataDirectory, parseBridgeArgs } from './cli.js'
import {
  hashSpoolBytes,
  listInboxFiles,
  moveSpoolFile,
  observerFailedDir,
  observerProcessedDir,
  observerRoot,
  quarantineSpoolFile,
  readSpoolDirectory,
  recordRejectedSpool,
  safeSpoolFileId,
  writeSpoolEvent,
} from './spool.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function trackDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-bridge-spool-'))
  tempDirectories.push(directory)
  return directory
}

function sampleEvent(source: 'codex' | 'git' = 'codex') {
  return projectInboundEvent({
    source,
    nativeEventType: 'heartbeat',
    occurredAt: '2026-08-18T00:00:00.000Z',
    session_id: 'sess-spool',
  })
}

describe('observer-bridge spool helpers', () => {
  it('lists, hashes, quarantines, and moves spool files', () => {
    const root = trackDir()
    expect(observerRoot(root)).toBe(join(root, 'observer'))
    expect(hashSpoolBytes('abc')).toHaveLength(64)
    expect(readSpoolDirectory(join(root, 'missing'))).toEqual([])
    expect(listInboxFiles(root)).toEqual([])

    const event = sampleEvent()
    const written = writeSpoolEvent(root, event)
    expect(written.written).toBe(true)
    const inboxFiles = listInboxFiles(root)
    expect(inboxFiles).toHaveLength(1)
    expect(inboxFiles[0]?.source).toBe('codex')
    const listed = readSpoolDirectory(join(root, 'observer/inbox/codex'))
    expect(listed[0]?.lines.length).toBe(1)

    recordRejectedSpool(root, {
      source: 'codex',
      fileName: inboxFiles[0]!.path,
      fileHash: hashSpoolBytes('payload'),
      errorCategory: 'validation',
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    const rejected = readFileSync(
      join(observerFailedDir(root), 'rejected.ndjson'),
      'utf8',
    )
    expect(rejected).toContain('"errorCategory":"validation"')
    expect(rejected).not.toContain(inboxFiles[0]!.path)

    quarantineSpoolFile(inboxFiles[0]!.path, root, {
      source: 'codex',
      fileName: inboxFiles[0]!.path,
      fileHash: hashSpoolBytes('payload'),
      errorCategory: 'json-parse',
    })
    expect(existsSync(inboxFiles[0]!.path)).toBe(false)
    expect(readdirSync(observerFailedDir(root)).length).toBeGreaterThan(0)

    const again = writeSpoolEvent(root, {
      ...event,
      idempotencyKey: 'second-key',
    })
    expect(again.written).toBe(true)
    moveSpoolFile(again.path, observerProcessedDir(root))
    expect(existsSync(again.path)).toBe(false)
    expect(
      existsSync(
        join(
          observerProcessedDir(root),
          `${safeSpoolFileId('second-key')}.ndjson`,
        ),
      ) || readdirSync(observerProcessedDir(root)).length > 0,
    ).toBe(true)

    const unsafe = join(root, 'unsafe.ndjson')
    writeFileSync(unsafe, 'x\n')
    moveSpoolFile(unsafe, observerProcessedDir(root))
    expect(existsSync(unsafe)).toBe(false)
  })

  it('does not write an event with an unknown source', () => {
    const root = trackDir()
    const result = writeSpoolEvent(root, {
      ...sampleEvent(),
      source: 'not-a-source' as never,
    })
    expect(result.written).toBe(false)
    expect(result.path).toBe('')
  })

  it('parses --data-dir and reports the default data directory', () => {
    expect(parseBridgeArgs(['--data-dir', '/tmp/data', 'git'])).toEqual({
      source: 'git',
      dataDirectory: '/tmp/data',
    })
    expect(parseBridgeArgs(['--root'])).toEqual({
      source: null,
      dataDirectory: null,
    })
    expect(
      defaultDataDirectory({ SIKUMI_LOCAL_DATA_DIR: '/tmp/isolated' }),
    ).toBe('/tmp/isolated')
    expect(defaultDataDirectory({})).toMatch(/\.shikumi-local$/)
  })
})
