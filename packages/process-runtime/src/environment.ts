import { AppError } from '@sikumi-local/core'

export const PROCESS_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'LANG',
  'LC_ALL',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'GROK_HOME',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'SHIKUMI_FIXTURE_PROTOCOL',
] as const

export type ProcessEnvAllowlistKey = (typeof PROCESS_ENV_ALLOWLIST)[number]

const ALLOWED_KEYS = new Set<string>(PROCESS_ENV_ALLOWLIST)

const API_KEY_KEYS = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
])

export function filterProcessEnvironment(
  source: NodeJS.ProcessEnv,
  extras: Record<string, string> = {},
): Record<string, string> {
  assertNoDisallowedExtras(extras)

  const env: Record<string, string> = {}
  for (const key of PROCESS_ENV_ALLOWLIST) {
    if (API_KEY_KEYS.has(key)) {
      const explicit = extras[key]
      if (explicit !== undefined && explicit.length > 0) {
        env[key] = explicit
      }
      continue
    }

    const value = extras[key] ?? source[key]
    if (value !== undefined && value.length > 0) {
      env[key] = value
    }
  }
  return env
}

export function environmentContainsSecretValue(
  env: Record<string, string>,
  secret: string,
): boolean {
  if (secret.length === 0) {
    return false
  }
  return Object.values(env).some((value) => value.includes(secret))
}

function assertNoDisallowedExtras(extras: Record<string, string>): void {
  for (const key of Object.keys(extras)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new AppError(
        'PROCESS_SPAWN_REJECTED',
        `Environment key ${key} is not allowlisted`,
        400,
      )
    }
  }
}
