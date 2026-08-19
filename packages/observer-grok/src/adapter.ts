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
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import { discoverGrokHooks, missingGrokEvents } from './discovery.js'
import {
  GROK_HOOK_COMMAND_NAME,
  GROK_SUPPORTED_VERSION_RANGE,
} from './events.js'
import { applyGrokHookMutation, resolveGrokHookCommandPath } from './install.js'
import { normalizeGrokEvent } from './normalize.js'
import { inspectGrokVersion } from './version.js'

export function createGrokObserverAdapter(): ObserverAdapter {
  return {
    id: 'grok-build',
    displayName: displayNameForSource('grok-build'),
    capabilities: DIRECT_HOOK_CAPABILITIES,
    async healthCheck(options) {
      try {
        return await inspectGrokHealth(options)
      } catch {
        return unavailableHealth({
          status: 'degraded',
          warnings: [GROK_HEALTH_UNAVAILABLE_WARNING],
          errors: [],
        })
      }
    },
    async install(options) {
      return markGrantedGrokApply(
        applyGrokHookMutation('install', options ?? {}),
      )
    },
    async uninstall(options) {
      return markGrantedGrokApply(
        applyGrokHookMutation('uninstall', options ?? {}),
      )
    },
    normalize(input) {
      return normalizeGrokEvent(input)
    },
  }
}

export async function inspectGrokHealth(
  options: ObserverInstallOptions = {},
): Promise<ObserverHealth> {
  const homeDir = options.homeDir ?? realUserHome()
  const command = resolveGrokHookCommandPath()
  const discovery = discoverGrokHooks({
    homeDir,
    repoDir: options.repoDir ?? null,
    hookCommandPath: command,
  })
  const supportedRange = GROK_SUPPORTED_VERSION_RANGE.label

  if (discovery.ourHooks.length === 0) {
    return rememberAdapterObservation(
      unavailableHealth({
        status: 'not_installed',
        detectedVersion: null,
        supportedRange,
        warnings: discovery.evidence,
        errors: ['Grok Build Hooks / Plugin はまだ導入されていません'],
      }),
      options.lastEventAt,
    )
  }
  const version = await inspectGrokVersionSafe(options.env)
  const detectedVersion = version.version ?? 'grok-hooks'
  const cliWarning = version.version ? [] : [GROK_CLI_MISSING_WARNING]
  if (!installedHookCommandExists(options, GROK_HOOK_COMMAND_NAME, command)) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion,
        supportedRange,
        lastEventAt: null,
        warnings: [...discovery.evidence, ...cliWarning],
        errors: ['Hookコマンドの実行ファイルが見つかりません'],
      },
      options.lastEventAt,
    )
  }
  if (version.classification === 'needs_update') {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'needs_update',
        detectedVersion,
        supportedRange,
        lastEventAt: null,
        warnings: [
          ...discovery.evidence,
          ...cliWarning,
          `検出version ${detectedVersion} は検証済み範囲 ${GROK_SUPPORTED_VERSION_RANGE.label} の外です。Git観測は続けます。`,
        ],
        errors: [],
      },
      options.lastEventAt,
    )
  }
  const missing = missingGrokEvents(discovery)
  if (missing.length > 0) {
    return rememberAdapterObservation(
      {
        ok: false,
        status: 'degraded',
        detectedVersion,
        supportedRange,
        lastEventAt: null,
        warnings: [
          ...discovery.evidence,
          ...cliWarning,
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
      detectedVersion,
      supportedRange,
      lastEventAt: null,
      warnings: [
        ...discovery.evidence,
        ...cliWarning,
        '設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません',
        '設定ファイルだけでは ready としません。実event受信が必要です',
      ],
      errors: [],
    },
    options.lastEventAt,
  )
}

export const GROK_CLI_MISSING_WARNING =
  'Grok CLI が見つかりません。設定は書き込み済みです。Grok が入っていると様子を送れます。'

export const GROK_HEALTH_UNAVAILABLE_WARNING =
  'Grok の状態を確認できませんでした。設定があれば庭へのつなぎはそのままです。'

function markGrantedGrokApply(
  result: ObserverInstallResult,
): ObserverInstallResult {
  if (!result.ok || result.requiresConfirm === true) {
    return result
  }
  return {
    ...result,
    applied: true,
  }
}

async function inspectGrokVersionSafe(
  env?: NodeJS.ProcessEnv,
): Promise<Awaited<ReturnType<typeof inspectGrokVersion>>> {
  try {
    return await inspectGrokVersion(env)
  } catch {
    return {
      version: null,
      classification: 'unknown',
      supportedRange: GROK_SUPPORTED_VERSION_RANGE.label,
    }
  }
}
