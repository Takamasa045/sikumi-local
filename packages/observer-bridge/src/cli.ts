import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import {
  assertEventSizeLimit,
  isObserverSourceId,
  OBSERVER_MAX_EVENT_BYTES,
  projectInboundEvent,
  type ObserverSourceId,
} from '@sikumi-local/observer-core'
import { writeSpoolEvent } from './spool.js'

export interface BridgeIo {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly env: NodeJS.ProcessEnv
}

export async function runObserverBridge(
  argv: readonly string[],
  io: BridgeIo,
): Promise<number> {
  try {
    await runBridgeOrThrow(argv, io)
  } catch (error) {
    writeLine(io.stderr, formatBridgeError(error))
  }
  return 0
}

async function runBridgeOrThrow(
  argv: readonly string[],
  io: BridgeIo,
): Promise<void> {
  const parsed = parseBridgeArgs(argv)
  if (!parsed.source) {
    return
  }
  const raw = await readStdinBounded(io.stdin)
  if (raw.trim().length === 0) {
    return
  }
  assertEventSizeLimit(raw)
  const json = JSON.parse(raw) as unknown
  const event = projectInboundEvent(json, {
    source: parsed.source,
    ingestionMethod: 'hook',
  })
  writeSpoolEvent(parsed.dataDirectory ?? defaultDataDirectory(io.env), event)
}

export function parseBridgeArgs(argv: readonly string[]): {
  readonly source: ObserverSourceId | null
  readonly dataDirectory: string | null
} {
  let source: ObserverSourceId | null = null
  let dataDirectory: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value) {
      continue
    }
    if (value === '--root' || value === '--data-dir') {
      dataDirectory = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (!value.startsWith('-') && isObserverSourceId(value)) {
      source = value
    }
  }
  return { source, dataDirectory }
}

export function defaultDataDirectory(env: NodeJS.ProcessEnv): string {
  return env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')
}

async function readStdinBounded(stdin: Readable): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.length
    if (total > OBSERVER_MAX_EVENT_BYTES) {
      assertEventSizeLimit(buffer.length > OBSERVER_MAX_EVENT_BYTES ? buffer : Buffer.concat([...chunks, buffer]))
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function formatBridgeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'observer bridge failed'
}

function writeLine(stream: Writable, text: string): void {
  try {
    stream.write(`${text}\n`)
  } catch {
    // fail-open
  }
}
