import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/observer/adapters')) {
        return new Response(JSON.stringify({ adapters: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: 'not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SettingsPanel', () => {
  it('keeps folder registration in front and hides hook install until asked', () => {
    render(
      <SettingsPanel
        workspace={null}
        providers={[]}
        busy={false}
        error={null}
        onRegister={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('region', { name: 'Repository登録' }),
    ).toBeVisible()
    expect(
      screen.getByText(/今日の作業場でフォルダを登録すれば十分/),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: '庭につなぐ道具' })).toBeNull()
    expect(screen.queryAllByRole('button', { name: 'つなぐ' })).toHaveLength(0)
    expect(screen.getByText('つなぐ（任意）')).toBeVisible()
  })

  it('does not present the garden as a labs or legacy screen', () => {
    render(
      <SettingsPanel
        workspace={null}
        providers={[]}
        busy={false}
        error={null}
        onRegister={vi.fn()}
      />,
    )
    expect(screen.queryByText('Labs')).not.toBeInTheDocument()
    expect(screen.queryByText('以前の実行画面')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Legacy Executionを開く' }),
    ).not.toBeInTheDocument()
  })

  it('lets the user change the workshop default tool', async () => {
    const onChange = vi.fn()
    render(
      <SettingsPanel
        workspace={{
          id: 'ws_1',
          name: 'my-project',
          defaultProviderId: null,
          worldPackId: 'dog-office',
          createdAt: 't',
          updatedAt: 't',
          repository: {
            id: 'repo_1',
            absolutePath: '/tmp/project',
            displayName: 'my-project',
            currentBranch: 'main',
            remoteName: 'origin',
            remoteUrl: null,
            readable: true,
          },
        }}
        providers={[
          {
            id: 'codex',
            displayName: 'Codex',
            executionConnected: false,
            installed: false,
            authenticated: false,
            status: 'not_installed',
            capabilities: [],
          },
        ]}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onWorkspaceProviderChange={onChange}
      />,
    )
    await userEvent.selectOptions(
      screen.getByLabelText('この工房の標準の道具'),
      'codex',
    )
    expect(onChange).toHaveBeenCalledWith('codex')
  })

  it('shows the provider status panel and forwards recheck', async () => {
    const onRecheck = vi.fn()
    render(
      <SettingsPanel
        workspace={null}
        providers={[
          {
            id: 'codex',
            displayName: 'Codex',
            executionConnected: true,
            installed: true,
            authenticated: true,
            status: 'ready',
            capabilities: [],
          },
        ]}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        providerLoadState="ready"
        onRecheckProvider={onRecheck}
      />,
    )
    expect(screen.getByTestId('provider-status-panel')).toHaveTextContent(
      '使えます',
    )
    await userEvent.click(screen.getAllByRole('button', { name: '再確認' })[0]!)
    expect(onRecheck).toHaveBeenCalledWith('codex')
  })

  it('shows a pack trust screen before install', async () => {
    const onPreview = vi.fn()
    const onInstall = vi.fn()
    render(
      <SettingsPanel
        workspace={null}
        providers={[]}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onPreviewPack={onPreview}
        onInstallPack={onInstall}
        packPreview={{
          id: 'prev_1',
          packId: 'miru',
          version: '1.0.0',
          sourceKind: 'folder',
          sourceDisplay: 'miru',
          validation: { ok: true, errors: [] },
          fileSummary: { files: 4, names: ['employee.yaml'] },
          gitCommit: null,
          gitChanges: null,
        }}
      />,
    )
    expect(screen.getByTestId('pack-trust')).toHaveTextContent('miru')
    await userEvent.click(
      screen.getByRole('button', { name: 'このPackを導入する' }),
    )
    expect(onInstall).toHaveBeenCalled()
  })

  it('previews a local pack and uninstalls an installed one', async () => {
    const onPreview = vi.fn()
    const onUninstall = vi.fn()
    render(
      <SettingsPanel
        workspace={null}
        providers={[]}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onPreviewPack={onPreview}
        onUninstallPack={onUninstall}
        packs={[
          {
            id: 'p1',
            kind: 'employee',
            packId: 'miru',
            version: '1.0.0',
            sourcePath: null,
            sourceKind: 'folder',
            sourceDisplay: 'miru',
            commitHash: null,
            builtin: false,
            installedAt: 't',
          },
          {
            id: 'p2',
            kind: 'employee',
            packId: 'saguru',
            version: '1.0.0',
            sourcePath: null,
            sourceKind: 'builtin',
            sourceDisplay: 'builtin',
            commitHash: null,
            builtin: true,
            installedAt: 't',
          },
        ]}
        packPreview={{
          id: 'prev_1',
          packId: 'night-garden',
          version: '1.0.0',
          sourceKind: 'git',
          sourceDisplay: 'local git repository',
          validation: { ok: false, errors: ['too old'] },
          fileSummary: { files: 1, names: ['world.yaml'] },
          gitCommit: 'abcdef123456',
          gitChanges: 'add world',
        }}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('Packの入手元'), 'git')
    await userEvent.type(screen.getByLabelText('Packの場所'), '/tmp/pack')
    await userEvent.type(
      screen.getByLabelText('PackのGit URL'),
      'file:///tmp/pack.git',
    )
    await userEvent.click(
      screen.getByRole('button', { name: '確認画面を開く' }),
    )
    expect(onPreview).toHaveBeenCalledWith({
      sourceType: 'git',
      path: '/tmp/pack',
      gitUrl: 'file:///tmp/pack.git',
    })
    expect(screen.getByTestId('pack-trust')).toHaveTextContent('too old')
    expect(screen.getByTestId('pack-trust')).toHaveTextContent('abcdef123456')
    await userEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(onUninstall).toHaveBeenCalledWith('p1')
  })
})
