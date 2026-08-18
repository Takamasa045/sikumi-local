import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RepositoryPanel } from './RepositoryPanel'

describe('RepositoryPanel', () => {
  it('asks for a local Git repository before one is registered', async () => {
    const onRegister = vi.fn()
    render(
      <RepositoryPanel
        workspace={null}
        busy={false}
        error={null}
        onRegister={onRegister}
      />,
    )

    await userEvent.type(
      screen.getByLabelText('Repositoryの場所'),
      '/Users/example/project',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'この工房に登録する' }),
    )

    expect(onRegister).toHaveBeenCalledWith('/Users/example/project')
    expect(
      screen.getByText(
        'AI社員に作業してもらいたいGitプロジェクトのフォルダを指定してください。Shikumi Local自身のフォルダではありません。',
      ),
    ).toBeVisible()
    expect(screen.getByLabelText('Repositoryの場所')).toHaveAttribute(
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
      />,
    )

    expect(screen.getByText('project')).toBeVisible()
    expect(screen.getByText('✓ Git Repository')).toBeVisible()
    expect(screen.getByText('✓ 現在のbranch: main')).toBeVisible()
    expect(screen.getByText('✓ remote: origin')).toBeVisible()
    expect(screen.getByText('✓ 読み取り可能')).toBeVisible()
  })

  it('shows fallbacks for a detached or unreadable repository', () => {
    render(
      <RepositoryPanel
        workspace={{
          id: 'ws_1',
          name: 'project',
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
        error="Git Repositoryではありません"
        onRegister={vi.fn()}
      />,
    )

    expect(screen.getByText('✓ 現在のbranch: detached')).toBeVisible()
    expect(screen.getByText('✓ remote: なし')).toBeVisible()
    expect(screen.getByText('✓ 読み取り不可')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Git Repositoryではありません',
    )
    expect(
      screen.getByRole('button', { name: 'この工房に登録する' }),
    ).toBeDisabled()
  })
})
