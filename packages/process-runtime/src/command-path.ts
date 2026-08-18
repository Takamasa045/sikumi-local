import { delimiter, join } from 'node:path'
import { assertSafeExecutable } from './path-guard.js'

export function resolveCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return tryExecutable(trimmed)
  }

  const pathValue = env.PATH ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) {
      continue
    }
    const resolved = tryExecutable(join(directory, trimmed))
    if (resolved) {
      return resolved
    }
  }
  return undefined
}

function tryExecutable(candidate: string): string | undefined {
  try {
    return assertSafeExecutable(candidate)
  } catch {
    return undefined
  }
}
