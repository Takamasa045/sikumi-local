import { validateJsonSchema } from '@sikumi-local/provider-sdk'

export function extractJsonObjectCandidates(
  text: string,
): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = []
  let index = 0
  while (index < text.length) {
    if (text[index] !== '{') {
      index += 1
      continue
    }
    const scanned = scanJsonObject(text, index)
    if (!scanned) {
      index += 1
      continue
    }
    const parsed = parseObject(scanned.value)
    if (parsed) {
      candidates.push(parsed)
    }
    index = scanned.end
  }
  return candidates
}

export function selectSchemaMatchingJsonObject(
  text: string,
  schema: Record<string, unknown>,
): Record<string, unknown> | null {
  let match: Record<string, unknown> | null = null
  for (const candidate of extractJsonObjectCandidates(text)) {
    if (validateJsonSchema(candidate, schema).ok) {
      match = candidate
    }
  }
  return match
}

function scanJsonObject(
  text: string,
  start: number,
): { value: string; end: number } | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return { value: text.slice(start, index + 1), end: index + 1 }
      }
    }
  }
  return null
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
