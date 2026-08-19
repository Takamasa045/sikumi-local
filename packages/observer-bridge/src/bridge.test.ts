import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { parseBridgeArgs, runObserverBridge } from './cli.js'
import { observerInboxDir, writeSpoolEvent } from './spool.js'
import { projectInboundEvent } from '@sikumi-local/observer-core'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('observer-bridge', () => {
  it('writes an allowlisted event into a source-specific spool', async () => {
    const root = createTemp()
    const code = await runObserverBridge(['codex', '--root', root], {
      stdin: Readable.from([
        JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 's1',
          cwd: '/tmp/project',
          prompt: 'do not persist this prompt',
        }),
      ]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })

    expect(code).toBe(0)
    const inbox = observerInboxDir(root, 'codex')
    const files = readNdjson(inbox)
    expect(files).toHaveLength(1)
    const stored = JSON.parse(files[0]!) as { payload: Record<string, string> }
    expect(stored.payload.prompt).toBeUndefined()
    expect(stored.payload.nativeEventType).toBe('SessionStart')
  })

  it('is idempotent for the same event and stays fail-open', async () => {
    const root = createTemp()
    const payload = {
      source: 'cursor' as const,
      nativeEventType: 'afterFileEdit',
      session_id: 'same',
      occurredAt: '2026-08-18T00:00:00.000Z',
      file_path: 'src/a.ts',
    }
    const first = await runObserverBridge(['cursor', '--root', root], {
      stdin: Readable.from([JSON.stringify(payload)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const second = await runObserverBridge(['cursor', '--root', root], {
      stdin: Readable.from([JSON.stringify(payload)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const broken = await runObserverBridge(['cursor', '--root', root], {
      stdin: Readable.from(['{not-json']),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    const huge = await runObserverBridge(['cursor', '--root', root], {
      stdin: Readable.from(['x'.repeat(20_000)]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })

    expect(first).toBe(0)
    expect(second).toBe(0)
    expect(broken).toBe(0)
    expect(huge).toBe(0)
    expect(readNdjson(observerInboxDir(root, 'cursor'))).toHaveLength(1)
  })

  it('does not write when source is missing and parses --root', () => {
    expect(parseBridgeArgs(['--root', '/tmp/data', 'codex'])).toEqual({
      source: 'codex',
      dataDirectory: '/tmp/data',
    })
    expect(parseBridgeArgs(['unknown'])).toEqual({
      source: null,
      dataDirectory: null,
    })
  })

  it('skips a second write of the same idempotency key', () => {
    const root = createTemp()
    const event = projectInboundEvent({
      source: 'git',
      nativeEventType: 'heartbeat',
      occurredAt: '2026-08-18T00:00:00.000Z',
    })
    expect(writeSpoolEvent(root, event).written).toBe(true)
    expect(writeSpoolEvent(root, event).written).toBe(false)
  })

  it('never uses the raw idempotency key as a file name', async () => {
    const root = createTemp()
    const escapes = [
      '../../processed/escaped-event',
      '..\\processed\\escaped-event',
      '/tmp/absolute-escape',
      'foo/bar/escape-key',
      'foo\\bar\\escape-key',
      '..\u2025/processed/unicode-escape',
    ]
    for (const idempotencyKey of escapes) {
      const code = await runObserverBridge(['codex', '--root', root], {
        stdin: Readable.from([
          JSON.stringify({
            source: 'codex',
            nativeEventType: 'heartbeat',
            occurredAt: '2026-08-18T00:00:00.000Z',
            idempotencyKey,
          }),
        ]),
        stdout: sink(),
        stderr: sink(),
        env: {},
      })
      expect(code).toBe(0)
    }

    expect(existsSync(join(root, 'observer/processed/escaped-event.ndjson'))).toBe(
      false,
    )
    expect(
      existsSync(join(root, 'observer/processed/unicode-escape.ndjson')),
    ).toBe(false)
    const inbox = observerInboxDir(root, 'codex')
    const names = readdirSync(inbox).filter((name) => name.endsWith('.ndjson'))
    expect(names.length).toBe(escapes.length)
    expect(names.every((name) => /^[0-9a-f]{32}\.ndjson$/.test(name))).toBe(true)
  })

  it('does not follow a symlink escape from the inbox', () => {
    const root = createTemp()
    const outside = join(root, 'outside-secret.ndjson')
    writeFileSync(outside, 'keep\n')
    const inbox = observerInboxDir(root, 'cursor')
    mkdirSync(inbox, { recursive: true })
    symlinkSync(outside, join(inbox, 'link.ndjson'))
    const event = projectInboundEvent({
      source: 'cursor',
      nativeEventType: 'heartbeat',
      occurredAt: '2026-08-18T00:00:00.000Z',
      idempotencyKey: 'link-escape-key',
    })
    const written = writeSpoolEvent(root, event)
    expect(written.written).toBe(true)
    expect(written.path.endsWith('link.ndjson')).toBe(false)
    expect(readFileSync(outside, 'utf8')).toBe('keep\n')
  })

  it('exits 0 when the inbox cannot be written', async () => {
    const root = createTemp()
    const inbox = observerInboxDir(root, 'codex')
    mkdirSync(inbox, { recursive: true })
    chmodSync(inbox, 0o500)
    const code = await runObserverBridge(['codex', '--root', root], {
      stdin: Readable.from([
        JSON.stringify({
          hook_event_name: 'SessionStart',
          session_id: 'write-fail',
          prompt: 'must not block the hook',
        }),
      ]),
      stdout: sink(),
      stderr: sink(),
      env: {},
    })
    chmodSync(inbox, 0o700)
    expect(code).toBe(0)
    expect(readNdjson(inbox)).toHaveLength(0)
  })
})

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-observer-bridge-'))
  tempDirectories.push(directory)
  return directory
}

function readNdjson(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ndjson'))
    .map((name) => readFileSync(join(directory, name), 'utf8').trim())
}

function sink(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
}
