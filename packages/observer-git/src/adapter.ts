import {
  createDeferredObserverAdapter,
  displayNameForSource,
  GIT_OBSERVER_CAPABILITIES,
  readyHealth,
  unavailableHealth,
  type ObserverAdapter,
  type ObserverHealth,
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import { resolveGitExecutable } from './exec.js'

export function createGitObserverAdapter(): ObserverAdapter {
  const fallback = createDeferredObserverAdapter({
    id: 'git',
    capabilities: GIT_OBSERVER_CAPABILITIES,
  })
  return {
    id: 'git',
    displayName: displayNameForSource('git'),
    capabilities: GIT_OBSERVER_CAPABILITIES,
    async healthCheck(): Promise<ObserverHealth> {
      const git = resolveGitExecutable()
      if (!git) {
        return unavailableHealth({
          status: 'unavailable',
          errors: ['このパソコンで Git を見つけられませんでした'],
        })
      }
      return readyHealth({
        detectedVersion: 'git',
        supportedRange: 'any local git',
      })
    },
    async install(): Promise<ObserverInstallResult> {
      return {
        ok: true,
        changed: false,
        message: 'Git観測は登録済みの場所に対して自動で動きます。導入作業はありません。',
      }
    },
    async uninstall(): Promise<ObserverInstallResult> {
      return {
        ok: true,
        changed: false,
        message: 'Git観測は登録を消すと止まります。設定ファイルは変更しません。',
      }
    },
    normalize(input: unknown) {
      return fallback.normalize(input)
    },
  }
}
