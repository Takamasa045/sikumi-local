import { describe, expect, it } from 'vitest'
import {
  observerInstallResultSchema,
  type ObserverInstallOptions,
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import {
  applyObserverAdapterRequest,
  presentAdapterInstallCopy,
  presentObserverInstallApiResult,
} from './observer.js'

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

  it('treats a granted apply with no file changes as connected, not as a preview', async () => {
    const observer = {
      async installAdapter(
        _source: string,
        options?: ObserverInstallOptions,
      ): Promise<ObserverInstallResult> {
        if (options?.allowRealUserApply) {
          return {
            ok: true,
            changed: false,
            applied: false,
            requiresConfirm: false,
            message:
              '表示した対象へ Grok Build Observer を書きました。Sikumiがeventを受信するまで有効とはしません。',
            preview:
              'keep /Users/example/.grok/config.toml\n' + 'x'.repeat(25_000),
            files: [
              {
                path: '/Users/example/.grok/config.toml',
                action: 'keep',
                preview: 'keep_me = true\n' + 'x'.repeat(25_000),
                previous: 'keep_me = true\n' + 'x'.repeat(25_000),
              },
            ],
          }
        }
        return {
          ok: true,
          changed: false,
          applied: false,
          requiresConfirm: true,
          message:
            'Grok Build Hook / Plugin の導入差分です。設定や plugin があるだけでは有効としません。',
          planDigest: 'digest-1',
          confirmationToken: 'digest-1',
        }
      },
      async uninstallAdapter(): Promise<ObserverInstallResult> {
        throw new Error('unused')
      },
    }

    const applied = await applyObserverAdapterRequest(
      observer,
      fakeStore(),
      'grok-build',
      'install',
      { confirm: true, confirmationToken: 'digest-1', planDigest: 'digest-1' },
    )
    expect(applied.ok).toBe(true)
    expect(applied.applied).toBe(true)
    expect(applied.message).toBe('つながりました')
    expect(applied.message).not.toBe('つなぐ準備ができました')
  })
})

describe('presentObserverInstallApiResult', () => {
  it('strips raw hooks.json / config.toml bodies so oversized plans stay valid', () => {
    const hugeToml = [
      'keep_me = true',
      'payload = """',
      'x'.repeat(30_000),
      '"""',
    ].join('\n')
    const hugeHooks = JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ command: '/tmp/sikumi-observer-grok.mjs' }] },
        ],
      },
      body: 'y'.repeat(30_000),
    })
    const presented = presentObserverInstallApiResult({
      ok: true,
      changed: true,
      applied: true,
      message:
        '表示した対象へ Grok Build Observer を書きました。Sikumiがeventを受信するまで有効とはしません。',
      preview: `${hugeToml}\n${hugeHooks}`,
      files: [
        {
          path: '/Users/example/.grok/config.toml',
          action: 'update',
          preview: hugeToml,
          previous: hugeToml,
        },
        {
          path: '/Users/example/.grok/plugins/sikumi-observer/hooks/hooks.json',
          action: 'create',
          preview: hugeHooks,
        },
      ],
      evidence: ['target: /Users/example/.grok/config.toml'],
      confirmationToken: 'digest-1',
      planDigest: 'digest-1',
    })

    expect(observerInstallResultSchema.safeParse(presented).success).toBe(true)
    expect(presented.preview).toContain('config.toml')
    expect(presented.preview).toContain('hooks.json')
    expect(presented.preview).not.toContain('keep_me = true')
    expect(presented.preview).not.toContain('"hooks"')
    expect(JSON.stringify(presented)).not.toContain('x'.repeat(100))
    expect(JSON.stringify(presented)).not.toContain(hugeHooks.slice(0, 80))
    expect(presented.files?.every((file) => file.preview === '')).toBe(true)
  })

  it('falls back to a short valid result instead of throwing on unparseable copy', () => {
    const presented = presentObserverInstallApiResult({
      ok: false,
      changed: false,
      applied: 'nope',
      message: '',
      preview: 'z'.repeat(30_000),
      files: [
        {
          path: '',
          action: 'update',
          preview: 'z'.repeat(30_000),
        },
      ],
    } as ObserverInstallResult)
    expect(observerInstallResultSchema.safeParse(presented).success).toBe(true)
    expect(presented.ok).toBe(false)
    expect(presented.applied).toBe(false)
    expect(presented.message).toBe('つなぎ直せませんでした')
    expect(presented.preview ?? '').toHaveLength(0)
    expect(presented.files).toBeUndefined()
  })

  it('keeps preview-only copy for unconfirmed plans', () => {
    const previewed = presentAdapterInstallCopy(
      'grok-build',
      'install',
      {
        ok: true,
        changed: false,
        applied: false,
        requiresConfirm: true,
        message:
          'Grok Build Hook / Plugin の導入差分です。設定や plugin があるだけでは有効としません。',
      },
      'preview',
    )
    expect(previewed.applied).not.toBe(true)
    expect(previewed.message).toBe('つなぐ準備ができました')
  })
})

function fakeStore() {
  return {
    getRegisteredRepository() {
      return undefined
    },
  } as never
}
