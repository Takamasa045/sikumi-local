import { AppError } from '@sikumi-local/core'
import {
  COOPERATIVE_CAPABILITIES,
  DIRECT_HOOK_CAPABILITIES,
  displayNameForSource,
  GIT_OBSERVER_CAPABILITIES,
  isEnabledInstallationStatus,
  type NormalizedObserverEvent,
  type ObserverAdapterRecord,
  type ObserverCapabilities,
  type ObserverHealth,
  type ObserverInstallOptions,
  type ObserverInstallResult,
  type ObserverSourceId,
} from './types.js'

export interface ObserverAdapter {
  readonly id: ObserverSourceId
  readonly displayName: string
  readonly capabilities: ObserverCapabilities
  healthCheck(options?: ObserverInstallOptions): Promise<ObserverHealth>
  install(options?: ObserverInstallOptions): Promise<ObserverInstallResult>
  uninstall(options?: ObserverInstallOptions): Promise<ObserverInstallResult>
  normalize(input: unknown): NormalizedObserverEvent | null
}

export const PHASE1_INSTALL_MESSAGE =
  'この観測口の導入・解除はまだ用意していません。Git観測だけが動きます。'

export function unavailableInstallResult(): ObserverInstallResult {
  return {
    ok: false,
    changed: false,
    message: PHASE1_INSTALL_MESSAGE,
  }
}

export function unavailableHealth(
  extras?: Partial<ObserverHealth>,
): ObserverHealth {
  return {
    ok: false,
    status: extras?.status ?? 'not_installed',
    detectedVersion: extras?.detectedVersion ?? null,
    supportedRange: extras?.supportedRange ?? null,
    lastEventAt: extras?.lastEventAt ?? null,
    warnings: extras?.warnings ?? [],
    errors: extras?.errors ?? ['この観測口はまだ接続できません'],
  }
}

export function readyHealth(extras?: Partial<ObserverHealth>): ObserverHealth {
  return {
    ok: true,
    status: extras?.status ?? 'ready',
    detectedVersion: extras?.detectedVersion ?? null,
    supportedRange: extras?.supportedRange ?? null,
    lastEventAt: extras?.lastEventAt ?? null,
    warnings: extras?.warnings ?? [],
    errors: extras?.errors ?? [],
  }
}

const PENDING_OBSERVATION_WARNINGS = [
  '設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません',
  'パッケージはありますが、Sikumiが協調報告を受信した記録はありません',
] as const

export function rememberAdapterObservation(
  health: ObserverHealth,
  lastEventAt?: string | null,
): ObserverHealth {
  const observedAt = lastEventAt ?? health.lastEventAt ?? null
  if (health.status === 'needs_review' && observedAt) {
    const pending = health.warnings.find((warning) =>
      (PENDING_OBSERVATION_WARNINGS as readonly string[]).includes(warning),
    )
    return {
      ...health,
      ok: true,
      status: 'ready',
      lastEventAt: observedAt,
      warnings: withUniqueWarning(
        health.warnings.filter(
          (warning) =>
            !(PENDING_OBSERVATION_WARNINGS as readonly string[]).includes(
              warning,
            ),
        ),
        receivedObservationWarning(pending),
      ),
    }
  }
  return {
    ...health,
    lastEventAt: observedAt,
  }
}

function receivedObservationWarning(pending?: string): string {
  if (pending?.includes('協調報告')) {
    return 'Sikumiが協調報告を受信済みです'
  }
  return 'Sikumiがhook eventを受信済みです'
}

function withUniqueWarning(
  warnings: readonly string[],
  warning: string,
): readonly string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning]
}

export function createDeferredObserverAdapter(input: {
  readonly id: ObserverSourceId
  readonly capabilities: ObserverCapabilities
}): ObserverAdapter {
  return {
    id: input.id,
    displayName: displayNameForSource(input.id),
    capabilities: input.capabilities,
    async healthCheck() {
      return unavailableHealth()
    },
    async install() {
      return unavailableInstallResult()
    },
    async uninstall() {
      return unavailableInstallResult()
    },
    normalize() {
      return null
    },
  }
}

export function defaultObserverAdapters(): readonly ObserverAdapter[] {
  return [
    createDeferredObserverAdapter({
      id: 'codex',
      capabilities: DIRECT_HOOK_CAPABILITIES,
    }),
    createDeferredObserverAdapter({
      id: 'cursor',
      capabilities: DIRECT_HOOK_CAPABILITIES,
    }),
    createDeferredObserverAdapter({
      id: 'grok-build',
      capabilities: DIRECT_HOOK_CAPABILITIES,
    }),
    createDeferredObserverAdapter({
      id: 'claude-code',
      capabilities: DIRECT_HOOK_CAPABILITIES,
    }),
    createDeferredObserverAdapter({
      id: 'claude-desktop',
      capabilities: COOPERATIVE_CAPABILITIES,
    }),
  ]
}

export function capabilitiesForSource(
  source: ObserverSourceId,
): ObserverCapabilities {
  if (source === 'git') {
    return GIT_OBSERVER_CAPABILITIES
  }
  if (source === 'claude-desktop') {
    return COOPERATIVE_CAPABILITIES
  }
  return DIRECT_HOOK_CAPABILITIES
}

export function assertInstallNotImplemented(): never {
  throw new AppError(
    'OBSERVER_ADAPTER_UNAVAILABLE',
    PHASE1_INSTALL_MESSAGE,
    409,
  )
}

export function toAdapterRecord(
  adapter: ObserverAdapter,
  health: ObserverHealth,
  now: string,
): ObserverAdapterRecord {
  return {
    id: adapter.id,
    source: adapter.id,
    displayName: adapter.displayName,
    enabled: adapter.id === 'git' || isEnabledInstallationStatus(health.status),
    installationStatus: health.status,
    installedVersion: null,
    detectedVersion: health.detectedVersion,
    lastEventAt: health.lastEventAt,
    health,
    createdAt: now,
    updatedAt: now,
  }
}
