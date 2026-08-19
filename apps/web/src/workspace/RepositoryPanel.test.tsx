import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UNREGISTER_PLACE_CONFIRM } from './confirmUnregisterPlace'
import { RepositoryPanel } from './RepositoryPanel'

describe('RepositoryPanel', () => {
  it('asks for a local folder before one is registered', async () => {
    const onRegister = vi.fn()
    const onChooseFolder = vi.fn(async () => '/Users/example/project')
    render(
      <RepositoryPanel
        workspace={null}
        busy={false}
        error={null}
        onRegister={onRegister}
        onChooseFolder={onChooseFolder}
        onEmployeeNameChange={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'フォルダを選ぶ' }))
    expect(onChooseFolder).toHaveBeenCalled()
    expect(screen.getByLabelText('場所のパス')).toHaveValue(
      '/Users/example/project',
    )
    await userEvent.click(screen.getByRole('button', { name: 'この場所を追加' }))

    expect(onRegister).toHaveBeenCalledWith('/Users/example/project', '')
    expect(screen.getByLabelText('担当の名前（任意）')).toBeVisible()
    expect(screen.getByText(/「フォルダを選ぶ」から登録します/)).toBeVisible()
    expect(screen.getByLabelText('場所のパス')).toHaveAttribute(
      'placeholder',
      '/Users/example/Projects/my-website',
    )
  })

  it('shows inspection details after registration', () => {
    render(
      <RepositoryPanel
        workspace={{
          id: 'ws_1',
          name: 'project',
          employeeName: 'プロジェクト番',
          defaultProviderId: null,
          worldPackId: 'dog-office',
          createdAt: 't',
          updatedAt: 't',
          repository: {
            id: 'repo_1',
            absolutePath: '/Users/example/project',
            displayName: 'project',
            currentBranch: 'main',
            remoteName: 'origin',
            remoteUrl: 'https://github.com/example/project.git',
            readable: true,
          },
        }}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onUnregister={vi.fn()}
        onEmployeeNameChange={vi.fn()}
      />,
    )

    expect(screen.getByText('project')).toBeVisible()
    expect(screen.getByText('✓ Gitの場所です')).toBeVisible()
    expect(screen.getByText('✓ いまの枝: main')).toBeVisible()
    expect(screen.getByText('✓ 遠隔: origin')).toBeVisible()
    expect(screen.getByText('✓ 読み取り可能')).toBeVisible()
    expect(screen.getByDisplayValue('プロジェクト番')).toBeVisible()
    expect(screen.getByRole('button', { name: 'この場所を外す' })).toBeVisible()
  })

  it('shows fallbacks for a detached or unreadable place', () => {
    render(
      <RepositoryPanel
        workspace={{
          id: 'ws_1',
          name: 'project',
          employeeName: 'プロジェクト番',
          defaultProviderId: null,
          worldPackId: 'dog-office',
          createdAt: 't',
          updatedAt: 't',
          repository: {
            id: 'repo_1',
            absolutePath: '/Users/example/project',
            displayName: 'project',
            currentBranch: null,
            remoteName: null,
            remoteUrl: null,
            readable: false,
          },
        }}
        busy
        error="Gitの場所ではありません"
        onRegister={vi.fn()}
        onEmployeeNameChange={vi.fn()}
      />,
    )

    expect(screen.getByText('✓ いまの枝: detached')).toBeVisible()
    expect(screen.getByText('✓ 遠隔: なし')).toBeVisible()
    expect(screen.getByText('✓ 読み取り不可')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Gitの場所ではありません',
    )
    expect(
      screen.getByRole('button', { name: 'この場所を追加' }),
    ).toBeDisabled()
  })

  it('登録済み工房の担当名を変更できる', async () => {
    const onEmployeeNameChange = vi.fn()
    render(
      <RepositoryPanel
        workspace={{
          id: 'ws_1',
          name: 'blog-agent-kit',
          employeeName: 'ブログ番',
          defaultProviderId: null,
          worldPackId: 'dog-office',
          createdAt: 't',
          updatedAt: 't',
          repository: {
            id: 'repo_1',
            absolutePath: '/Users/example/blog-agent-kit',
            displayName: 'blog-agent-kit',
            currentBranch: 'main',
            remoteName: 'origin',
            remoteUrl: null,
            readable: true,
          },
        }}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onEmployeeNameChange={onEmployeeNameChange}
      />,
    )

    const input = screen.getByLabelText('担当の名前')
    await userEvent.clear(input)
    await userEvent.type(input, 'イトパン')
    await userEvent.click(
      screen.getByRole('button', { name: '担当の名前を保存' }),
    )
    expect(onEmployeeNameChange).toHaveBeenCalledWith('イトパン')
  })

  it('asks before unregistering a place', async () => {
    const onUnregister = vi.fn()
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(
      <RepositoryPanel
        workspace={{
          id: 'ws_1',
          name: 'project',
          employeeName: 'プロジェクト番',
          defaultProviderId: null,
          worldPackId: 'dog-office',
          createdAt: 't',
          updatedAt: 't',
          repository: {
            id: 'repo_1',
            absolutePath: '/Users/example/project',
            displayName: 'project',
            currentBranch: 'main',
            remoteName: 'origin',
            remoteUrl: null,
            readable: true,
          },
        }}
        busy={false}
        error={null}
        onRegister={vi.fn()}
        onUnregister={onUnregister}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'この場所を外す' }))
    expect(window.confirm).toHaveBeenCalledWith(UNREGISTER_PLACE_CONFIRM)
    expect(onUnregister).toHaveBeenCalledWith('ws_1')
    vi.unstubAllGlobals()
  })
})
