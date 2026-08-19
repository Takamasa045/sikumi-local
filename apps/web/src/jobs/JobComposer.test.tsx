import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EmployeeSummary } from '@sikumi-local/core'
import { JobComposer, statusLabel } from './JobComposer'
import type { ProviderAvailability } from '../api/providers'

const employee: EmployeeSummary = {
  id: 'saguru',
  packId: 'saguru',
  name: 'サグル',
  role: '調査担当',
  defaultProviderId: null,
  createdAt: 't',
  updatedAt: 't',
  description: '調査',
  version: '1.0.0',
  permissionProfile: 'research',
  supportedJobTypes: ['research'],
  defaultProviderOrder: ['codex'],
  requiredProviderCapabilities: ['streaming'],
  character: 'saguru-default',
  source: 'builtin',
}

describe('JobComposer', () => {
  it('依頼の開始失敗を操作箇所に表示する', () => {
    render(
      <JobComposer
        enabled
        busy={false}
        request="調べて"
        notice="notice"
        error="Grok protocol handshake failed"
        employeeName="ブログ番"
        employees={[employee]}
        selectedEmployeeId="saguru"
        providers={[provider('grok-build', 'ready')]}
        selectedProvider="grok-build"
        onRequestChange={vi.fn()}
        onEmployeeChange={vi.fn()}
        onProviderChange={vi.fn()}
        onSubmit={vi.fn()}
        onConfirmFallback={vi.fn()}
        onCancelConfirmation={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'ブログ番に何を頼みますか' }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Grok protocol handshake failed',
    )
  })

  it('offers explicit dirty-repo worktree choices', async () => {
    const onDirty = vi.fn()
    render(
      <JobComposer
        enabled
        busy={false}
        request="直して"
        notice="notice"
        employees={[employee]}
        selectedEmployeeId="saguru"
        providers={[provider('codex', 'ready')]}
        selectedProvider="codex"
        dirtyRepo={{
          message: '現在の作業ディレクトリに未commitの変更があります',
        }}
        onRequestChange={vi.fn()}
        onEmployeeChange={vi.fn()}
        onProviderChange={vi.fn()}
        onSubmit={vi.fn()}
        onConfirmFallback={vi.fn()}
        onCancelConfirmation={vi.fn()}
        onDirtyPolicy={onDirty}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'HEADから新しいWorktreeを作る' }),
    )
    await userEvent.click(
      screen.getByRole('button', {
        name: '現在の差分を一時Patchとして含める',
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: '中止' }))
    expect(onDirty).toHaveBeenCalledWith('from-head')
    expect(onDirty).toHaveBeenCalledWith('include-dirty-patch')
    expect(onDirty).toHaveBeenCalledWith('cancel')
  })

  it('describes provider status and confirms a fallback tool', async () => {
    const onConfirm = vi.fn()
    render(
      <JobComposer
        enabled
        busy={false}
        request="調べて"
        notice="notice"
        employees={[employee]}
        selectedEmployeeId="saguru"
        providers={[
          provider('codex', 'ready'),
          provider('grok-build', 'login_required'),
          provider('claude-code', 'not_installed'),
        ]}
        selectedProvider="codex"
        dirtyRepo={{
          message: '現在の作業ディレクトリに未commitの変更があります',
        }}
        confirmation={{
          message: 'Codexを起動できませんでした。別の道具で始めますか？',
          alternatives: ['grok-build'],
        }}
        onRequestChange={vi.fn()}
        onEmployeeChange={vi.fn()}
        onProviderChange={vi.fn()}
        onSubmit={vi.fn()}
        onConfirmFallback={onConfirm}
        onCancelConfirmation={vi.fn()}
        onDirtyPolicy={vi.fn()}
      />,
    )
    expect(
      screen.getByText('現在の作業ディレクトリに未commitの変更があります'),
    ).toBeVisible()
    expect(screen.getByText(/使用できます/)).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Grok Buildで始める' }),
    )
    expect(onConfirm).toHaveBeenCalledWith('grok-build')
  })

  it('labels capability mismatch and disconnected tools', () => {
    expect(
      statusLabel(
        {
          ...provider('codex', 'capability_mismatch'),
          installed: true,
          capabilities: ['streaming'],
        },
        {
          ...employee,
          requiredProviderCapabilities: ['streaming', 'sessionResume'],
        },
      ),
    ).toBe('この仕事に必要な権限へ対応していません')
    expect(statusLabel(provider('codex', 'disconnected'))).toBe(
      '実行エンジン未接続',
    )
    expect(
      statusLabel({
        ...provider('codex', 'disconnected'),
        executionConnected: true,
      }),
    ).toBe('使用できます')
  })

  it('submits a request and maps remaining composer branches', async () => {
    const onSubmit = vi.fn()
    const onProvider = vi.fn()
    const onEmployee = vi.fn()
    const onCancel = vi.fn()
    render(
      <JobComposer
        enabled
        busy={false}
        request="調べて"
        notice="notice"
        employees={[]}
        selectedEmployeeId=""
        providers={[provider('claude-code', 'ready')]}
        selectedProvider="auto"
        confirmation={{
          message: '別の道具で始めますか？',
          alternatives: ['claude-code'],
        }}
        onRequestChange={vi.fn()}
        onEmployeeChange={onEmployee}
        onProviderChange={onProvider}
        onSubmit={onSubmit}
        onConfirmFallback={vi.fn()}
        onCancelConfirmation={onCancel}
      />,
    )
    expect(
      screen.getByRole('heading', { name: '誰に頼みますか' }),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '中止' }))
    expect(onCancel).toHaveBeenCalled()
    await userEvent.selectOptions(screen.getByLabelText('道具'), 'claude-code')
    expect(onProvider).toHaveBeenCalledWith('claude-code')
    await userEvent.selectOptions(screen.getByLabelText('道具'), 'auto')
    expect(onProvider).toHaveBeenCalledWith('auto')
    await userEvent.click(screen.getByRole('button', { name: '仕事を頼む' }))
    expect(onSubmit).toHaveBeenCalledWith('調べて')
  })
})

function provider(
  id: ProviderAvailability['id'],
  status: ProviderAvailability['status'],
): ProviderAvailability {
  return {
    id,
    displayName:
      id === 'codex'
        ? 'Codex'
        : id === 'grok-build'
          ? 'Grok Build'
          : 'Claude Code',
    executionConnected: status === 'ready',
    installed: status !== 'not_installed',
    authenticated: status !== 'login_required',
    status,
    capabilities: status === 'ready' ? ['streaming'] : [],
  }
}
