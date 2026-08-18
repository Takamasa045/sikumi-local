import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { AppError, isAppError } from '@sikumi-local/core'
import { filterProcessEnvironment } from './environment.js'
import { createLineBuffer, parseJsonlLine } from './jsonl.js'
import { toJsonlRecord } from './output-limit.js'
import {
  assertSafeArgs,
  assertSafeCwd,
  assertSafeExecutable,
} from './path-guard.js'
import { AsyncQueue } from './queue.js'

const DEFAULT_KILL_GRACE_MS = 1_000
export const DEFAULT_MAX_JSONL_QUEUE_ITEMS = 256

export interface SpawnProcessRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: Record<string, string>
  readonly timeoutMs?: number
  readonly maxJsonlLineBytes?: number
  readonly maxJsonlQueueItems?: number
  readonly allowedCwdRoots?: readonly string[]
  readonly parentEnv?: NodeJS.ProcessEnv
}

export interface AdoptProcessOptions {
  readonly maxJsonlLineBytes?: number
  readonly maxJsonlQueueItems?: number
}

export interface ProcessExitResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly outputOverflowed: boolean
}

export interface ManagedProcess {
  readonly pid: number
  readonly jsonl: AsyncIterable<Record<string, unknown>>
  writeStdin(line: string): void
  cancel(): Promise<void>
  wait(): Promise<ProcessExitResult>
}

