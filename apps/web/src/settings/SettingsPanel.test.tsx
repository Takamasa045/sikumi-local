import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
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
})
