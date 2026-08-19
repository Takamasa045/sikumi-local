import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { writeSpoolEvent } from '@sikumi-local/observer-bridge'
import {
  assertEventSizeLimit,
  OBSERVER_MAX_EVENT_BYTES,
} from '@sikumi-local/observer-core'
import { normalizeGrokEvent } from './normalize.js'

export interface HookIo {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly env: NodeJS.ProcessEnv
}

export async function runGrokObserverHook(
  argv: readonly string[],
  io: HookIo,
): Promise<number> {
  try {
    if (wantsStreamingJson(argv)) {
      await ingestStreamingJson(argv, io)
      return 0
    }
    const raw = await readStdinBounded(io.stdin)
    if (raw.trim().length === 0) {
      return 0
    }
    assertEventSizeLimit(raw)
    const json = JSON.parse(raw) as unknown
    const event = normalizeGrokEvent(json)
    if (!event) {
      return 0
    }
    writeSpoolEvent(dataDirectoryFrom(argv, io.env), event)
  } catch {
    // fail-open
  }
  return 0
}

function wantsStreamingJson(argv: readonly string[]): boolean {
  if (argv.includes('--stream')) {
    return true
  }
  const formatIndex = argv.findIndex(
    (item) => item === '--output-format' || item === '--output_format',
  )
  const format = formatIndex >= 0 ? argv[formatIndex + 1] : undefined
  return format === 'streaming-json' || format === 'json'
}

async function ingestStreamingJson(
  argv: readonly string[],
  io: HookIo,
): Promise<void> {
  let leftover = ''
  for await (const chunk of io.stdin) {
    leftover += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    const lines = leftover.split(/\r?\n/)
    leftover = lines.pop() ?? ''
    for (const line of lines) {
      ingestStreamLine(line, argv, io.env)
    }
  }
  if (leftover.trim().length > 0) {
    ingestStreamLine(leftover, argv, io.env)
  }
}

function ingestStreamLine(
  line: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): void {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return
  }
  try {
    assertEventSizeLimit(trimmed)
    const json = JSON.parse(trimmed) as unknown
    const event = normalizeGrokEvent(json)
    if (!event) {
      return
    }
    writeSpoolEvent(dataDirectoryFrom(argv, env), event)
  } catch {
    // fail-open: drop the line
  }
}

function dataDirectoryFrom(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string {
  for (let index = 0; index < argv.length; index += 1) {
    if (
      (argv[index] === '--root' || argv[index] === '--data-dir') &&
      argv[index + 1]
    ) {
      return argv[index + 1]!
    }
  }
  return env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')
}

async function readStdinBounded(stdin: Readable): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.length
    if (total > OBSERVER_MAX_EVENT_BYTES) {
      assertEventSizeLimit(
        buffer.length > OBSERVER_MAX_EVENT_BYTES
          ? buffer
          : Buffer.concat([...chunks, buffer]),
      )
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
