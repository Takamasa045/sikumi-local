import { existsSync } from 'node:fs'
import {
  DIRECT_HOOK_CAPABILITIES,
  displayNameForSource,
  rememberAdapterObservation,
  realUserHome,
  unavailableHealth,
  type ObserverAdapter,
  type ObserverHealth,
  type ObserverInstallOptions,
} from '@sikumi-local/observer-core'
import {
  discoverClaudeCodeHooks,
  missingClaudeCodeEvents,
} from './discovery.js'
import {
  applyClaudeCodeHookMutation,
  resolveClaudeCodeHookCommandPath,
} from './install.js'
import { normalizeClaudeCodeHook } from './normalize.js'

export function createClaudeCodeObserverAdapter(): ObserverAdapter {
  return {
    id: 'claude-code',
    displayName: displayNameForSource('claude-code'),
    capabilities: DIRECT_HOOK_CAPABILITIES,
    async healthCheck(options) {
      return inspectClaudeCodeHealth(options)
    },
    async install(options) {
      return applyClaudeCodeHookMutation('install', options ?? {})
    },
    async uninstall(options) {
      return applyClaudeCodeHookMutation('uninstall', options ?? {})
    },
    normalize(input) {
      return normalizeClaudeCodeHook(input)
    },
  }
}

export function inspectClaudeCodeHealth(
  options: ObserverInstallOptions = {},
): ObserverHealth {
  const homeDir = options.homeDir ?? realUserHome()
  const command = resolveClaudeCodeHookCommandPath()
  const discovery = discoverClaudeCodeHooks({
    homeDir,
    repoDir: options.repoDir ?? null,
    hookCommandPath: command,
  })
  if (discovery.ourHooks.length === 0) {
    return rememberAdapterObservation(
      unavailableHealth({
        status: 'not_installed',
        warnings: discovery.evidence,
        errors: ['Claude Code Hooks はまだ導入されていません'],
      }),
      options.lastEventAt,
    )
  }
  if (!existsSync(command)) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion: 'claude-code-hooks',
        supportedRange: 'Claude Code Hooks Phase 3',
        lastEventAt: null,
        warnings: discovery.evidence,
        errors: ['Hookコマンドの実行ファイルが見つかりません'],
      },
      options.lastEventAt,
    )
  }
  const missing = missingClaudeCodeEvents(discovery)
  if (missing.length > 0) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion: 'claude-code-hooks',
        supportedRange: 'Claude Code Hooks Phase 3',
        lastEventAt: null,
        warnings: [
          ...discovery.evidence,
          `未設定のイベント: ${missing.join(', ')}`,
        ],
        errors: [],
      },
      options.lastEventAt,
    )
  }
  return rememberAdapterObservation(
    {
      ok: false,
      status: 'needs_review',
      detectedVersion: 'claude-code-hooks',
      supportedRange: 'Claude Code Hooks Phase 3',
      lastEventAt: null,
      warnings: [
        ...discovery.evidence,
        '設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません',
      ],
      errors: [],
    },
    options.lastEventAt,
  )
}
