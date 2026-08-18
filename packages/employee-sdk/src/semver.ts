import { CORE_EMPLOYEE_COMPATIBILITY } from '@sikumi-local/core'

export function coreCompatibilitySatisfied(range: string): boolean {
  return satisfiesIntegerRange(range, CORE_EMPLOYEE_COMPATIBILITY)
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
