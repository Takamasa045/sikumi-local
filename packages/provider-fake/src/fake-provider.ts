import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError, FAKE_PROVIDER_ID, isAppError } from '@sikumi-local/core'
import {
  resolveFakeCliPath,
  spawnManagedProcess,
  type ManagedProcess,
  type SpawnProcessRequest,
} from '@sikumi-local/process-runtime'
import type {
  AgentProviderAdapter,
  ApprovalDecision,
  CanonicalEvent,
  ProviderCapabilities,
  ProviderRunHandle,
  ProviderRunSpecification,
} from '@sikumi-local/provider-sdk'
import { isTerminalEventType } from '@sikumi-local/provider-sdk'
import { mapFakeProcessEvent } from './map-event.js'
import { scenarioFromPrompt, type FakeScenario } from './scenario.js'

export const FAKE_PROVIDER_DISPLAY_NAME = '開発用ハーネス'

export const FAKE_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  structuredOutput: false,
  sessionResume: false,
  interruption: true,
  liveApprovals: true,
  liveQuestions: false,
  readOnlySandbox: true,
  workspaceWriteSandbox: false,
  networkControl: false,
  nativeWorktree: false,
  modelListing: false,
  usageReporting: false,
  costReporting: false,
}

export interface FakeProviderOptions {
  readonly spawn?: typeof spawnManagedProcess
  readonly executable?: string
  readonly cliPath?: string
  readonly now?: () => string
}

interface ActiveRun {
  readonly specification: ProviderRunSpecification
  readonly process: ManagedProcess
  readonly handle: ProviderRunHandle
  readonly approvalRequestId: string
  readonly pidDirectory?: string
}

export function createFakeProvider(
  options: FakeProviderOptions = {},
): AgentProviderAdapter {
  const spawn = options.spawn ?? spawnManagedProcess
  const executable = options.executable ?? process.execPath
  const cliPath = options.cliPath ?? resolveFakeCliPath()
  const now = options.now ?? (() => new Date().toISOString())
  const runs = new Map<string, ActiveRun>()
  const approvalBindings = new Map<string, string>()

  const adapter: AgentProviderAdapter = {
    id: FAKE_PROVIDER_ID,
    displayName: FAKE_PROVIDER_DISPLAY_NAME,
    advertisedAsRealProvider: false,

    async probe() {
      return {
        installed: true,
        commandPath: cliPath,
        version: 'fake-0',
        authenticated: true,
        authDescription: 'Test/development harness only',
        supportedFeatures: FAKE_PROVIDER_CAPABILITIES,
        warnings: ['Development/test harness only. Not a production provider.'],
        errors: [],
      }
    },

    async getAuthStatus() {
      return {
        authenticated: true,
        description: 'Fake harness does not use real credentials',
      }
    },

    async listModels() {
      return []
    },

    async getCapabilities() {
      return FAKE_PROVIDER_CAPABILITIES
    },

    async startRun(specification) {
      const scenario = scenarioFromPrompt(specification.prompt)
      const approvalRequestId = `${specification.runId}:web-search`
      let pidDirectory: string | undefined
      if (scenario === 'spawn-child') {
        pidDirectory = mkdtempSync(join(tmpdir(), 'sikumi-fake-pid-'))
      }

      let child: ManagedProcess
      try {
        child = spawn(
          buildSpawnRequest(
            specification,
            scenario,
            approvalRequestId,
            pidDirectory,
          ),
        )
      } catch (error) {
        removeDirectory(pidDirectory)
        throw isAppError(error)
          ? error
          : new AppError(
              'PROCESS_SPAWN_REJECTED',
              'Process failed to start',
              500,
            )
      }

      const handle = createHandle(specification, child)
      runs.set(specification.runId, {
        specification,
        process: child,
        handle,
        approvalRequestId,
        ...(pidDirectory === undefined ? {} : { pidDirectory }),
      })
      approvalBindings.set(approvalRequestId, specification.runId)
      return handle
    },

    async resumeRun() {
      throw new AppError(
        'VALIDATION_FAILED',
        'Fake provider does not resume sessions',
        400,
      )
    },

    async respondToApproval(requestId, decision) {
      const runId = approvalBindings.get(requestId)
      const active = runId === undefined ? undefined : runs.get(runId)
      if (!active) {
        throw new AppError('NOT_FOUND', 'No active fake run', 404)
      }
      active.process.writeStdin(
        JSON.stringify({ requestId, decision } satisfies {
          requestId: string
          decision: ApprovalDecision
        }),
      )
    },

    async respondToQuestion() {
      throw new AppError(
        'VALIDATION_FAILED',
        'Fake provider does not ask questions',
        400,
      )
    },

    async cancelRun(runId) {
      const active = runs.get(runId)
      if (!active) {
        return
      }
      await active.process.cancel()
      releaseRun(runId)
    },

    async dispose() {
      const active = [...runs.values()]
      await Promise.all(active.map((run) => run.process.cancel()))
      for (const run of active) {
        releaseRun(run.specification.runId)
      }
    },
  }

  return adapter

  function buildSpawnRequest(
    specification: ProviderRunSpecification,
    scenario: FakeScenario,
    approvalRequestId: string,
    pidDirectory: string | undefined,
  ): SpawnProcessRequest {
    const args = [
      cliPath,
      '--scenario',
      scenario,
      '--run-id',
      specification.runId,
      '--approval-request-id',
      approvalRequestId,
    ]
    if (scenario === 'spawn-child' && pidDirectory) {
      args.push('--pid-file', join(pidDirectory, 'child.pid'))
    }

    const request: SpawnProcessRequest = {
      executable,
      args,
      cwd: specification.cwd,
      env: specification.environment,
      allowedCwdRoots: specification.allowedCwdRoots,
    }
    if (specification.maxDurationMs !== undefined) {
      return { ...request, timeoutMs: specification.maxDurationMs }
    }
    return request
  }

  function createHandle(
    specification: ProviderRunSpecification,
    child: ManagedProcess,
  ): ProviderRunHandle {
    return {
      runId: specification.runId,
      providerId: FAKE_PROVIDER_ID,
      events: () => mapEvents(specification.runId, child),
      cancel: () => child.cancel(),
    }
  }

  function releaseRun(runId: string): void {
    const active = runs.get(runId)
    if (!active) {
      return
    }
    approvalBindings.delete(active.approvalRequestId)
    removeDirectory(active.pidDirectory)
    runs.delete(runId)
  }

  async function* mapEvents(
    runId: string,
    child: ManagedProcess,
  ): AsyncIterable<CanonicalEvent> {
    let sawTerminal = false
    try {
      for await (const raw of child.jsonl) {
        const event = mapFakeProcessEvent(runId, raw, now())
        if (!event) {
          continue
        }
        if (isTerminalEventType(event.type)) {
          sawTerminal = true
        }
        yield event
      }

      const exit = await child.wait()
      if (sawTerminal) {
        return
      }
      if (exit.cancelled) {
        yield {
          type: 'run.cancelled',
          runId,
          occurredAt: now(),
          summary: '仕事を中止しました',
        }
        return
      }
      if (exit.timedOut) {
        yield {
          type: 'run.failed',
          runId,
          occurredAt: now(),
          summary: '制限時間を超えたため仕事を止めました',
        }
        return
      }
      yield {
        type: 'run.failed',
        runId,
        occurredAt: now(),
        summary: '調査を完了できませんでした',
      }
    } finally {
      releaseRun(runId)
    }
  }
}

function removeDirectory(directory: string | undefined): void {
  if (!directory) {
    return
  }
  rmSync(directory, { recursive: true, force: true })
}
