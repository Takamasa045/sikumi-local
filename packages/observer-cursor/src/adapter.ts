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
import { discoverCursorHooks, missingCursorEvents } from './discovery.js'
import {
  CURSOR_HOOK_COMMAND_NAME,
  CURSOR_HOOKS_VERSION,
  CURSOR_SUPPORTED_RANGE,
} from './events.js'
import {
  applyCursorHookMutation,
  resolveCursorHookCommandPath,
} from './install.js'
import { normalizeCursorHook } from './normalize.js'

export function createCursorObserverAdapter(): ObserverAdapter {
  return {
    id: 'cursor',
    displayName: displayNameForSource('cursor'),
    capabilities: DIRECT_HOOK_CAPABILITIES,
    async healthCheck(options) {
      return inspectCursorHealth(options)
    },
    async install(options) {
      return applyCursorHookMutation('install', options ?? {})
    },
    async uninstall(options) {
      return applyCursorHookMutation('uninstall', options ?? {})
    },
    normalize(input) {
      return normalizeCursorHook(input)
    },
  }
}

export function inspectCursorHealth(
  options: ObserverInstallOptions = {},
): ObserverHealth {
  const homeDir = options.homeDir ?? realUserHome()
  const command = resolveCursorHookCommandPath()
  const discovery = discoverCursorHooks({
    homeDir,
    repoDir: options.repoDir ?? null,
    hookCommandPath: command,
  })
  if (discovery.ourHooks.length === 0) {
    return rememberAdapterObservation(
      unavailableHealth({
        status: 'not_installed',
        supportedRange: CURSOR_SUPPORTED_RANGE,
        warnings: discovery.evidence,
        errors: ['Cursor Hooks はまだ導入されていません'],
      }),
      options.lastEventAt,
    )
  }
  if (!installedHookCommandExists(options, CURSOR_HOOK_COMMAND_NAME, command)) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion:
          discovery.schemaVersion === null
            ? 'cursor-hooks'
            : `cursor-hooks-v${discovery.schemaVersion}`,
        supportedRange: CURSOR_SUPPORTED_RANGE,
        lastEventAt: null,
        warnings: discovery.evidence,
        errors: ['Hookコマンドの実行ファイルが見つかりません'],
      },
      options.lastEventAt,
    )
  }
  if (
    discovery.schemaVersion !== null &&
    discovery.schemaVersion !== CURSOR_HOOKS_VERSION
  ) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'needs_update',
        detectedVersion: `cursor-hooks-v${discovery.schemaVersion}`,
        supportedRange: CURSOR_SUPPORTED_RANGE,
        lastEventAt: null,
        warnings: [
          ...discovery.evidence,
          '未知の hooks.json version です。Git観測は続けます。',
        ],
        errors: [],
      },
      options.lastEventAt,
    )
  }
  const missing = missingCursorEvents(discovery)
  if (missing.length > 0) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion: 'cursor-hooks-v1',
        supportedRange: CURSOR_SUPPORTED_RANGE,
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
      detectedVersion: 'cursor-hooks-v1',
      supportedRange: CURSOR_SUPPORTED_RANGE,
      lastEventAt: null,
      warnings: [
        ...discovery.evidence,
        '設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません',
        'Cloud Agent は初期対象外のため ready とはしません',
      ],
      errors: [],
    },
    options.lastEventAt,
  )
}
