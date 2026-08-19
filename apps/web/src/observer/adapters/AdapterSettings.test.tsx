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
  it('shows a preview first and only applies after explicit confirm with the digest', async () => {
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
    expect(screen.getByText(/一度つなぎます/)).toBeVisible()
    await userEvent.click(screen.getAllByRole('button', { name: 'つなぐ' })[0]!)
    expect(
      await screen.findByText(
        /このパソコン全体で、Codex が庭に様子を知らせるようにします/,
      ),
    ).toBeVisible()
    const details = screen.getByText('くわしく見る').closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('create /Users/example/.codex/hooks.json')
    expect(details).toHaveTextContent('この操作ではまだ書き込みません')
    const apply = await screen.findByRole('button', {
      name: 'この場所につなぐ',
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
      await screen.findByText(/Codex が庭に様子を知らせるようになりました/),
    ).toBeVisible()
  })

  it('keeps the same Claude Code repository scope on preview and apply', async () => {
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
    expect(
      await screen.findByText(
        /demo-repo だけで、Claude Code が庭に様子を知らせるようにします/,
      ),
    ).toBeVisible()
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
      await screen.findByRole('button', { name: 'この場所につなぐ' }),
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
      await screen.findByRole('button', { name: 'このパッケージをつくる' }),
    ).toBeVisible()
    expect(
      screen.getByText(/Claude Desktop の設定から自分で入れてください/),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'この場所につなぐ' }),
    ).toBeNull()
  })

  it('previews and applies uninstall with the same digest flow', async () => {
    render(<AdapterSettings />)
    await screen.findByTestId('observer-adapter-codex')
    await userEvent.click(screen.getAllByRole('button', { name: 'はずす' })[0]!)
    expect(
      await screen.findByText(
        /このパソコン全体で、Codex から庭への知らせをやめます/,
      ),
    ).toBeVisible()
    const details = screen.getByText('くわしく見る').closest('details')
    expect(details).toHaveTextContent('remove /Users/example/.codex/hooks.json')
    await userEvent.click(
      await screen.findByRole('button', { name: 'この場所からはずす' }),
    )
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
    expect(
      await screen.findByText(/Codex から庭への知らせをやめました/),
    ).toBeVisible()
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
