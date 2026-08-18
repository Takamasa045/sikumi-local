import { spawn } from 'node:child_process'
import { AppError, isAppError } from '@sikumi-local/core'
import { filterProcessEnvironment } from './environment.js'
import {
  assertSafeArgs,
  assertSafeCwd,
  assertSafeExecutable,
} from './path-guard.js'

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

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let finished = false
    const pid = child.pid

    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (finished) {
        return
      }
      finished = true
      clearTimeout(timer)
      resolve({
        code,
        signal,
        stdout: stdout.slice(0, maxOutputBytes),
        stderr: stderr.slice(0, maxOutputBytes),
        timedOut,
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < maxOutputBytes) {
        stdout += chunk.toString('utf8')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < maxOutputBytes) {
        stderr += chunk.toString('utf8')
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
    }, timeoutMs)
    timer.unref()
  })
}
