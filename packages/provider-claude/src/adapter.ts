import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError, isAppError } from '@sikumi-local/core'
import {
  AsyncQueue,
  resolveCommandOnPath,
  runCapturedProcess,
  spawnManagedProcess,
  type ManagedProcess,
} from '@sikumi-local/process-runtime'
import type {
  AgentProviderAdapter,
  CanonicalEvent,
  ProviderCapabilities,
  ProviderProbeResult,
  ProviderRunHandle,
  ProviderRunSpecification,
} from '@sikumi-local/provider-sdk'
import {
  createProviderRunHandle,
  extractJsonObject,
  validateJsonSchema,
} from '@sikumi-local/provider-sdk'
import {
  assertClaudeArgsSafe,
  claudeSchemaFinalizationArgs,
  mapClaudePermissions,
  PERMISSION_PROMPT_TOOL,
} from './permissions.js'
import {
  claudeResultText,
  claudeSessionId,
  mapClaudeStreamEvent,
} from './map-event.js'
import {
  assertSupportedClaudeProtocol,
  assertWorkspaceClaudeProtocol,
  type ClaudeProtocolVariant,
} from './protocol.js'

const CAPABILITIES: ProviderCapabilities = {
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
  usageReporting: false,
  costReporting: false,
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

export interface ClaudeProviderOptions {
  readonly commandName?: string
  readonly executable?: string
  readonly argsPrefix?: readonly string[]
  readonly spawn?: typeof spawnManagedProcess
  readonly capture?: typeof runCapturedProcess
  readonly resolveCommand?: typeof resolveCommandOnPath
  readonly now?: () => string
  readonly probeCwd?: string
  readonly parentEnv?: NodeJS.ProcessEnv
  readonly brokerPath?: string
}

interface ActiveRun {
  readonly specification: ProviderRunSpecification
  readonly process: ManagedProcess
  readonly events: AsyncQueue<CanonicalEvent>
  readonly controlDir: string
  sessionId?: string
  rawText: string
  finished: boolean
  readonly approvalSeen: Set<string>
}

export function createClaudeProvider(
  options: ClaudeProviderOptions = {},
): AgentProviderAdapter {
  const commandName = options.commandName ?? 'claude'
  const spawn = options.spawn ?? spawnManagedProcess
  const capture = options.capture ?? runCapturedProcess
  const resolveCommand = options.resolveCommand ?? resolveCommandOnPath
  const now = options.now ?? (() => new Date().toISOString())
  const parentEnv = options.parentEnv ?? process.env
  const runs = new Map<string, ActiveRun>()
  let cachedProbe: ProviderProbeResult | undefined

  const adapter: AgentProviderAdapter = {
    id: 'claude-code',
    displayName: 'Claude Code',
    advertisedAsRealProvider: true,

    async probe() {
      cachedProbe = await probeClaude()
      return cachedProbe
    },

    async getAuthStatus() {
      const probe = cachedProbe ?? (await this.probe())
      return {
        authenticated: probe.authenticated,
        description: probe.authDescription ?? 'Claude login status is unknown',
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
        existsRequest(run.controlDir, requestId),
      )
      if (!active) {
        throw new AppError('NOT_FOUND', 'No active Claude approval', 404)
      }
      writeAtomicJson(join(active.controlDir, 'decision.json'), {
        requestId,
        decision,
      })
    },

    async respondToQuestion() {
      throw new AppError(
        'VALIDATION_FAILED',
        'Claude adapter does not ask live questions',
        400,
      )
    },

    async cancelRun(runId) {
      const active = runs.get(runId)
      if (!active) {
        return
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
    assertWorkspaceClaudeProtocol(specification.cwd)
    const mapping = mapClaudePermissions(specification.permissionProfile)
    const probe = cachedProbe ?? (await adapter.probe())
    if (!probe.installed || !probe.commandPath) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'Claude Codeがインストールされていません',
        409,
      )
    }

    const controlDir = mkdtempSync(join(tmpdir(), 'sikumi-claude-broker-'))
    const mcpConfigPath = join(controlDir, 'mcp.json')
    writeFileSync(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          shikumi_permission_broker: {
            command: process.execPath,
            args: [resolveBrokerPath(), '--control-dir', controlDir],
          },
        },
      }),
    )

    const args = [
      ...prefixArgs(),
      ...(resume && specification.providerSessionId
        ? ['-r', specification.providerSessionId]
        : []),
      '-p',
      specification.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      mapping.permissionMode,
      '--allowedTools',
      mapping.allowedTools,
      '--mcp-config',
      mcpConfigPath,
      '--permission-prompt-tool',
      PERMISSION_PROMPT_TOOL,
      '--strict-mcp-config',
    ]
    if (mapping.disallowedTools) {
      args.push('--disallowedTools', mapping.disallowedTools)
    }
    if (specification.model) {
      args.push('--model', specification.model)
    }
    assertClaudeArgsSafe(args)

    let child: ManagedProcess
    try {
      child = spawn({
        executable: probe.commandPath,
        args,
        cwd: specification.cwd,
        env: specification.environment,
        allowedCwdRoots: specification.allowedCwdRoots,
        parentEnv,
        ...(specification.maxDurationMs === undefined
          ? {}
          : { timeoutMs: specification.maxDurationMs }),
      })
    } catch (error) {
      rmSync(controlDir, { recursive: true, force: true })
      throw isAppError(error)
        ? error
        : new AppError(
            'PROCESS_SPAWN_REJECTED',
            'Claude Codeを開始できませんでした',
            500,
          )
    }

    const events = new AsyncQueue<CanonicalEvent>()
    const active: ActiveRun = {
      specification,
      process: child,
      events,
      controlDir,
      rawText: '',
      finished: false,
      approvalSeen: new Set(),
    }
    runs.set(specification.runId, active)
    const poller = setInterval(() => {
      pollApproval(active)
    }, 30)
    poller.unref()
    void consume(active, poller)
    return createHandle(active)
  }

  async function consume(
    active: ActiveRun,
    poller: NodeJS.Timeout,
  ): Promise<void> {
    try {
      try {
        assertWorkspaceClaudeProtocol(active.specification.cwd)
      } catch (error) {
        finishRun(active, {
          type: 'run.failed',
          runId: active.specification.runId,
          occurredAt: now(),
          summary: isAppError(error)
            ? error.message
            : 'Claude protocol version is unsupported',
        })
        await active.process.cancel()
        return
      }
      for await (const raw of active.process.jsonl) {
        if (raw.type === 'system' && raw.subtype === 'init') {
          try {
            assertSupportedClaudeProtocol(raw)
          } catch (error) {
            finishRun(active, {
              type: 'run.failed',
              runId: active.specification.runId,
              occurredAt: now(),
              summary: isAppError(error)
                ? error.message
                : 'Claude protocol version is unsupported',
            })
            await active.process.cancel()
            return
          }
        }
        const sessionId = claudeSessionId(raw)
        if (sessionId) {
          active.sessionId = sessionId
        }
        const text = claudeResultText(raw)
        if (text) {
          active.rawText = text
        }
        const mapped = mapClaudeStreamEvent(
          active.specification.runId,
          raw,
          now(),
        )
        if (mapped?.type === 'run.completed') {
          continue
        }
        if (mapped) {
          active.events.push(mapped)
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
      await finalize(active)
    } catch {
      finishRun(active, {
        type: 'run.failed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '調査を完了できませんでした',
      })
    } finally {
      clearInterval(poller)
    }
  }

  async function finalize(active: ActiveRun): Promise<void> {
    const schema = active.specification.outputSchema
    const parsed = extractJsonObject(active.rawText)
    if (!schema || (parsed && validateJsonSchema(parsed, schema).ok)) {
      const title =
        (parsed && typeof parsed.title === 'string' && parsed.title) ||
        '調査メモ'
      active.events.push({
        type: 'artifact.created',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '調査結果を整理しています',
        artifactType: 'report',
        title,
        content: parsed ? JSON.stringify(parsed) : active.rawText,
      })
      finishRun(active, {
        type: 'run.completed',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: '調査が完了しました',
      })
      return
    }

    if (active.sessionId && cachedProbe?.commandPath) {
      const repaired = await finalizeWithSchema(
        active,
        cachedProbe.commandPath,
        schema,
      )
      if (repaired) {
        return
      }
    }

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

  async function finalizeWithSchema(
    active: ActiveRun,
    executable: string,
    schema: Record<string, unknown>,
  ): Promise<boolean> {
    const args = [
      ...prefixArgs(),
      ...claudeSchemaFinalizationArgs({
        sessionId: active.sessionId ?? '',
        schema,
      }),
    ]
    assertClaudeArgsSafe(args)
    const child = spawn({
      executable,
      args,
      cwd: active.specification.cwd,
      env: active.specification.environment,
      allowedCwdRoots: active.specification.allowedCwdRoots,
      parentEnv,
      ...(active.specification.maxDurationMs === undefined
        ? {}
        : { timeoutMs: active.specification.maxDurationMs }),
    })
    let text = ''
    for await (const raw of child.jsonl) {
      text = claudeResultText(raw) || text
    }
    await child.wait()
    const parsed = extractJsonObject(text)
    if (!parsed || !validateJsonSchema(parsed, schema).ok) {
      return false
    }
    active.events.push({
      type: 'artifact.created',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '調査結果を整理しています',
      artifactType: 'report',
      title: typeof parsed.title === 'string' ? parsed.title : '調査メモ',
      content: JSON.stringify(parsed),
    })
    finishRun(active, {
      type: 'run.completed',
      runId: active.specification.runId,
      occurredAt: now(),
      summary: '調査が完了しました',
    })
    return true
  }

  function pollApproval(active: ActiveRun): void {
    if (active.finished) {
      return
    }
    const requestPath = join(active.controlDir, 'request.json')
    try {
      const parsed = JSON.parse(readFileSync(requestPath, 'utf8')) as {
        requestId?: string
      }
      if (typeof parsed.requestId !== 'string') {
        return
      }
      if (active.approvalSeen.has(parsed.requestId)) {
        return
      }
      active.approvalSeen.add(parsed.requestId)
      active.events.push({
        type: 'approval.requested',
        runId: active.specification.runId,
        occurredAt: now(),
        summary: 'ツール実行の確認が必要です',
        requestId: parsed.requestId,
        risk: 'medium',
      })
    } catch {
      // Request file is absent or still being written.
    }
  }

  function createHandle(active: ActiveRun): ProviderRunHandle {
    return createProviderRunHandle({
      runId: active.specification.runId,
      providerId: 'claude-code',
      getSessionId: () => active.sessionId,
      events: () => active.events,
      cancel: () => adapter.cancelRun(active.specification.runId),
    })
  }

  function finishRun(active: ActiveRun, terminal: CanonicalEvent): void {
    if (active.finished) {
      return
    }
    active.finished = true
    active.events.push(terminal)
    active.events.close()
    rmSync(active.controlDir, { recursive: true, force: true })
    runs.delete(active.specification.runId)
  }

  function prefixArgs(): string[] {
    return options.argsPrefix ? [...options.argsPrefix] : []
  }

  function resolveBrokerPath(): string {
    return options.brokerPath ?? resolvePermissionBrokerPath()
  }

  async function probeClaude(): Promise<ProviderProbeResult> {
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
        errors: ['claude コマンドが見つかりません'],
      }
    }

    const version = await captureText(
      executable,
      [...prefixArgs(), '--version'],
      probeCwd,
    )
    const auth = await captureText(
      executable,
      [...prefixArgs(), 'auth', 'status', '--json'],
      probeCwd,
    )
    const loggedIn = /"loggedIn"\s*:\s*true/i.test(auth.stdout)
    return {
      installed: true,
      commandPath: executable,
      ...(firstLine(version.stdout)
        ? { version: firstLine(version.stdout) }
        : {}),
      authenticated: loggedIn,
      authDescription: loggedIn
        ? 'Claude Code reports an existing CLI login'
        : 'Claude Code login is required',
      transport: 'stream-json',
      supportedFeatures: CAPABILITIES,
      warnings: ['Shikumi Local does not store Claude CLI credentials.'],
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
      return { code: result.code, stdout: result.stdout, stderr: result.stderr }
    } catch {
      return { code: 1, stdout: '', stderr: '' }
    }
  }
}

export function resolveFakeClaudePath(
  variant: ClaudeProtocolVariant = 'supported',
): string {
  const fileName =
    variant === 'supported' ? 'fake-claude.mjs' : `fake-claude-${variant}.mjs`
  return join(dirname(fileURLToPath(import.meta.url)), '../fixtures', fileName)
}

export function resolvePermissionBrokerPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../fixtures/permission-broker.mjs',
  )
}

function existsRequest(controlDir: string, requestId: string): boolean {
  try {
    const parsed = JSON.parse(
      readFileSync(join(controlDir, 'request.json'), 'utf8'),
    ) as { requestId?: string }
    return parsed.requestId === requestId
  } catch {
    return false
  }
}

function writeAtomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value), {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(temporary, path)
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}
