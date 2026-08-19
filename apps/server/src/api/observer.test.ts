import { describe, expect, it } from 'vitest'
import type {
  ObserverInstallOptions,
  ObserverInstallResult,
} from '@sikumi-local/observer-core'
import { applyObserverAdapterRequest } from './observer.js'

describe('applyObserverAdapterRequest', () => {
  it('previews without the unpublished real-home flag and grants it only after a matching digest', async () => {
    const calls: ObserverInstallOptions[] = []
    const preview: ObserverInstallResult = {
      ok: true,
      changed: false,
      applied: false,
      requiresConfirm: true,
      message: 'preview',
      planDigest: 'digest-1',
      confirmationToken: 'digest-1',
      targetRoot: '/Users/example',
    }
    const observer = {
      async installAdapter(
        _source: string,
        options?: ObserverInstallOptions,
      ): Promise<ObserverInstallResult> {
        calls.push(options ?? {})
        if (options?.allowRealUserApply) {
          return {
            ...preview,
            applied: true,
            changed: true,
            message: 'applied',
          }
        }
        return preview
      },
      async uninstallAdapter(): Promise<ObserverInstallResult> {
        throw new Error('unused')
      },
    }

    const previewed = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'codex',
      'install',
      { confirm: false },
    )
    expect(previewed.applied).not.toBe(true)
    expect(calls[0]?.allowRealUserApply).toBeUndefined()
    expect(calls[0]?.confirm).toBe(false)

    const mismatch = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'codex',
      'install',
      { confirm: true, confirmationToken: 'wrong', planDigest: 'wrong' },
    )
    expect(mismatch.ok).toBe(false)
    expect(mismatch.applied).toBe(false)
    expect(calls.at(-1)?.allowRealUserApply).toBeUndefined()

    const applied = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'codex',
      'install',
      { confirm: true, confirmationToken: 'digest-1', planDigest: 'digest-1' },
    )
    expect(applied.applied).toBe(true)
    expect(applied.message).toBe('つながりました')
    expect(calls.at(-1)?.allowRealUserApply).toBe(true)
    expect(calls.at(-1)?.confirm).toBe(true)
    expect(calls.at(-1)?.homeDir).toBeTruthy()
  })

  it('rewrites applied and technical preview copy for the settings surface', async () => {
    const observer = {
      async installAdapter(): Promise<ObserverInstallResult> {
        return {
          ok: true,
          changed: false,
          applied: false,
          requiresConfirm: true,
          message:
            'Codex Hooks の導入差分です。Sikumiがeventを受信するまで有効とはしません。',
          planDigest: 'digest-1',
          confirmationToken: 'digest-1',
        }
      },
      async uninstallAdapter(
        _source: string,
        options?: ObserverInstallOptions,
      ): Promise<ObserverInstallResult> {
        if (options?.allowRealUserApply) {
          return {
            ok: true,
            changed: true,
            applied: true,
            message: '表示した対象から Sikumi の Codex Hooks を外しました。',
          }
        }
        return {
          ok: true,
          changed: false,
          applied: false,
          requiresConfirm: true,
          message: 'Codex Hooks から Sikumi の設定だけを外す差分です。',
          planDigest: 'digest-1',
          confirmationToken: 'digest-1',
        }
      },
    }

    const previewed = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'codex',
      'install',
      { confirm: false },
    )
    expect(previewed.applied).not.toBe(true)
    expect(previewed.message).toBe('つなぐ準備ができました')
    expect(previewed.message).not.toContain('導入差分です')
    expect(previewed.message).not.toContain('有効とはしません')

    const removed = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'codex',
      'uninstall',
      { confirm: true, confirmationToken: 'digest-1', planDigest: 'digest-1' },
    )
    expect(removed.applied).toBe(true)
    expect(removed.message).toBe('はずしました')
  })
})

function fakeStore() {
  return {
    getRegisteredRepository() {
      return undefined
    },
  } as never
}
