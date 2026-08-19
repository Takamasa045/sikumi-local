import {
  DIRECT_HOOK_CAPABILITIES,
  displayNameForSource,
  installedHookCommandExists,
  rememberAdapterObservation,
  realUserHome,
  unavailableHealth,
  type ObserverAdapter,
  type ObserverHealth,
  type ObserverInstallOptions,
} from '@sikumi-local/observer-core'
import { discoverCodexHooks, missingCodexEvents } from './discovery.js'
import { CODEX_HOOK_COMMAND_NAME } from './events.js'
import {
  applyCodexHookMutation,
  resolveCodexHookCommandPath,
} from './install.js'
import { normalizeCodexHook } from './normalize.js'

export function createCodexObserverAdapter(): ObserverAdapter {
  return {
    id: 'codex',
    displayName: displayNameForSource('codex'),
    capabilities: DIRECT_HOOK_CAPABILITIES,
    async healthCheck(options) {
      return inspectCodexHealth(options)
    },
    async install(options) {
      return applyCodexHookMutation('install', options ?? {})
    },
    async uninstall(options) {
      return applyCodexHookMutation('uninstall', options ?? {})
    },
    normalize(input) {
      return normalizeCodexHook(input)
    },
  }
}

export function inspectCodexHealth(
  options: ObserverInstallOptions = {},
): ObserverHealth {
  const homeDir = options.homeDir ?? realUserHome()
  const command = resolveCodexHookCommandPath()
  const discovery = discoverCodexHooks({
    homeDir,
    repoDir: options.repoDir ?? null,
    hookCommandPath: command,
  })
  if (discovery.ourHooks.length === 0) {
    return rememberAdapterObservation(
      unavailableHealth({
        status: 'not_installed',
        warnings: discovery.evidence,
        errors: ['Codex Hooks はまだ導入されていません'],
      }),
      options.lastEventAt,
    )
  }
  const missing = missingCodexEvents(discovery)
  if (!installedHookCommandExists(options, CODEX_HOOK_COMMAND_NAME, command)) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion: 'codex-hooks',
        supportedRange: 'Codex Hooks 2026-08',
        lastEventAt: null,
        warnings: discovery.evidence,
        errors: ['Hookコマンドの実行ファイルが見つかりません'],
      },
      options.lastEventAt,
    )
  }
  if (missing.length > 0) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion: 'codex-hooks',
        supportedRange: 'Codex Hooks 2026-08',
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
      detectedVersion: 'codex-hooks',
      supportedRange: 'Codex Hooks 2026-08',
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
