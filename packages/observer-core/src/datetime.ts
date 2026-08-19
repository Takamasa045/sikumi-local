const RFC3339_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

export function normalizeObserverDateTime(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length < 20 || trimmed.length > 64) {
    return null
  }
  const match = RFC3339_DATETIME.exec(trimmed)
  if (!match) {
    return null
  }
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return null
  }
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) {
    return null
  }
  const iso = new Date(parsed).toISOString()
  if (Number.isNaN(Date.parse(iso))) {
    return null
  }
  return iso
}

export function isObserverDateTime(value: string): boolean {
  return normalizeObserverDateTime(value) !== null
}
