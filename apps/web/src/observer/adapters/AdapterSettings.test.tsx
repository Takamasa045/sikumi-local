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
      if (
        (url.endsWith('/install') || url.endsWith('/uninstall')) &&
        init?.method === 'POST'
      ) {
        const action = url.endsWith('/uninstall') ? 'uninstall' : 'install'
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
              message:
                action === 'uninstall'
                  ? '表示した対象から Hooks を外しました。'
                  : '表示した対象へ Hooks を書きました。',
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
            preview:
              action === 'uninstall'
                ? 'remove /Users/example/.codex/hooks.json'
                : 'create /Users/example/.codex/hooks.json',
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
  it('connects on one click and shows success without a confirm step or raw diff', async () => {
    render(<AdapterSettings />)
    expect(
      await screen.findByRole('heading', { name: '庭につなぐ道具' }),
    ).toBeVisible()
    expect(
      await screen.findByTestId('observer-adapter-codex'),
    ).toHaveTextContent('まだつながっていない')
    expect(
      screen.getByTestId('observer-adapter-claude-code'),
    ).toHaveTextContent('要確認')
    expect(screen.queryByText('観測するAIアプリ')).toBeNull()
    expect(screen.queryByText('未導入')).toBeNull()
    expect(screen.queryByRole('button', { name: '導入差分' })).toBeNull()
    expect(screen.queryByRole('button', { name: '解除差分' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'この場所につなぐ' }),
    ).toBeNull()
    expect(screen.getByText(/つなぐは任意です/)).toBeVisible()
    await userEvent.click(screen.getAllByRole('button', { name: 'つなぐ' })[0]!)
    expect(await screen.findByText('つながりました')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('くわしく見る')).toBeNull()
    expect(screen.queryByText('導入差分です')).toBeNull()
    expect(screen.queryByText(/有効とはしません/)).toBeNull()
    expect(screen.queryByText('この操作ではまだ書き込みません')).toBeNull()
    expect(
      screen.queryByText('create /Users/example/.codex/hooks.json'),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'この場所につなぐ' }),
    ).toBeNull()
    const previewCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        String(input).endsWith('/api/observer/adapters/codex/install') &&
        typeof init === 'object' &&
        init !== null &&
        'body' in init &&
        String(init.body).includes('"confirm":false')
      )
    })
    expect(previewCall).toBeTruthy()
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
  })

  it('keeps the same Claude Code repository scope on the one-click connect', async () => {
    render(<AdapterSettings />)
    expect(
      await screen.findByLabelText('Claude Code のつなぐ範囲'),
    ).toBeVisible()
    await userEvent.selectOptions(
      screen.getByLabelText('Claude Code のつなぐ範囲'),
      'repo',
    )
    await userEvent.selectOptions(
      screen.getByLabelText('Claude Code の場所'),
      'repo_1',
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'つなぐ' })[1]!)
    expect(await screen.findByText('つながりました')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'この場所につなぐ' }),
    ).toBeNull()
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

  it('offers Cursor and Grok Build connect actions with repo scope', async () => {
    render(<AdapterSettings />)
    expect(
      await screen.findByTestId('observer-adapter-cursor'),
    ).toHaveTextContent('まだつながっていない')
    expect(screen.getByTestId('observer-adapter-grok-build')).toHaveTextContent(
      'まだつながっていない',
    )
    expect(screen.getByLabelText('Cursor のつなぐ範囲')).toBeVisible()
    expect(screen.getByLabelText('Grok Build のつなぐ範囲')).toBeVisible()
    expect(screen.getByLabelText('Cursor のつなぐ範囲')).toHaveTextContent(
      'このパソコン全体',
    )
    expect(screen.getByLabelText('Cursor のつなぐ範囲')).toHaveTextContent(
      'この場所だけ',
    )
    expect(screen.getAllByRole('button', { name: 'つなぐ' })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'はずす' })).toHaveLength(5)
  })

  it('describes Claude app observation as limited self-reporting', async () => {
    render(<AdapterSettings />)
    const card = await screen.findByTestId('observer-adapter-claude-desktop')
    expect(card).toHaveTextContent('自分から知らせてくれた分だけ')
    expect(card).toHaveTextContent('全部を自動で見ることはできません')
    expect(
      screen.getByRole('button', { name: 'パッケージをつくる' }),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'パッケージをつくる' }),
    )
    expect(
      await screen.findByText(/Claude Desktop の設定から自分で入れてください/),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'このパッケージをつくる' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'この場所につなぐ' }),
    ).toBeNull()
    expect(
      screen.getByRole('link', { name: 'できたファイルを受け取る' }),
    ).toBeVisible()
  })

  it('disconnects on one click and shows はずしました', async () => {
    render(<AdapterSettings />)
    await screen.findByTestId('observer-adapter-codex')
    await userEvent.click(screen.getAllByRole('button', { name: 'はずす' })[0]!)
    expect(await screen.findByText('はずしました')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('くわしく見る')).toBeNull()
    expect(
      screen.queryByText('remove /Users/example/.codex/hooks.json'),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'この場所からはずす' }),
    ).toBeNull()
    const applyCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        String(input).endsWith('/api/observer/adapters/codex/uninstall') &&
        typeof init === 'object' &&
        init !== null &&
        'body' in init &&
        String(init.body).includes('"confirm":true')
      )
    })
    expect(applyCall).toBeTruthy()
    expect(String(applyCall?.[1]?.body)).toContain('preview-digest')
  })

  it('shows a plain-language error when connect preview fails', async () => {
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
            {
              id: 'codex',
              source: 'codex',
              displayName: 'Codex',
              enabled: false,
              installationStatus: 'not_installed',
              lastEventAt: null,
            },
          ],
        })
      }
      if (url.endsWith('/install')) {
        return json({
          result: {
            ok: false,
            changed: false,
            message: 'Hookコマンドの絶対pathが安全ではありません',
          },
        })
      }
      return json({ error: { message: 'not found' } }, 404)
    })
    render(<AdapterSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'つなぐ' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('安全な場所')
    expect(alert).toHaveClass('repository-panel__error')
    expect(screen.queryByText('つながりました')).toBeNull()
    expect(
      screen.queryByText('Hookコマンドの絶対pathが安全ではありません'),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'この場所につなぐ' }),
    ).toBeNull()
  })

  it('does not treat preview-only ok as a successful Grok Build connect', async () => {
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
            {
              id: 'grok-build',
              source: 'grok-build',
              displayName: 'Grok Build',
              enabled: false,
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
          ],
        })
      }
      if (url.endsWith('/install')) {
        return json({
          result: {
            ok: true,
            changed: false,
            applied: false,
            requiresConfirm: true,
            message: 'つなぐ準備ができました',
          },
        })
      }
      return json({ error: { message: 'not found' } }, 404)
    })
    render(<AdapterSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'つなぐ' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('つなぎ直せませんでした')
    expect(screen.queryByText('つながりました')).toBeNull()
    expect(screen.queryByText('つなぐ準備ができました')).toBeNull()
    expect(
      screen.queryByText(
        '設定は見つかりましたが、Sikumiがhook eventを受信した記録はありません',
      ),
    ).toBeNull()
  })

  it('does not show Unexpected server error when Grok Build connect fails', async () => {
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
            {
              id: 'grok-build',
              source: 'grok-build',
              displayName: 'Grok Build',
              enabled: false,
              installationStatus: 'needs_review',
              lastEventAt: null,
            },
          ],
        })
      }
      if (url.endsWith('/install')) {
        return json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unexpected server error',
            },
          },
          500,
        )
      }
      return json({ error: { message: 'not found' } }, 404)
    })
    render(<AdapterSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'つなぐ' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('つなぎ直せませんでした')
    expect(alert).not.toHaveTextContent('Unexpected server error')
    expect(screen.queryByText('つながりました')).toBeNull()
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
