import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdapterSettings } from './AdapterSettings'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/session')) {
        return json({ token: 't' })
      }
      if (url.endsWith('/api/workspaces')) {
        return json({
          workspaces: [
            {
              id: 'ws_1',
              name: 'demo',
              defaultProviderId: null,
              worldPackId: 'dog-office',
              createdAt: 't',
              updatedAt: 't',
              repository: {
                id: 'repo_1',
                absolutePath: '/tmp/project',
                displayName: 'demo-repo',
                currentBranch: 'main',
                remoteName: null,
                remoteUrl: null,
                readable: true,
              },
            },
          ],
        })
      }
      if (url.endsWith('/api/observer/adapters')) {
        return json({
          adapters: [
            {
              id: 'codex',
              source: 'codex',
              displayName: 'Codex',
              enabled: false,
              installationStatus: 'not_installed',
              lastEventAt: null,
              health: {
                ok: false,
                status: 'not_installed',
                warnings: [],
                errors: ['Codex Hooks はまだ導入されていません'],
              },
            },
            {
              id: 'claude-code',
              source: 'claude-code',
              displayName: 'Claude Code',
              enabled: true,
              installationStatus: 'needs_review',
              lastEventAt: null,
              health: {
                ok: false,
                status: 'needs_review',
                warnings: [
                  '設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません',
                ],
                errors: [],
              },
            },
            {
              id: 'cursor',
              source: 'cursor',
              displayName: 'Cursor',
              enabled: false,
              installationStatus: 'not_installed',
              lastEventAt: null,
              health: {
                ok: false,
                status: 'not_installed',
                warnings: [],
                errors: ['Cursor Hooks はまだ導入されていません'],
              },
            },
            {
              id: 'grok-build',
              source: 'grok-build',
              displayName: 'Grok Build',
              enabled: false,
              installationStatus: 'not_installed',
              lastEventAt: null,
              health: {
                ok: false,
                status: 'not_installed',
                warnings: [],
                errors: ['Grok Build Hooks / Plugin はまだ導入されていません'],
              },
            },
            {
              id: 'claude-desktop',
              source: 'claude-desktop',
              displayName: 'Claudeアプリ',
              enabled: false,
              installationStatus: 'not_installed',
              lastEventAt: null,
              health: {
                ok: false,
                status: 'not_installed',
                warnings: ['制限付きの協調報告です'],
                errors: [
                  'Claudeアプリ向けの協調報告パッケージはまだ生成されていません',
                ],
              },
            },
          ],
        })
      }
      if (url.includes('/check') && init?.method === 'POST') {
        return json({
          adapter: {
            id: 'codex',
            source: 'codex',
            displayName: 'Codex',
            enabled: false,
            installationStatus: 'not_installed',
            lastEventAt: null,
            health: {
              ok: false,
              status: 'not_installed',
              warnings: [],
              errors: ['Codex Hooks はまだ導入されていません'],
            },
          },
        })
      }
      if (url.includes('/uninstall') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as {
          confirm?: boolean
        }
        if (body.confirm) {
          return json({
            result: {
              ok: true,
              changed: true,
              applied: true,
              message: '解除しました。',
              targetRoot: '/Users/example',
            },
          })
        }
        return json({
          result: {
            ok: true,
            changed: false,
            requiresConfirm: true,
            confirmationToken: 'preview-digest',
            planDigest: 'preview-digest',
            targetRoot: '/Users/example',
            message: '差分を確認しました。この操作ではまだ書き込みません。',
            preview: 'remove hooks',
          },
        })
      }
      if (url.includes('/install') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as {
          confirm?: boolean
          confirmationToken?: string
          planDigest?: string
          scope?: string
          repositoryId?: string
        }
        if (body.confirm) {
          return json({
            result: {
              ok: true,
              changed: true,
              applied: true,
              message: '表示した対象へ Hooks を書きました。',
              targetRoot:
                body.scope === 'repo' ? '/tmp/project' : '/Users/example',
            },
          })
        }
        return json({
          result: {
            ok: true,
            changed: false,
            requiresConfirm: true,
            confirmationToken: 'preview-digest',
            planDigest: 'preview-digest',
            targetRoot:
              body.scope === 'repo' ? '/tmp/project' : '/Users/example',
            message: '差分を確認しました。この操作ではまだ書き込みません。',
            preview: 'create /Users/example/.codex/hooks.json',
          },
        })
      }
      return json({ error: { message: 'not found' } }, 404)
    },
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdapterSettings', () => {
  it('shows a preview first and only applies after explicit confirm with the digest', async () => {
    render(<AdapterSettings />)
    expect(
      await screen.findByTestId('observer-adapter-codex'),
    ).toHaveTextContent('未導入')
    expect(
      screen.getByTestId('observer-adapter-claude-code'),
    ).toHaveTextContent('要レビュー')
    expect(
      screen.queryByRole('button', {
        name: '表示した対象へこの差分を適用する',
      }),
    ).toBeNull()
    expect(screen.getByText(/まだ書き込みません/)).toBeVisible()
    expect(screen.getByText(/認可トークンではありません/)).toBeVisible()
    await userEvent.click(
      screen.getAllByRole('button', { name: '導入差分' })[0]!,
    )
    expect(
      await screen.findByText(/この操作ではまだ書き込みません/),
    ).toBeVisible()
    expect(screen.getByText(/対象:/)).toBeVisible()
    expect(screen.getByText(/範囲: ユーザー全体/)).toBeVisible()
    const apply = await screen.findByRole('button', {
      name: '表示した対象へこの差分を適用する',
    })
    expect(apply).toBeVisible()
    await userEvent.click(apply)
    const applyCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        String(input).endsWith('/api/observer/adapters/codex/install') &&
        typeof init === 'object' &&
        init !== null &&
        'body' in init &&
        String(init.body).includes('"confirm":true')
      )
    })
    expect(applyCall).toBeTruthy()
    expect(String(applyCall?.[1]?.body)).toContain('preview-digest')
    expect(String(applyCall?.[1]?.body)).toContain('"scope":"user"')
    expect(String(applyCall?.[1]?.body)).not.toContain('repositoryId')
    expect(
      await screen.findByText(/表示した対象へ Hooks を書きました/),
    ).toBeVisible()
  })

  it('keeps the same Claude Code repository scope on preview and apply', async () => {
    render(<AdapterSettings />)
    expect(await screen.findByLabelText('Claude Code の導入範囲')).toBeVisible()
    await userEvent.selectOptions(
      screen.getByLabelText('Claude Code の導入範囲'),
      'repo',
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Claude Code の対象 Repository'),
      'repo_1',
    )
    await userEvent.click(
      screen.getAllByRole('button', { name: '導入差分' })[1]!,
    )
    expect(await screen.findByText(/範囲: 登録Repository/)).toBeVisible()
    const previewCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        String(input).endsWith('/api/observer/adapters/claude-code/install') &&
        typeof init === 'object' &&
        init !== null &&
        'body' in init &&
        String(init.body).includes('"confirm":false')
      )
    })
    expect(String(previewCall?.[1]?.body)).toContain('"scope":"repo"')
    expect(String(previewCall?.[1]?.body)).toContain('"repositoryId":"repo_1"')
    await userEvent.click(
      await screen.findByRole('button', {
        name: '表示した対象へこの差分を適用する',
      }),
    )
    const applyCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        String(input).endsWith('/api/observer/adapters/claude-code/install') &&
        typeof init === 'object' &&
        init !== null &&
        'body' in init &&
        String(init.body).includes('"confirm":true')
      )
    })
    expect(String(applyCall?.[1]?.body)).toContain('"scope":"repo"')
    expect(String(applyCall?.[1]?.body)).toContain('"repositoryId":"repo_1"')
    expect(String(applyCall?.[1]?.body)).toContain('preview-digest')
  })

  it('offers Cursor and Grok Build install previews with repo scope', async () => {
    render(<AdapterSettings />)
    expect(
      await screen.findByTestId('observer-adapter-cursor'),
    ).toHaveTextContent('未導入')
    expect(screen.getByTestId('observer-adapter-grok-build')).toHaveTextContent(
      '未導入',
    )
    expect(screen.getByLabelText('Cursor の導入範囲')).toBeVisible()
    expect(screen.getByLabelText('Grok Build の導入範囲')).toBeVisible()
    expect(screen.getAllByRole('button', { name: '導入差分' })).toHaveLength(4)
  })

  it('describes Claude app observation as limited cooperative reporting', async () => {
    render(<AdapterSettings />)
    const card = await screen.findByTestId('observer-adapter-claude-desktop')
    expect(card).toHaveTextContent('制限付き')
    expect(card).toHaveTextContent('協調報告')
    expect(card).toHaveTextContent('自動で全部見ることはできません')
    expect(screen.getByText(/制限付きの協調報告/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'パッケージ差分' })).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'パッケージ差分' }),
    )
    expect(
      await screen.findByRole('button', { name: 'パッケージを生成する' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', {
        name: '表示した対象へこの差分を適用する',
      }),
    ).toBeNull()
  })

  it('checks status, rejects repo preview without a repository, and uninstalls', async () => {
    render(<AdapterSettings />)
    expect(await screen.findByTestId('observer-adapter-codex')).toBeVisible()
    await userEvent.click(
      screen.getAllByRole('button', { name: '状態を確認' })[0]!,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Claude Code の導入範囲'),
      'repo',
    )
    await userEvent.click(
      screen.getAllByRole('button', { name: '導入差分' })[1]!,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '登録済み Repository を選んでください',
    )
    await userEvent.click(
      screen.getAllByRole('button', { name: '解除差分' })[0]!,
    )
    expect(
      await screen.findByText(/この操作ではまだ書き込みません/),
    ).toBeVisible()
  })

  it('labels remaining adapter health states and ready evidence', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/session')) {
        return json({ token: 't' })
      }
      if (url.endsWith('/api/workspaces')) {
        return json({ workspaces: [] })
      }
      if (url.endsWith('/api/observer/adapters')) {
        return json({
          adapters: [
            adapterView({
              id: 'ready',
              source: 'codex',
              displayName: 'Ready',
              installationStatus: 'ready',
              lastEventAt: '2026-08-19T00:00:00.000Z',
              health: { ok: true, status: 'ready', warnings: [], errors: [] },
            }),
            adapterView({
              id: 'degraded',
              source: 'cursor',
              displayName: 'Degraded',
              installationStatus: 'degraded',
              health: {
                ok: false,
                status: 'degraded',
                warnings: ['遅い'],
                errors: [],
              },
            }),
            adapterView({
              id: 'error',
              source: 'grok-build',
              displayName: 'Broken',
              installationStatus: 'error',
              health: {
                ok: false,
                status: 'error',
                warnings: [],
                errors: ['壊れた'],
              },
            }),
            adapterView({
              id: 'needs-update',
              source: 'claude-code',
              displayName: 'Stale',
              installationStatus: 'needs_update',
              health: {
                ok: false,
                status: 'needs_update',
                warnings: [],
                errors: [],
              },
            }),
            adapterView({
              id: 'unavailable',
              source: 'claude-desktop',
              displayName: 'Away',
              installationStatus: 'unavailable',
              health: {
                ok: false,
                status: 'unavailable',
                warnings: [],
                errors: [],
              },
            }),
            adapterView({
              id: 'custom',
              source: 'unknown',
              displayName: 'Custom',
              installationStatus: 'mystery',
              health: {
                ok: false,
                status: 'mystery',
                warnings: [],
                errors: [],
              },
            }),
          ],
        })
      }
      return json({ error: { message: 'not found' } }, 404)
    })
    render(<AdapterSettings />)
    expect(await screen.findByText('有効')).toBeVisible()
    expect(screen.getByText('観測口は使える状態です')).toBeVisible()
    expect(screen.getByText('最終受信: 2026-08-19T00:00:00.000Z')).toBeVisible()
    expect(screen.getByText('劣化')).toBeVisible()
    expect(screen.getByText('遅い')).toBeVisible()
    expect(screen.getByText('エラー')).toBeVisible()
    expect(screen.getByText('壊れた')).toBeVisible()
    expect(screen.getByText('更新が必要')).toBeVisible()
    expect(screen.getAllByText('根拠はまだありません').length).toBeGreaterThan(
      0,
    )
    expect(screen.getByText('利用できません')).toBeVisible()
    expect(screen.getByText('mystery')).toBeVisible()
  })

  it('shows adapter list errors', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/session')) {
        return json({ token: 't' })
      }
      return json({ error: { message: 'adapters down' } }, 500)
    })
    render(<AdapterSettings />)
    expect(await screen.findByRole('alert')).toBeVisible()
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function adapterView(input: {
  id: string
  source: string
  displayName: string
  installationStatus: string
  lastEventAt?: string | null
  health?: {
    ok: boolean
    status: string
    warnings: string[]
    errors: string[]
  } | null
}) {
  return {
    enabled: input.installationStatus === 'ready',
    lastEventAt: input.lastEventAt ?? null,
    health: input.health,
    ...input,
  }
}
