import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  validateJsonSchema,
} from '@sikumi-local/provider-sdk'
import { classifyCommandRisk, mapCodexSandbox } from './sandbox.js'
import {
  agentMessageText,
  mapCodexExecEvent,
  mapCodexNotification,
  structuredFromAgentMessage,
} from './map-event.js'
import {
  assertSupportedCodexProtocol,
  assertWorkspaceCodexProtocol,
  type CodexProtocolVariant,
} from './protocol.js'
import {
  buildCodexApprovalResult,
  isCodexPermissionsMethod,
  isSupportedCodexServerRequest,
} from './server-request.js'

const APP_SERVER_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  structuredOutput: true,
  sessionResume: true,
  interruption: true,
  liveApprovals: true,
  liveQuestions: false,
  readOnlySandbox: true,
  workspaceWriteSandbox: true,
  networkControl: true,
  nativeWorktree: false,
  modelListing: false,
  usageReporting: true,
  costReporting: false,
}

const EXEC_CAPABILITIES: ProviderCapabilities = {
  ...APP_SERVER_CAPABILITIES,
  liveApprovals: false,
  usageReporting: false,
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

export const DEFAULT_CODEX_RUN_TIMEOUT_MS = 15 * 60 * 1000

export function resolveCodexRunTimeoutMs(maxDurationMs?: number): number {
  if (
    typeof maxDurationMs === 'number' &&
    Number.isFinite(maxDurationMs) &&
    maxDurationMs > 0
  ) {
    return maxDurationMs
  }
  return DEFAULT_CODEX_RUN_TIMEOUT_MS
}

export interface CodexProviderOptions {
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
  readonly approvalBindings: Map<
    string,
    { id: JsonRpcId; method: string; permissions?: unknown }
  >
  rpc?: JsonRpcClient
  threadId?: string
  turnId?: string
  lastAgentText?: string
  schemaDirectory?: string
  finished: boolean
}

export function createCodexProvider(
  options: CodexProviderOptions = {},
): AgentProviderAdapter {
  const commandName = options.commandName ?? 'codex'
  const spawn = options.spawn ?? spawnManagedProcess
  const capture = options.capture ?? runCapturedProcess
  const resolveCommand = options.resolveCommand ?? resolveCommandOnPath
  const now = options.now ?? (() => new Date().toISOString())
  const parentEnv = options.parentEnv ?? process.env
  const runs = new Map<string, ActiveRun>()
  let cachedProbe: ProviderProbeResult | undefined

  const adapter: AgentProviderAdapter = {
    id: 'codex',
    displayName: 'Codex',
    advertisedAsRealProvider: true,

    async probe() {
      cachedProbe = await probeCodex()
      return cachedProbe
    },

    async getAuthStatus() {
      const probe = cachedProbe ?? (await this.probe())
      return {
        authenticated: probe.authenticated,
        description: probe.authDescription ?? 'Codex login status is unknown',
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
        throw new AppError('NOT_FOUND', 'No active Codex approval', 404)
      }
      active.rpc.respond(
        binding.id,
        buildCodexApprovalResult(binding.method, decision, binding.permissions),
      )
      active.approvalBindings.delete(requestId)
    },

    async respondToQuestion() {
      throw new AppError(
        'VALIDATION_FAILED',
        'Codex adapter does not ask live questions',
        400,
      )
    },

    async cancelRun(runId) {
      const active = runs.get(runId)
      if (!active) {
        return
      }
      try {
        if (active.rpc && active.threadId && active.turnId) {
          await active.rpc.request('turn/interrupt', {
            threadId: active.threadId,
            turnId: active.turnId,
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
    assertWorkspaceCodexProtocol(specification.cwd)
    const sandbox = mapCodexSandbox(specification.permissionProfile)
    const probe = cachedProbe ?? (await adapter.probe())
    if (!probe.installed || !probe.commandPath) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'Codexがインストールされていません',
        409,
      )
    }

    if (probe.transport === 'app-server') {
      return startAppServerRun(
        specification,
        probe.commandPath,
        sandbox,
        resume,
      )
    }
    if (probe.transport === 'exec-json') {
      return startExecRun(specification, probe.commandPath, sandbox, resume)
    }
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'Codex app-server も exec --json も使えません',
      409,
    )
  }

  async function startAppServerRun(
    specification: ProviderRunSpecification,
    executable: string,
    sandbox: ReturnType<typeof mapCodexSandbox>,
    resume: boolean,
  ): Promise<ProviderRunHandle> {
    const runTimeoutMs = resolveCodexRunTimeoutMs(specification.maxDurationMs)
    const child = spawn({
      executable,
      args: [...prefixArgs(), 'app-server', '--stdio'],
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
      finished: false,
    }
    runs.set(specification.runId, active)

    rpc.onNotification((message) => {
      if (message.method === 'turn/started') {
        const params = asObject(message.params)
        const turn = asObject(params.turn)
        if (typeof turn.id === 'string') {
          active.turnId = turn.id
        } else if (typeof params.turnId === 'string') {
          active.turnId = params.turnId
        }
      }
      if (message.method === 'item/completed') {
        const item = asObject(asObject(message.params).item)
        if (item.type === 'agentMessage') {
          active.lastAgentText = agentMessageText(item)
        }
      }
      const mapped = mapCodexNotification(
        specification.runId,
        message.method,
        message.params,
        now(),
      )
      if (mapped) {
        if (
          mapped.type === 'run.completed' ||
          mapped.type === 'run.failed' ||
          mapped.type === 'run.cancelled'
        ) {
          finishRun(
            active,
            mapped.type === 'run.completed'
              ? withSchemaResult(active, mapped)
              : mapped,
          )
          return
        }
        events.push(mapped)
      }
    })

    rpc.onRequest((message) => {
      handleCodexServerRequest(active, message)
    })

    try {
      let initialized: unknown
      try {
        initialized = await rpc.request('initialize', {
          clientInfo: { name: 'shikumi-local', version: '0.1.0' },
        })
      } catch {
        throw new AppError(
          'PROVIDER_CAPABILITY_MISMATCH',
          'Codex protocol response is malformed',
          409,
        )
      }
      assertSupportedCodexProtocol(initialized)
      rpc.notify('initialized')
      await rpc.request('account/read', {})
      const thread = resume
        ? asObject(
            await rpc.request('thread/resume', {
              threadId: specification.providerSessionId,
            }),
          )
        : asObject(
            await rpc.request('thread/start', {
              cwd: specification.cwd,
              sandbox: sandbox.threadSandbox,
              approvalPolicy: 'on-request',
              ...(specification.model ? { model: specification.model } : {}),
            }),
          )
      const threadObject = asObject(thread.thread)
      const startedThreadId =
        (typeof threadObject.id === 'string' && threadObject.id) ||
        (typeof thread.threadId === 'string' && thread.threadId) ||
        specification.providerSessionId
      if (!startedThreadId) {
        throw new AppError(
          'PROCESS_SPAWN_REJECTED',
          'Codex thread id was missing',
          500,
        )
      }
      active.threadId = startedThreadId
      const turn = asObject(
        await rpc.request(
          'turn/start',
          {
            threadId: startedThreadId,
            input: [{ type: 'text', text: specification.prompt }],
            sandboxPolicy: sandbox.sandboxPolicy,
            approvalPolicy: 'on-request',
            ...(specification.outputSchema
              ? { outputSchema: specification.outputSchema }
              : {}),
            ...(specification.model ? { model: specification.model } : {}),
          },
          { timeoutMs: runTimeoutMs },
        ),
      )
      const turnObject = asObject(turn.turn)
      if (typeof turnObject.id === 'string') {
        active.turnId = turnObject.id
      }
    } catch (error) {
      await child.cancel()
      releaseRun(specification.runId)
      throw isAppError(error)
        ? error
        : new AppError(
            'PROCESS_SPAWN_REJECTED',
            'Codexを開始できませんでした',
            500,
          )
    }

    void waitForExit(active)
    return createHandle(active)
  }

  async function startExecRun(
    specification: ProviderRunSpecification,
    executable: string,
    sandbox: ReturnType<typeof mapCodexSandbox>,
    resume: boolean,
  ): Promise<ProviderRunHandle> {
    const schemaDirectory = specification.outputSchema
      ? writeSchemaFile(specification.outputSchema)
      : undefined
    const args = [...prefixArgs(), 'exec', '--json']
    if (resume && specification.providerSessionId) {
      args.push('resume', specification.providerSessionId)
    }
    args.push('--cd', specification.cwd, '--sandbox', sandbox.execSandbox)
    if (sandbox.enableSearch) {
      args.push('--search')
    }
    if (schemaDirectory) {
      args.push('--output-schema', join(schemaDirectory, 'schema.json'))
    }
    if (specification.model) {
      args.push('--model', specification.model)
    }
    args.push(specification.prompt)

    const child = spawn({
      executable,
      args,
      cwd: specification.cwd,
      env: specification.environment,
      allowedCwdRoots: specification.allowedCwdRoots,
      parentEnv,
      timeoutMs: resolveCodexRunTimeoutMs(specification.maxDurationMs),
    })
    const events = new AsyncQueue<CanonicalEvent>()
    const active: ActiveRun = {
      specification,
      process: child,
      events,
      approvalBindings: new Map(),
      ...(schemaDirectory === undefined ? {} : { schemaDirectory }),
      finished: false,
    }
    runs.set(specification.runId, active)
    void consumeExec(active)
    return createHandle(active)
  }

  async function consumeExec(active: ActiveRun): Promise<void> {
    try {
      let bufferedTerminal: CanonicalEvent | undefined
      for await (const raw of active.process.jsonl) {
        if (typeof raw.thread_id === 'string') {
          active.threadId = raw.thread_id
        }
        const item = asObject(raw.item)
        if (item.type === 'agentMessage') {
          active.lastAgentText = agentMessageText(item)
        }
        const mapped = mapCodexExecEvent(active.specification.runId, raw, now())
        if (!mapped) {
          continue
        }
        if (
          mapped.type === 'run.completed' ||
          mapped.type === 'run.failed' ||
          mapped.type === 'run.cancelled'
        ) {
          bufferedTerminal = mapped
          continue
        }
        active.events.push(mapped)
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
      if (bufferedTerminal) {
        finishRun(
          active,
          bufferedTerminal.type === 'run.completed'
            ? withSchemaResult(active, bufferedTerminal)
            : bufferedTerminal,
        )
        return
      }
      finishRun(active, {
        type: 'run.failed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '調査を完了できませんでした',
      })
    } catch {
      finishRun(active, {
        type: 'run.failed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '調査を完了できませんでした',
      })
    }
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
      providerId: 'codex',
      getSessionId: () => active.threadId,
      events: () => active.events,
      cancel: () => adapter.cancelRun(active.specification.runId),
    })
  }

  function handleCodexServerRequest(
    active: ActiveRun,
    message: {
      readonly id: JsonRpcId
      readonly method: string
      readonly params?: unknown
    },
  ): void {
    if (!isSupportedCodexServerRequest(message.method)) {
      active.rpc?.respondError(message.id, 'Unsupported server request')
      return
    }

    const params = asObject(message.params)
    const requestId =
      (typeof params.approvalId === 'string' && params.approvalId) ||
      (typeof params.itemId === 'string' && params.itemId) ||
      String(message.id)
    const command =
      typeof params.command === 'string' ? params.command : undefined

    active.approvalBindings.set(requestId, {
      id: message.id,
      method: message.method,
      ...(params.permissions === undefined
        ? {}
        : { permissions: params.permissions }),
    })
    active.events.push({
      type: 'approval.requested',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: approvalSummary(message.method, command),
      requestId,
      risk: isCodexPermissionsMethod(message.method)
        ? 'high'
        : classifyCommandRisk(command),
    })
  }

  function withSchemaResult(
    active: ActiveRun,
    completed: CanonicalEvent,
  ): CanonicalEvent {
    const schema = active.specification.outputSchema
    if (!schema || completed.type !== 'run.completed') {
      return completed
    }
    const parsed = structuredFromAgentMessage(
      active.lastAgentText ? { text: active.lastAgentText } : undefined,
    )
    if (!parsed || !validateJsonSchema(parsed, schema).ok) {
      return {
        ...completed,
        invalidResult: true,
        summary: '結果の形式が正しくありません',
      }
    }
    return completed
  }

  function finishRun(active: ActiveRun, terminal: CanonicalEvent): void {
    if (active.finished) {
      return
    }
    if (terminal.type === 'run.completed') {
      emitCompletionArtifact(active, terminal.invalidResult === true)
    }
    active.finished = true
    active.rpc?.cancelPending()
    active.events.push(terminal)
    active.events.close()
    releaseRun(active.specification.runId)
  }

  function emitCompletionArtifact(active: ActiveRun, invalid: boolean): void {
    const parsed = structuredFromAgentMessage(
      active.lastAgentText ? { text: active.lastAgentText } : undefined,
    )
    if (invalid) {
      active.events.push({
        type: 'artifact.created',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '形式が正しくない結果を保存しました',
        artifactType: 'file',
        title: 'raw result',
        content: active.lastAgentText ?? '',
      })
      return
    }
    const title =
      (parsed && typeof parsed.title === 'string' && parsed.title) || '調査メモ'
    active.events.push({
      type: 'artifact.created',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '調査結果を整理しています',
      artifactType: 'report',
      title,
      content: parsed ? JSON.stringify(parsed) : (active.lastAgentText ?? ''),
    })
  }

  function releaseRun(runId: string): void {
    const active = runs.get(runId)
    if (!active) {
      return
    }
    if (active.schemaDirectory) {
      rmSync(active.schemaDirectory, { recursive: true, force: true })
    }
    runs.delete(runId)
  }

  function prefixArgs(): string[] {
    return options.argsPrefix ? [...options.argsPrefix] : []
  }

  function resolveExecutable(): string | undefined {
    if (options.executable) {
      return options.executable
    }
    return resolveCommand(commandName, parentEnv)
  }

  async function probeCodex(): Promise<ProviderProbeResult> {
    const executable = resolveExecutable()
    const probeCwd = options.probeCwd ?? tmpdir()
    if (!executable) {
      return {
        installed: false,
        authenticated: false,
        transport: 'disconnected',
        supportedFeatures: DISCONNECTED,
        warnings: [],
        errors: ['codex コマンドが見つかりません'],
      }
    }

    const version = await captureText(executable, ['--version'], probeCwd)
    const appHelp = await captureText(
      executable,
      [...prefixArgs(), 'app-server', '--help'],
      probeCwd,
    )
    const execHelp = await captureText(
      executable,
      [...prefixArgs(), 'exec', '--help'],
      probeCwd,
    )
    const login = await captureText(
      executable,
      [...prefixArgs(), 'login', 'status'],
      probeCwd,
    )
    const hasAppServer =
      appHelp.code === 0 &&
      /app-server|generate-json-schema|--stdio/i.test(appHelp.stdout)
    const hasExec = execHelp.code === 0 && /--json/.test(execHelp.stdout)
    const authenticated = /logged in|chatgpt|api key/i.test(
      `${login.stdout}\n${login.stderr}`,
    )
    const unauthenticated = /not logged in|logged out|unauth/i.test(
      `${login.stdout}\n${login.stderr}`,
    )
    const transport: ProviderTransport = hasAppServer
      ? 'app-server'
      : hasExec
        ? 'exec-json'
        : 'disconnected'
    const warnings: string[] = []
    if (!hasAppServer && hasExec) {
      warnings.push(
        'codex app-server が使えないため exec --json にfallbackします。ライブ承認はできません。',
      )
    }
    if (!hasAppServer && !hasExec) {
      warnings.push('Codexの実行経路が見つかりません')
    }

    return {
      installed: true,
      commandPath: executable,
      ...(firstLine(version.stdout)
        ? { version: firstLine(version.stdout) }
        : {}),
      authenticated: authenticated && !unauthenticated,
      authDescription: authenticated
        ? 'Codex login status reports an existing session'
        : 'Codex login is required',
      transport,
      supportedFeatures: hasAppServer
        ? APP_SERVER_CAPABILITIES
        : hasExec
          ? EXEC_CAPABILITIES
          : DISCONNECTED,
      warnings,
      errors: [],
    }
  }

  async function captureText(
    executable: string,
    args: string[],
    cwd: string,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    try {
      const result = await capture({
        executable,
        args,
        cwd,
        allowedCwdRoots: [cwd],
        parentEnv,
        timeoutMs: 6_000,
      })
      return {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    } catch {
      return { code: 1, stdout: '', stderr: '' }
    }
  }
}

export function resolveFakeCodexPath(
  variant: CodexProtocolVariant = 'supported',
): string {
  const fileName =
    variant === 'supported' ? 'fake-codex.mjs' : `fake-codex-${variant}.mjs`
  return join(dirname(fileURLToPath(import.meta.url)), '../fixtures', fileName)
}

function writeSchemaFile(schema: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-codex-schema-'))
  writeFileSync(join(directory, 'schema.json'), JSON.stringify(schema))
  return directory
}

function approvalSummary(method: string, command: string | undefined): string {
  if (method.includes('fileChange')) {
    return 'ファイル変更の確認が必要です'
  }
  if (method.includes('permissions')) {
    return '追加の権限確認が必要です'
  }
  return command
    ? `コマンド実行の確認が必要です: ${command}`
    : 'コマンド実行の確認が必要です'
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}
