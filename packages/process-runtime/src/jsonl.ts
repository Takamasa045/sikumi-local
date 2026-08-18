import { sanitizeEventPayload } from '@sikumi-local/core'

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
  options: { readonly maxLineBytes?: number } = {},
) {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_JSONL_LINE_BYTES
  let buffer = ''
  let overflow = false

  return {
    push(chunk: Buffer | string) {
      buffer += String(chunk)
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const raw = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (!overflow && raw.length > 0 && raw.length <= maxLineBytes) {
          onLine(raw)
        }
        overflow = false
        newline = buffer.indexOf('\n')
      }
      if (buffer.length > maxLineBytes) {
        overflow = true
        buffer = ''
      }
    },
    flush() {
      if (buffer.length === 0) {
        overflow = false
        return
      }
      const line = buffer.replace(/\r$/, '')
      buffer = ''
      if (!overflow && line.length > 0 && line.length <= maxLineBytes) {
        onLine(line)
      }
      overflow = false
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
