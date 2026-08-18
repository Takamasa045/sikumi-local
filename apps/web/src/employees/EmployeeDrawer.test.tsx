import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeDrawer } from './EmployeeDrawer'

describe('EmployeeDrawer', () => {
  it('shows recent jobs and updates the default tool', async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <EmployeeDrawer
        employee={{
          id: 'saguru',
          packId: 'saguru',
          name: 'サグル',
          role: '調査担当',
          defaultProviderId: null,
          createdAt: 't',
          updatedAt: 't',
          description: '調査担当です',
          version: '1.0.0',
          permissionProfile: 'research',
          supportedJobTypes: ['research'],
          defaultProviderOrder: ['codex'],
          requiredProviderCapabilities: ['streaming'],
          character: 'saguru-default',
          source: 'builtin',
        }}
        recentJobs={[
          {
            id: 'job_1',
            workspaceId: 'ws_1',
            employeeId: 'saguru',
            request: '構成を調べて',
            jobType: 'research',
            selectedProvider: 'fake',
            selectedModel: null,
            permissionProfile: 'research',
            status: 'completed',
            providerSessionId: null,
            createdAt: 't',
            startedAt: 't',
            completedAt: 't',
          },
        ]}
        providers={[
          {
            id: 'codex',
            displayName: 'Codex',
            executionConnected: true,
            installed: true,
            authenticated: true,
            status: 'ready',
            capabilities: ['streaming'],
          },
        ]}
        open
        busy={false}
        onClose={onClose}
        onDefaultProviderChange={onChange}
      />,
    )
    expect(screen.getByText('構成を調べて')).toBeVisible()
    await userEvent.selectOptions(screen.getByLabelText('標準の道具'), 'codex')
    expect(onChange).toHaveBeenCalledWith('codex')
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <EmployeeDrawer
        employee={null}
        recentJobs={[]}
        providers={[]}
        open={false}
        busy={false}
        onClose={vi.fn()}
        onDefaultProviderChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
