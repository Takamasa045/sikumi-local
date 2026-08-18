export const RESET_CONFIRM_TOKEN = 'RESET'
export const IMPORT_CONFIRM_TOKEN = 'IMPORT'

export interface FlagBag {
  readonly flags: ReadonlyMap<string, string | true>
  readonly positionals: readonly string[]
}

export function parseFlags(argv: readonly string[]): FlagBag {
  const flags = new Map<string, string | true>()
  const positionals: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token) {
      continue
    }
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const trimmed = token.slice(2)
    const equals = trimmed.indexOf('=')
    if (equals >= 0) {
      flags.set(trimmed.slice(0, equals), trimmed.slice(equals + 1))
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(trimmed, next)
      index += 1
      continue
    }
    flags.set(trimmed, true)
  }
  return { flags, positionals }
}

export function readFlag(
  flags: ReadonlyMap<string, string | true>,
  name: string,
): string | undefined {
  const value = flags.get(name)
  return typeof value === 'string' ? value : undefined
}

export function hasFlag(
  flags: ReadonlyMap<string, string | true>,
  name: string,
): boolean {
  return flags.has(name)
}

export function confirmMatches(
  provided: string | undefined,
  expected: string,
): boolean {
  return provided === expected
}