export function spawnManagedProcess(
  request: SpawnProcessRequest,
): ManagedProcess {
  const executable = assertSafeExecutable(request.executable)
  const args = assertSafeArgs(request.args)
  const cwd = assertSafeCwd(request.cwd, request.allowedCwdRoots ?? [])
  const env = filterProcessEnvironment(
    request.parentEnv ?? process.env,
    request.env ?? {},
  )
  const maxJsonlQueueItems = resolveMaxJsonlQueueItems(
    request.maxJsonlQueueItems,
  )

  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(executable, [...args], {
      cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (error) {
    throw wrapSpawnError(error)
  }

  return adoptSpawnedProcess(child, request.timeoutMs, {
    ...(request.maxJsonlLineBytes === undefined
      ? {}
      : { maxJsonlLineBytes: request.maxJsonlLineBytes }),
    maxJsonlQueueItems,
  })
}

export function adoptSpawnedProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs?: number,
  options: AdoptProcessOptions = {},
): ManagedProcess {
  const maxJsonlQueueItems = resolveMaxJsonlQueueItems(
    options.maxJsonlQueueItems,
  )
  drainSpawnErrors(child)

  if (child.pid === undefined) {
    throw wrapSpawnError(new Error('Process failed to start'))
  }

  return new RuntimeProcess(child, child.pid, timeoutMs, {
    ...(options.maxJsonlLineBytes === undefined
      ? {}
      : { maxJsonlLineBytes: options.maxJsonlLineBytes }),
    maxJsonlQueueItems,
  })
}

function drainSpawnErrors(child: ChildProcessWithoutNullStreams): void {
  child.once('error', () => {
    // A missing pid or TOCTOU disappearance must never become unhandled.
  })
}

function wrapSpawnError(error: unknown): AppError {
  if (isAppError(error)) {
    return error
  }
  return new AppError('PROCESS_SPAWN_REJECTED', 'Process failed to start', 500)
}

function resolveMaxJsonlQueueItems(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_JSONL_QUEUE_ITEMS
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError(
      'PROCESS_SPAWN_REJECTED',
      'maxJsonlQueueItems must be a positive integer',
      400,
    )
  }
  return value
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

class RuntimeProcess implements ManagedProcess {
  readonly jsonl: AsyncIterable<Record<string, unknown>>
  private readonly events: AsyncQueue<Record<string, unknown>>
  private readonly exitPromise: Promise<ProcessExitResult>
  private timedOut = false
  private cancelled = false
  private finished = false
  private outputOverflowed = false
  private timeoutHandle: NodeJS.Timeout | undefined
  private killInFlight: Promise<void> | undefined

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    readonly pid: number,
    timeoutMs: number | undefined,
    options: {
      readonly maxJsonlLineBytes?: number
      readonly maxJsonlQueueItems: number
    },
  ) {
    this.events = new AsyncQueue<Record<string, unknown>>(
      options.maxJsonlQueueItems,
    )
    this.jsonl = this.events

    const stdout = createLineBuffer(
      (line) => {
        if (this.outputOverflowed) {
          return
        }
        const parsed = parseJsonlLine(line)
        if (!parsed) {
          return
        }
        if (!this.events.push(parsed.value)) {
          this.markOutputOverflowed()
        }
      },
      {
        ...(options.maxJsonlLineBytes === undefined
          ? {}
          : { maxLineBytes: options.maxJsonlLineBytes }),
        onOverflow: (diagnostic) => {
          if (this.outputOverflowed) {
            return
          }
          this.events.push(toJsonlRecord(diagnostic))
          this.markOutputOverflowed()
        },
      },
    )
    const stderr = createLineBuffer(() => {
      // stderr is observed only to drain the pipe. It is never persisted.
    })

    this.child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    this.child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })

    this.exitPromise = new Promise((resolve) => {
      this.child.once('error', () => {
        this.finish()
        resolve(this.exitResult(null, null))
      })
      this.child.once('exit', (code, signal) => {
        stdout.flush()
        stderr.flush()
        this.finish()
        resolve(this.exitResult(code, signal))
      })
    })

    if (timeoutMs !== undefined && timeoutMs > 0) {
      this.timeoutHandle = setTimeout(() => {
        this.timedOut = true
        void this.killProcessGroup()
      }, timeoutMs)
      this.timeoutHandle.unref()
    }
  }

  writeStdin(line: string): void {
    if (this.finished || this.child.stdin.destroyed) {
      throw new AppError(
        'PROCESS_SPAWN_REJECTED',
        'Process stdin is no longer writable',
        400,
      )
    }
    this.child.stdin.write(line.endsWith('\n') ? line : `${line}\n`)
  }

  async cancel(): Promise<void> {
    this.cancelled = true
    await this.killProcessGroup()
  }

  wait(): Promise<ProcessExitResult> {
    return this.exitPromise
  }

  private exitResult(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): ProcessExitResult {
    return {
      code,
      signal,
      timedOut: this.timedOut,
      cancelled: this.cancelled,
      outputOverflowed: this.outputOverflowed,
    }
  }

  private markOutputOverflowed(): void {
    if (this.outputOverflowed) {
      return
    }
    this.outputOverflowed = true
    void this.killProcessGroup()
  }

  private finish(): void {
    if (this.finished) {
      return
    }
    this.finished = true
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle)
    }
    this.events.close()
  }

  private killProcessGroup(): Promise<void> {
    if (this.killInFlight) {
      return this.killInFlight
    }

    this.killInFlight = (async () => {
      if (this.finished) {
        return
      }

      signalProcessGroup(this.pid, 'SIGTERM')
      await waitForExit(this.child, DEFAULT_KILL_GRACE_MS)
      // Always escalate the group. The leader may already have exited
      // while a descendant is still shutting down.
      signalProcessGroup(this.pid, 'SIGKILL')
      await waitForExit(this.child, DEFAULT_KILL_GRACE_MS)

      if (isProcessAlive(this.pid)) {
        try {
          this.child.kill('SIGKILL')
        } catch {
          // The process may have exited between the liveness check and kill.
        }
      }
    })()

    return this.killInFlight
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
    return
  } catch {
    // The group may already be gone, or the platform may not support groups.
  }

  try {
    process.kill(pid, signal)
  } catch {
    // The process already exited.
  }
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(child.exitCode !== null || child.signalCode !== null)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}
