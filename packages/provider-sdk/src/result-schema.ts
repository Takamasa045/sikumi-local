export interface JsonSchemaValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

export function extractJsonObject(
  text: string,
): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return null
  }

  const direct = parseObject(trimmed)
  if (direct) {
    return direct
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const fromFence = parseObject(fenced[1].trim())
    if (fromFence) {
      return fromFence
    }
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return parseObject(trimmed.slice(start, end + 1))
  }
  return null
}

export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
): JsonSchemaValidation {
  const errors: string[] = []
  validate(value, schema, '#', errors)
  return { ok: errors.length === 0, errors }
}

function validate(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const expectedType = schema.type
  if (typeof expectedType === 'string' && !matchesType(value, expectedType)) {
    errors.push(`${path} should be ${expectedType}`)
    return
  }

  if (expectedType === 'object' || isPlainObject(schema.properties)) {
    if (!isPlainObject(value)) {
      errors.push(`${path} should be object`)
      return
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (item): item is string => typeof item === 'string',
        )
      : []
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`)
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key} is not allowed`)
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isPlainObject(childSchema)) {
        validate(value[key], childSchema, `${path}.${key}`, errors)
      }
    }
    return
  }

  if (
    expectedType === 'array' &&
    Array.isArray(value) &&
    isPlainObject(schema.items)
  ) {
    value.forEach((item, index) => {
      validate(
        item,
        schema.items as Record<string, unknown>,
        `${path}[${index}]`,
        errors,
      )
    })
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return true
  }
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
