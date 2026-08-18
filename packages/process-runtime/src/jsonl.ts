import { sanitizeEventPayload } from '@sikumi-local/core'

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

  return { value: sanitizeEventPayload(parsed) }
}

export function createLineBuffer(onLine: (line: string) => void) {
  let buffer = ''

  return {
    push(chunk: Buffer | string) {
      buffer += String(chunk)
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.length > 0) {
          onLine(line)
        }
        newline = buffer.indexOf('\n')
      }
    },
    flush() {
      if (buffer.length === 0) {
        return
      }
      const line = buffer.replace(/\r$/, '')
      buffer = ''
      if (line.length > 0) {
        onLine(line)
      }
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
