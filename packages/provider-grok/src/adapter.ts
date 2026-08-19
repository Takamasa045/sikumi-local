import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { AppError, isAppError } from '@sikumi-local/core'
import {
  AsyncQueue,
  createJsonRpcClient,
  resolveCommandOnPath,
  runCapturedProcess,
  spawnManagedProcess,
  type JsonRpcClient,
  type JsonRpcId,
  type ManagedProcess,
} from '@sikumi-local/process-runtime'
import type {
  AgentProviderAdapter,
  CanonicalEvent,
  ProviderCapabilities,
  ProviderProbeResult,
  ProviderRunHandle,
  ProviderRunSpecification,
  ProviderTransport,
} from '@sikumi-local/provider-sdk'
import {
  createProviderRunHandle,
  extractJsonObject,
  validateJsonSchema,
} from '@sikumi-local/provider-sdk'
import {
  isDuplicateNonTerminalProgress,
  mapGrokSessionUpdate,
  permissionOptionId,
} from './map-event.js'
import { selectSchemaMatchingJsonObject } from './result-json.js'
import {
  assertSupportedGrokProtocol,
  assertWorkspaceGrokProtocol,
  type GrokProtocolVariant,
} from './protocol.js'
import {
  assertGrokArgsSafe,
  grokCommonArgs,
  mapGrokSandbox,
} from './sandbox.js'

const ACP_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  structuredOutput: false,
  sessionResume: true,
  interruption: true,
  liveApprovals: true,
  liveQuestions: false,
  readOnlySandbox: true,
  workspaceWriteSandbox: true,
  networkControl: true,
  nativeWorktree: true,
  modelListing: true,
  usageReporting: false,
  costReporting: false,
}

const STREAM_CAPABILITIES: ProviderCapabilities = {
  ...ACP_CAPABILITIES,
  liveApprovals: false,
  nativeWorktree: true,
}

const DISCONNECTED: ProviderCapabilities = {
  streaming: false,
  structuredOutput: false,
  sessionResume: false,
  interruption: false,
  liveApprovals: false,
  liveQuestions: false,
  readOnlySandbox: false,
  workspaceWriteSandbox: false,
  networkControl: false,
  nativeWorktree: false,
  modelListing: false,
  usageReporting: false,
  costReporting: false,
}

const MAX_SCHEMA_REPAIRS = 2
export const DEFAULT_GROK_RUN_TIMEOUT_MS = 15 * 60 * 1000

export function resolveGrokRunTimeoutMs(maxDurationMs?: number): number {
  if (
    typeof maxDurationMs === 'number' &&
    Number.isFinite(maxDurationMs) &&
    maxDurationMs > 0
  ) {
    return maxDurationMs
  }
  return DEFAULT_GROK_RUN_TIMEOUT_MS
}

export interface GrokProviderOptions {
  readonly commandName?: string
  readonly executable?: string
  readonly argsPrefix?: readonly string[]
  readonly spawn?: typeof spawnManagedProcess
  readonly capture?: typeof runCapturedProcess
  readonly resolveCommand?: typeof resolveCommandOnPath
  readonly now?: () => string
  readonly probeCwd?: string
  readonly parentEnv?: NodeJS.ProcessEnv
}

interface ActiveRun {
  readonly specification: ProviderRunSpecification
  readonly process: ManagedProcess
  readonly events: AsyncQueue<CanonicalEvent>
  readonly approvalBindings: Map<string, { id: JsonRpcId; options: unknown }>
  rpc?: JsonRpcClient
  sessionId?: string
  rawText: string
  finished: boolean
  lastEmitted?: CanonicalEvent
}

