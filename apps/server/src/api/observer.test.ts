import { describe, expect, it } from 'vitest'
import type {
  ObserverInstallOptions,
  ObserverInstallResult,
} from '@sikumi-local/observer-core'
import { OBSERVER_HUB_RECENT_LIMIT } from '@sikumi-local/observer-core'
import { createObserverHub } from '../observer/hub.js'
import { missingSession } from '../storage/observer-store.js'
import { applyObserverAdapterRequest, toInstallOptions } from './observer.js'

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

  it('maps repo and user install options and uninstall confirm', async () => {
    expect(() => toInstallOptions({ scope: 'repo' }, fakeStore())).toThrowError(
      /repositoryId/,
    )
    expect(() =>
      toInstallOptions({ scope: 'repo', repositoryId: 'missing' }, fakeStore()),
    ).toThrowError(/未登録/)

    const repoStore = {
      getRegisteredRepository(id: string) {
        return id === 'repo-1'
          ? { id: 'repo-1', absolutePath: '/tmp/repo' }
          : undefined
      },
    } as never
    expect(
      toInstallOptions(
        {
          scope: 'repo',
          repositoryId: 'repo-1',
          confirm: true,
          confirmationToken: 'tok',
          planDigest: 'dig',
        },
        repoStore,
      ),
    ).toMatchObject({
      scope: 'repo',
      repositoryId: 'repo-1',
      repoDir: '/tmp/repo',
      confirm: true,
      confirmationToken: 'tok',
      planDigest: 'dig',
    })
    expect(toInstallOptions({ confirm: false }, fakeStore()).scope).toBe('user')

    const uninstalls: ObserverInstallOptions[] = []
    const observer = {
      async installAdapter(): Promise<ObserverInstallResult> {
        throw new Error('unused')
      },
      async uninstallAdapter(
        _source: string,
        options?: ObserverInstallOptions,
      ): Promise<ObserverInstallResult> {
        uninstalls.push(options ?? {})
        return {
          ok: true,
          changed: false,
          applied: Boolean(options?.allowRealUserApply),
          requiresConfirm: !options?.allowRealUserApply,
          message: 'uninstall',
          planDigest: 'u1',
          confirmationToken: 'u1',
        }
      },
    }
    const preview = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'cursor',
      'uninstall',
      { confirm: false },
    )
    expect(preview.applied).not.toBe(true)
    const granted = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'cursor',
      'uninstall',
      { confirm: true, confirmationToken: 'u1', planDigest: 'u1' },
    )
    expect(granted.applied).toBe(true)
    expect(uninstalls.at(-1)?.allowRealUserApply).toBe(true)
  })

  it('covers hub overflow and missing session helper', () => {
    expect(() => missingSession('ghost')).toThrow(/ghost/)
    const hub = createObserverHub()
    const seen: string[] = []
    const unsubscribe = hub.subscribe((event) => {
      seen.push(event.id)
    })
    for (let index = 0; index < OBSERVER_HUB_RECENT_LIMIT + 3; index += 1) {
      hub.publish({
        id: `evt-${index}`,
        type: 'observer.rescan',
        payload: { repositoryId: 'repo' },
        occurredAt: '2026-08-19T00:00:00.000Z',
      })
    }
    unsubscribe()
    expect(hub.listRecent()).toHaveLength(OBSERVER_HUB_RECENT_LIMIT)
    expect(seen.length).toBe(OBSERVER_HUB_RECENT_LIMIT + 3)
  })
})

function fakeStore() {
  return {
    getRegisteredRepository() {
      return undefined
    },
  } as never
}
