import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { redactSensitiveText, textContainsSecrets } from '@sikumi-local/core'

export const OBSERVER_VERSION_PROBE_TIMEOUT_MS = 3_000
export const OBSERVER_VERSION_PROBE_MAX_BYTES = 2_048

export interface VersionRange {
  readonly min: string
  readonly max: string
  readonly label: string
}

export type ObservedVersionClass = 'supported' | 'needs_update' | 'unknown'

export interface CommandVersionProbe {
  readonly version: string | null
  readonly commandPath: string | null
}

export function parseSemver(value: string): string | null {
  const match = value.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)
  return match?.[1] ?? null
}

export function compareSemver(left: string, right: string): number {
  const leftParts = semverParts(left)
  const rightParts = semverParts(right)
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (delta !== 0) {
      return delta < 0 ? -1 : 1
    }
  }
  return 0
}

export function classifyObservedVersion(
  version: string | null,
  range: VersionRange,
): ObservedVersionClass {
  if (!version) {
    return 'unknown'
  }
  const parsed = parseSemver(version)
  if (!parsed) {
    return 'needs_update'
  }
  if (
    compareSemver(parsed, range.min) < 0 ||
    compareSemver(parsed, range.max) > 0
  ) {
    return 'needs_update'
  }
  return 'supported'
}

export function resolveCommandOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const trimmed = name.trim()
  if (
    trimmed.length === 0 ||
    trimmed.includes('\0') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    isAbsolute(trimmed)
  ) {
    return null
  }
  const pathValue = env.PATH ?? env.Path ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || directory.includes('\0')) {
      continue
    }
    const candidate = join(directory, trimmed)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export async function probeCommandVersion(input: {
  readonly names: readonly string[]
  readonly args?: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}): Promise<CommandVersionProbe> {
  const env = input.env ?? process.env
  const args = input.args ?? ['--version']
  const timeoutMs = input.timeoutMs ?? OBSERVER_VERSION_PROBE_TIMEOUT_MS
  const maxOutputBytes = input.maxOutputBytes ?? OBSERVER_VERSION_PROBE_MAX_BYTES
  for (const name of input.names) {
    const commandPath = resolveCommandOnPath(name, env)
    if (!commandPath || !isAbsolute(commandPath)) {
      continue
    }
    const version = await readVersionFromCommand({
      commandPath,
      args,
      env,
      timeoutMs,
      maxOutputBytes,
    })
    if (version) {
      return { version, commandPath }
    }
  }
  return { version: null, commandPath: null }
}

async function readVersionFromCommand(input: {
  readonly commandPath: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}): Promise<string | null> {
  return await new Promise((resolve) => {
    let child
    try {
      child = spawn(input.commandPath, [...input.args], {
        cwd: '/',
        env: sanitizedProbeEnv(input.env),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      resolve(null)
      return
    }

    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        // fail-open
      }
      finish(null)
    }, input.timeoutMs)
    timer.unref()

    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      total += buffer.length
      if (total > input.maxOutputBytes) {
        try {
          child.kill('SIGTERM')
        } catch {
          // fail-open
        }
        finish(parseSafeVersion(Buffer.concat(chunks).toString('utf8')))
        return
      }
      chunks.push(buffer)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      finish(parseSafeVersion(Buffer.concat(chunks).toString('utf8')))
    })
  })
}

function sanitizedProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  const pathValue = [env.PATH ?? env.Path, process.env.PATH ?? process.env.Path]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(delimiter)
  if (pathValue.length > 0) {
    next.PATH = pathValue
  }
  for (const key of ['HOME', 'TMPDIR', 'TEMP', 'TMP']) {
    const value = env[key] ?? process.env[key]
    if (typeof value === 'string' && value.length > 0) {
      next[key] = value
    }
  }
  return next
}

function parseSafeVersion(raw: string): string | null {
  const redacted = redactSensitiveText(raw).slice(0, OBSERVER_VERSION_PROBE_MAX_BYTES)
  if (textContainsSecrets(redacted)) {
    return null
  }
  return parseSemver(redacted)
}

function semverParts(value: string): readonly number[] {
  const parsed = parseSemver(value) ?? value
  return parsed.split('-')[0]?.split('.').map((part) => Number.parseInt(part, 10) || 0) ?? [0, 0, 0]
}
