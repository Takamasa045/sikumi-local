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
    expect(calls.at(-1)?.allowRealUserApply).toBe(true)
    expect(calls.at(-1)?.confirm).toBe(true)
    expect(calls.at(-1)?.homeDir).toBeTruthy()
  })
})

function fakeStore() {
  return {
    getRegisteredRepository() {
      return undefined
    },
  } as never
}
