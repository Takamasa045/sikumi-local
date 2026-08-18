import { spawn } from 'node:child_process'
import {
  AppError,
  isAppError,
  redactSensitiveText,
  sanitizeEventPayload,
} from '@sikumi-local/core'
import { filterProcessEnvironment } from './environment.js'
import {
  assertSafeArgs,
  assertSafeCwd,
  assertSafeExecutable,
} from './path-guard.js'
import { sliceUtf8Bytes, toUtf8Buffer } from './utf8.js'

const DEFAULT_CAPTURE_TIMEOUT_MS = 8_000
const DEFAULT_MAX_OUTPUT_BYTES = 256_000
const KILL_GRACE_MS = 1_000

export interface CapturedProcessRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: Record<string, string>
  readonly allowedCwdRoots?: readonly string[]
  readonly parentEnv?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
}

export interface CapturedProcessResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export function runCapturedProcess(
  request: CapturedProcessRequest,
): Promise<CapturedProcessResult> {
  const executable = assertSafeExecutable(request.executable)
  const args = assertSafeArgs(request.args)
  const cwd = assertSafeCwd(request.cwd, request.allowedCwdRoots ?? [])
  const env = filterProcessEnvironment(
    request.parentEnv ?? process.env,
    request.env ?? {},
  )
  const timeoutMs = request.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES

  let child
  try {
    child = spawn(executable, [...args], {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (error) {
    if (isAppError(error)) {
      throw error
    }
    throw new AppError('PROCESS_SPAWN_REJECTED', 'Process failed to start', 500)
  }

  return new Promise((resolve, reject) => {
    const stdout = createBoundedStream(maxOutputBytes)
    const stderr = createBoundedStream(maxOutputBytes)
    let timedOut = false
    let finished = false
    const pid = child.pid

    const killChild = (): void => {
      if (pid !== undefined) {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          try {
            child.kill('SIGTERM')
          } catch {
            // Already gone.
          }
        }
      }
      setTimeout(() => {
        if (pid !== undefined) {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            try {
              child.kill('SIGKILL')
            } catch {
              // Already gone.
            }
          }
        }
      }, KILL_GRACE_MS).unref()
    }

    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timer)
      if (stdout.overflowed || stderr.overflowed) {
        reject(
          new AppError(
            'OUTPUT_TOO_LARGE',
            'Process output exceeded the capture limit',
            413,
          ),
        )
        return
      }
      resolve({
        code,
        signal,
        stdout: sanitizeCapturedText(stdout.decode()),
        stderr: sanitizeCapturedText(stderr.decode()),
        timedOut,
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
      if (stdout.overflowed) {
        killChild()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      if (stderr.overflowed) {
        killChild()
      }
    })
    child.once('error', () => {
      finish(null, null)
    })
    child.once('exit', (code, signal) => {
      finish(code, signal)
    })

    const timer = setTimeout(() => {
      timedOut = true
      killChild()
    }, timeoutMs)
    timer.unref()
  })
}

function createBoundedStream(maxOutputBytes: number) {
  let buffer: Buffer = Buffer.alloc(0)
  let overflowed = false

  return {
    get overflowed() {
      return overflowed
    },
    push(chunk: Buffer | string) {
      if (overflowed) {
        return
      }
      const incoming = toUtf8Buffer(chunk)
      const room = maxOutputBytes - buffer.length
      if (room <= 0 || incoming.length > room) {
        buffer = Buffer.from(
          sliceUtf8Bytes(
            Buffer.concat([buffer, incoming.subarray(0, Math.max(room, 0))]),
            maxOutputBytes,
          ),
        )
        overflowed = true
        return
      }
      buffer = Buffer.from(Buffer.concat([buffer, incoming]))
    },
    decode() {
      return sliceUtf8Bytes(buffer, maxOutputBytes).toString('utf8')
    },
  }
}

function sanitizeCapturedText(value: string): string {
  const redacted = redactSensitiveText(value)
  try {
    const parsed = JSON.parse(redacted) as unknown
    if (isPlainObject(parsed)) {
      return JSON.stringify(sanitizeEventPayload(parsed))
    }
  } catch {
    // Raw process output is not always JSON.
  }
  return redacted
    .split('\n')
    .filter(
      (line) =>
        !/\breasoning\b/i.test(line) &&
        !/\bthinking\b/i.test(line) &&
        !/\bchain_of_thought\b/i.test(line),
    )
    .join('\n')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