export function createGrokProvider(
  options: GrokProviderOptions = {},
): AgentProviderAdapter {
  const commandName = options.commandName ?? 'grok'
  const spawn = options.spawn ?? spawnManagedProcess
  const capture = options.capture ?? runCapturedProcess
  const resolveCommand = options.resolveCommand ?? resolveCommandOnPath
  const now = options.now ?? (() => new Date().toISOString())
  const parentEnv = options.parentEnv ?? process.env
  const runs = new Map<string, ActiveRun>()
  let cachedProbe: ProviderProbeResult | undefined

  const adapter: AgentProviderAdapter = {
    id: 'grok-build',
    displayName: 'Grok Build',
    advertisedAsRealProvider: true,

    async probe() {
      cachedProbe = await probeGrok()
      return cachedProbe
    },

    async getAuthStatus() {
      const probe = cachedProbe ?? (await this.probe())
      return {
        authenticated: probe.authenticated,
        description: probe.authDescription ?? 'Grok login status is unknown',
      }
    },

    async listModels() {
      return []
    },

    async getCapabilities() {
      const probe = cachedProbe ?? (await this.probe())
      return probe.supportedFeatures
    },

    async startRun(specification) {
      return beginRun(specification, false)
    },

    async resumeRun(specification) {
      return beginRun(specification, true)
    },

    async respondToApproval(requestId, decision) {
      const active = [...runs.values()].find((run) =>
        run.approvalBindings.has(requestId),
      )
      const binding = active?.approvalBindings.get(requestId)
      if (!active || !binding || !active.rpc) {
        throw new AppError('NOT_FOUND', 'No active Grok approval', 404)
      }
      const optionId = permissionOptionId(binding.options, decision)
      if (!optionId) {
        throw new AppError(
          'VALIDATION_FAILED',
          '対応する確認選択肢がありません',
          409,
        )
      }
      active.rpc.respond(binding.id, {
        outcome: { outcome: 'selected', optionId },
      })
      active.approvalBindings.delete(requestId)
    },

    async respondToQuestion() {
      throw new AppError(
        'VALIDATION_FAILED',
        'Grok adapter does not ask live questions',
        400,
      )
    },

    async cancelRun(runId) {
      const active = runs.get(runId)
      if (!active) {
        return
      }
      try {
        if (active.rpc && active.sessionId) {
          await active.rpc.request('session/cancel', {
            sessionId: active.sessionId,
          })
        }
      } catch {
        // Process cancel is the guaranteed fallback.
      }
      await active.process.cancel()
      finishRun(active, {
        type: 'run.cancelled',
        runId,
        occurredAt: now(),
        summary: '仕事を中止しました',
      })
    },

    async dispose() {
      await Promise.all(
        [...runs.values()].map((run) =>
          adapter.cancelRun(run.specification.runId),
        ),
      )
    },
  }

  return adapter

  async function beginRun(
    specification: ProviderRunSpecification,
    resume: boolean,
  ): Promise<ProviderRunHandle> {
    assertWorkspaceGrokProtocol(specification.cwd)
    const mapping = mapGrokSandbox(specification.permissionProfile)
    const probe = cachedProbe ?? (await adapter.probe())
    if (!probe.installed || !probe.commandPath) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'Grok Buildがインストールされていません',
        409,
      )
    }
    if (probe.transport === 'acp') {
      return startAcpRun(specification, probe.commandPath, mapping, resume)
    }
    if (probe.transport === 'streaming-json') {
      return startStreamingRun(
        specification,
        probe.commandPath,
        mapping,
        resume,
      )
    }
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'Grok ACP も streaming-json も使えません',
      409,
    )
  }

  async function startAcpRun(
    specification: ProviderRunSpecification,
    executable: string,
    mapping: ReturnType<typeof mapGrokSandbox>,
    resume: boolean,
  ): Promise<ProviderRunHandle> {
    const args = [
      ...prefixArgs(),
      ...grokCommonArgs(mapping, specification.cwd),
      'agent',
      'stdio',
    ]
    assertGrokArgsSafe(args)
    const runTimeoutMs = resolveGrokRunTimeoutMs(specification.maxDurationMs)
    const child = spawn({
      executable,
      args,
      cwd: specification.cwd,
      env: specification.environment,
      allowedCwdRoots: specification.allowedCwdRoots,
      parentEnv,
      timeoutMs: runTimeoutMs,
    })
    const rpc = createJsonRpcClient(child)
    const events = new AsyncQueue<CanonicalEvent>()
    const active: ActiveRun = {
      specification,
      process: child,
      events,
      approvalBindings: new Map(),
      rpc,
      rawText: '',
      finished: false,
    }
    runs.set(specification.runId, active)

    rpc.onNotification((message) => {
      if (message.method !== 'session/update') {
        return
      }
      emitMapped(
        active,
        mapGrokSessionUpdate(specification.runId, message.params, now()),
      )
      const text = extractChunkText(message.params)
      if (text) {
        active.rawText += text
      }
    })

    rpc.onRequest((message) => {
      if (message.method !== 'session/request_permission') {
        rpc.respondError(message.id, 'Unsupported server request')
        return
      }
      const params = asObject(message.params)
      const requestId =
        (typeof params.toolCallId === 'string' && params.toolCallId) ||
        String(message.id)
      active.approvalBindings.set(requestId, {
        id: message.id,
        options: params.options,
      })
      events.push({
        type: 'approval.requested',
        runId: specification.runId,
        occurredAt: now(),
        summary: 'ツール実行の確認が必要です',
        requestId,
        risk: 'medium',
      })
    })

    try {
      let initializedRaw: unknown
      try {
        initializedRaw = await rpc.request('initialize', {
          protocolVersion: 1,
          clientInfo: { name: 'shikumi-local', version: '0.1.0' },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
          },
        })
      } catch {
        throw new AppError(
          'PROVIDER_CAPABILITY_MISMATCH',
          'Grok protocol handshake failed',
          409,
        )
      }
      const initialized = asObject(initializedRaw)
      assertSupportedGrokProtocol(initialized)
      const authMethods = Array.isArray(initialized.authMethods)
        ? initialized.authMethods
        : []
      if (authMethods.length > 0) {
        const first = asObject(authMethods[0])
        if (typeof first.id === 'string') {
          await rpc.request('authenticate', { methodId: first.id })
        }
      }
      const session = resume
        ? asObject(
            await rpc.request('session/load', {
              sessionId: specification.providerSessionId,
              cwd: specification.cwd,
              mcpServers: [],
            }),
          )
        : asObject(
            await rpc.request('session/new', {
              cwd: specification.cwd,
              mcpServers: [],
            }),
          )
      const sessionId =
        (typeof session.sessionId === 'string' && session.sessionId) ||
        specification.providerSessionId
      if (!sessionId) {
        throw new AppError(
          'PROCESS_SPAWN_REJECTED',
          'Grok session id was missing',
          500,
        )
      }
      active.sessionId = sessionId
      events.push({
        type: 'run.started',
        runId: specification.runId,
        occurredAt: now(),
        summary: '仕事を始めます',
      })
      void runPromptLoop(active, sessionId, specification.prompt)
    } catch (error) {
      await child.cancel()
      runs.delete(specification.runId)
      throw isAppError(error)
        ? error
        : new AppError(
            'PROCESS_SPAWN_REJECTED',
            'Grokを開始できませんでした',
            500,
          )
    }

    void waitForExit(active)
    return createHandle(active)
  }

  async function runPromptLoop(
    active: ActiveRun,
    sessionId: string,
    initialPrompt: string,
  ): Promise<void> {
    let prompt = initialPrompt
    let repairs = 0
    while (!active.finished) {
      active.rawText = ''
      try {
        const result = asObject(
          await active.rpc?.request(
            'session/prompt',
            {
              sessionId,
              prompt: [{ type: 'text', text: prompt }],
            },
            {
              timeoutMs: resolveGrokRunTimeoutMs(
                active.specification.maxDurationMs,
              ),
            },
          ),
        )
        const stopReason =
          typeof result.stopReason === 'string' ? result.stopReason : 'end_turn'
        if (stopReason === 'cancelled') {
          finishRun(active, {
            type: 'run.cancelled',
            runId: active.specification.runId,
            occurredAt: now(),
            summary: '仕事を中止しました',
          })
          return
        }
        const schema = active.specification.outputSchema
        if (!schema) {
          finishSuccessful(active, active.rawText)
          return
        }
        const parsed =
          selectSchemaMatchingJsonObject(active.rawText, schema) ??
          selectSchemaMatchingJsonObject(
            typeof result.result === 'string' ? result.result : '',
            schema,
          )
        if (parsed && validateJsonSchema(parsed, schema).ok) {
          finishSuccessful(active, JSON.stringify(parsed), parsed)
          return
        }
        if (repairs >= MAX_SCHEMA_REPAIRS) {
          finishInvalid(active)
          return
        }
        repairs += 1
        prompt =
          'これまでの結果を指定Schemaだけで出力してください。説明文は不要です。\n' +
          JSON.stringify(schema)
      } catch (error) {
        if (active.finished) {
          return
        }
        finishRun(active, {
          type: 'run.failed',
          runId: active.specification.runId,
          occurredAt: now(),
          summary: isAppError(error)
            ? error.message
            : '調査を完了できませんでした',
        })
        return
      }
    }
  }

  async function startStreamingRun(
    specification: ProviderRunSpecification,
    executable: string,
    mapping: ReturnType<typeof mapGrokSandbox>,
    resume: boolean,
  ): Promise<ProviderRunHandle> {
    const args = [
      ...prefixArgs(),
      ...grokCommonArgs(mapping, specification.cwd),
      '-p',
      specification.prompt,
      '--output-format',
      'streaming-json',
    ]
    if (resume && specification.providerSessionId) {
      args.push('--resume', specification.providerSessionId)
    }
    assertGrokArgsSafe(args)
    const child = spawn({
      executable,
      args,
      cwd: specification.cwd,
      env: specification.environment,
      allowedCwdRoots: specification.allowedCwdRoots,
      parentEnv,
      timeoutMs: resolveGrokRunTimeoutMs(specification.maxDurationMs),
    })
    const events = new AsyncQueue<CanonicalEvent>()
    const active: ActiveRun = {
      specification,
      process: child,
      events,
      approvalBindings: new Map(),
      rawText: '',
      finished: false,
    }
    runs.set(specification.runId, active)
    events.push({
      type: 'run.started',
      runId: specification.runId,
      occurredAt: now(),
      summary: '仕事を始めます',
    })
    void consumeStream(active)
    return createHandle(active)
  }

  async function consumeStream(active: ActiveRun): Promise<void> {
    try {
      for await (const raw of active.process.jsonl) {
        if (typeof raw.sessionId === 'string') {
          active.sessionId = raw.sessionId
        }
        emitMapped(
          active,
          mapGrokSessionUpdate(active.specification.runId, raw, now()),
        )
        const text = extractChunkText(raw)
        if (text) {
          active.rawText += text
        }
      }
      const exit = await active.process.wait()
      if (exit.outputOverflowed) {
        finishRun(active, {
          type: 'run.failed',
          runId: active.specification.runId,
          occurredAt: now(),
          summary: '出力が上限を超えたため仕事を停止しました',
        })
        return
      }
      if (active.finished) {
        return
      }
      if (exit.cancelled) {
        finishRun(active, {
          type: 'run.cancelled',
          runId: active.specification.runId,
          occurredAt: now(),
          summary: '仕事を中止しました',
        })
        return
      }
      if (exit.timedOut) {
        finishRun(active, {
          type: 'run.failed',
          runId: active.specification.runId,
          occurredAt: now(),
          summary: '制限時間を超えたため仕事を止めました',
        })
        return
      }
      if (exit.code !== 0 || exit.signal !== null) {
        finishRun(active, {
          type: 'run.failed',
          runId: active.specification.runId,
          occurredAt: now(),
          summary: '調査を完了できませんでした',
        })
        return
      }
      const schema = active.specification.outputSchema
      const parsed = schema
        ? selectSchemaMatchingJsonObject(active.rawText, schema)
        : extractJsonObject(active.rawText)
      if (schema && (!parsed || !validateJsonSchema(parsed, schema).ok)) {
        finishInvalid(active)
        return
      }
      finishSuccessful(active, active.rawText, parsed ?? undefined)
    } catch {
      finishRun(active, {
        type: 'run.failed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '調査を完了できませんでした',
      })
    }
  }

  function finishSuccessful(
    active: ActiveRun,
    raw: string,
    parsed?: Record<string, unknown>,
  ): void {
    const title =
      (parsed && typeof parsed.title === 'string' && parsed.title) || '調査メモ'
    active.events.push({
      type: 'artifact.created',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '調査結果を整理しています',
      artifactType: 'report',
      title,
      content: parsed ? JSON.stringify(parsed) : raw,
    })
    finishRun(active, {
      type: 'run.completed',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '調査が完了しました',
    })
  }

  function finishInvalid(active: ActiveRun): void {
    active.events.push({
      type: 'artifact.created',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '形式が正しくない結果を保存しました',
      artifactType: 'file',
      title: 'raw result',
      content: active.rawText,
    })
    finishRun(active, {
      type: 'run.completed',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '結果の形式が正しくありません',
      invalidResult: true,
    })
  }

  async function waitForExit(active: ActiveRun): Promise<void> {
    const exit = await active.process.wait()
    if (exit.outputOverflowed) {
      finishRun(active, {
        type: 'run.failed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '出力が上限を超えたため仕事を停止しました',
      })
      return
    }
    if (active.finished) {
      return
    }
    if (exit.cancelled) {
      finishRun(active, {
        type: 'run.cancelled',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '仕事を中止しました',
      })
      return
    }
    if (exit.timedOut) {
      finishRun(active, {
        type: 'run.failed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '制限時間を超えたため仕事を止めました',
      })
      return
    }
    finishRun(active, {
      type: 'run.failed',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '調査を完了できませんでした',
    })
  }

  function createHandle(active: ActiveRun): ProviderRunHandle {
    return createProviderRunHandle({
      runId: active.specification.runId,
      providerId: 'grok-build',
      getSessionId: () => active.sessionId,
      events: () => active.events,
      cancel: () => adapter.cancelRun(active.specification.runId),
    })
  }

  function emitMapped(active: ActiveRun, mapped: CanonicalEvent | null): void {
    if (!mapped) {
      return
    }
    if (isDuplicateNonTerminalProgress(active.lastEmitted, mapped)) {
      return
    }
    active.lastEmitted = mapped
    active.events.push(mapped)
  }

  function finishRun(active: ActiveRun, terminal: CanonicalEvent): void {
    if (active.finished) {
      return
    }
    active.finished = true
    active.rpc?.cancelPending()
    active.events.push(terminal)
    active.events.close()
    runs.delete(active.specification.runId)
  }

  function prefixArgs(): string[] {
    return options.argsPrefix ? [...options.argsPrefix] : []
  }

  async function probeGrok(): Promise<ProviderProbeResult> {
    const executable =
      options.executable ?? resolveCommand(commandName, parentEnv)
    const probeCwd = options.probeCwd ?? tmpdir()
    if (!executable) {
      return {
        installed: false,
        authenticated: false,
        transport: 'disconnected',
        supportedFeatures: DISCONNECTED,
        warnings: [],
        errors: ['grok コマンドが見つかりません'],
      }
    }

    const [version, agentHelp, topHelp, models] = await Promise.all([
      captureText(executable, [...prefixArgs(), 'version', '--json'], probeCwd),
      captureText(
        executable,
        [...prefixArgs(), '--no-auto-update', 'agent', 'stdio', '--help'],
        probeCwd,
      ),
      captureText(executable, [...prefixArgs(), '--help'], probeCwd),
      captureText(executable, [...prefixArgs(), 'models'], probeCwd, {
        timeoutMs: 6_000,
        maxOutputBytes: 64_000,
      }),
    ])
    const hasAcp = agentHelp.code === 0 && /stdio/i.test(agentHelp.stdout)
    const hasStream =
      topHelp.code === 0 && /streaming-json/.test(topHelp.stdout)
    const transport: ProviderTransport = hasAcp
      ? 'acp'
      : hasStream
        ? 'streaming-json'
        : 'disconnected'
    const warnings: string[] = []
    if (!hasAcp && hasStream) {
      warnings.push(
        'Grok ACP が使えないため streaming-json にfallbackします。ライブ承認はできません。',
      )
    }
    warnings.push(
      'Grok native worktree はCapabilitiesに記録しますが、Jobでは使いません。',
    )

    return {
      installed: true,
      commandPath: executable,
      ...(firstLine(version.stdout)
        ? { version: firstLine(version.stdout) }
        : {}),
      authenticated: models.code === 0 && !models.timedOut,
      authDescription: 'Grok login is not copied into Shikumi Local',
      transport,
      supportedFeatures: hasAcp
        ? ACP_CAPABILITIES
        : hasStream
          ? STREAM_CAPABILITIES
          : DISCONNECTED,
      warnings,
      errors: [],
    }
  }

  async function captureText(
    executable: string,
    args: string[],
    cwd: string,
    limits?: {
      readonly timeoutMs?: number
      readonly maxOutputBytes?: number
    },
  ): Promise<{
    code: number | null
    stdout: string
    stderr: string
    timedOut: boolean
  }> {
    try {
      const result = await capture({
        executable,
        args,
        cwd,
        allowedCwdRoots: [cwd],
        parentEnv,
        timeoutMs: limits?.timeoutMs ?? 6_000,
        ...(limits?.maxOutputBytes === undefined
          ? {}
          : { maxOutputBytes: limits.maxOutputBytes }),
      })
      return {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      }
    } catch {
      return { code: 1, stdout: '', stderr: '', timedOut: false }
    }
  }
}

export function resolveFakeGrokPath(
  variant: GrokProtocolVariant = 'supported',
): string {
  const fileName =
    variant === 'supported' ? 'fake-grok.mjs' : `fake-grok-${variant}.mjs`
  return join(dirname(fileURLToPath(import.meta.url)), '../fixtures', fileName)
}

function extractChunkText(params: unknown): string {
  const body = asObject(params)
  const update = asObject(body.update)
  const content = asObject(update.content ?? body.content)
  return typeof content.text === 'string' ? content.text : ''
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}
