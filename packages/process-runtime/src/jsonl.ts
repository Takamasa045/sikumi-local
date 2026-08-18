import { sanitizeEventPayload } from '@sikumi-local/core'
import {
  createOutputOverflowDiagnostic,
  type OutputOverflowDiagnostic,
} from './output-limit.js'
import { sliceUtf8Bytes, toUtf8Buffer, utf8SafeEnd } from './utf8.js'

export const DEFAULT_MAX_JSONL_LINE_BYTES = 1_048_576

export interface ParsedJsonlObject {
  readonly value: Record<string, unknown>
}

export function parseJsonlLine(line: string): ParsedJsonlObject | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (!isPlainObject(parsed)) {
    return null
  }

  try {
    return { value: sanitizeEventPayload(parsed) }
  } catch {
    return null
  }
}

export function createLineBuffer(
  onLine: (line: string) => void,
  options: {
    readonly maxLineBytes?: number
    readonly onOverflow?: (diagnostic: OutputOverflowDiagnostic) => void
  } = {},
) {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_JSONL_LINE_BYTES
  let buffer: Buffer = Buffer.alloc(0)
  let overflow = false

  const markOverflow = (): void => {
    if (!overflow) {
      options.onOverflow?.(
        createOutputOverflowDiagnostic({ maxBytes: maxLineBytes }),
      )
    }
    overflow = true
    buffer = Buffer.alloc(0)
  }

  const emit = (raw: Buffer): void => {
    if (overflow) {
      overflow = false
      return
    }
    if (raw.length === 0) {
      return
    }
    if (raw.length > maxLineBytes) {
      markOverflow()
      overflow = false
      return
    }
    const complete = raw.subarray(0, utf8SafeEnd(raw))
    if (complete.length === 0) {
      return
    }
    const line = complete.toString('utf8').replace(/\r$/, '')
    if (line.length === 0) {
      return
    }
    onLine(line)
  }

  const consumeCompleteLines = (): void => {
    let newline = buffer.indexOf(0x0a)
    while (newline !== -1) {
      const raw = buffer.subarray(0, newline)
      buffer = Buffer.from(buffer.subarray(newline + 1))
      emit(raw)
      overflow = false
      newline = buffer.indexOf(0x0a)
    }
    if (buffer.length > maxLineBytes) {
      markOverflow()
    }
  }

  return {
    push(chunk: Buffer | string) {
      const incoming = toUtf8Buffer(chunk)
      let offset = 0
      while (offset < incoming.length) {
        if (overflow) {
          const newline = incoming.indexOf(0x0a, offset)
          if (newline === -1) {
            return
          }
          offset = newline + 1
          overflow = false
          continue
        }
        const room = maxLineBytes + 1 - buffer.length
        const take = Math.min(room, incoming.length - offset)
        buffer = Buffer.from(
          Buffer.concat([buffer, incoming.subarray(offset, offset + take)]),
        )
        offset += take
        consumeCompleteLines()
      }
    },
    flush() {
      if (buffer.length === 0) {
        overflow = false
        return
      }
      const raw = sliceUtf8Bytes(buffer, maxLineBytes)
      buffer = Buffer.alloc(0)
      emit(raw)
      overflow = false
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
