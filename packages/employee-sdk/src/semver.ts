import { CORE_EMPLOYEE_COMPATIBILITY } from '@sikumi-local/core'

export function coreCompatibilitySatisfied(range: string): boolean {
  return satisfiesIntegerRange(range, CORE_EMPLOYEE_COMPATIBILITY)
}

export function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left)
  const rightParts = parseSemver(right)
  if (!leftParts || !rightParts) {
    return 0
  }
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (delta !== 0) {
      return delta
    }
  }
  return 0
}

function parseSemver(value: string): [number, number, number] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function satisfiesIntegerRange(range: string, actual: number): boolean {
  const trimmed = range.trim()
  if (trimmed.length === 0) {
    return false
  }

  const caret = trimmed.match(/^\^(\d+)(?:\.\d+)?(?:\.\d+)?$/)
  if (caret) {
    const major = Number(caret[1])
    return Number.isInteger(major) && actual >= major && actual < major + 1
  }

  const comparison = trimmed.match(
    /^(>=|<=|>|<|=)?\s*(\d+)(?:\.\d+)?(?:\.\d+)?$/,
  )
  if (!comparison) {
    return false
  }
  const operator = comparison[1] ?? '='
  const expected = Number(comparison[2])
  if (!Number.isInteger(expected)) {
    return false
  }
  switch (operator) {
    case '>':
      return actual > expected
    case '>=':
      return actual >= expected
    case '<':
      return actual < expected
    case '<=':
      return actual <= expected
    default:
      return actual === expected
  }
}
