import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderAvailability } from '../api/providers'
import { ProviderStatusPanel } from './ProviderStatusPanel'

describe('ProviderStatusPanel', () => {
  it('shows a ready engine by display name', () => {
    render(
      <ProviderStatusPanel
        providers={[
          availability('codex', 'Codex', {
            status: 'ready',
            connected: true,
            installed: true,
            authenticated: true,
          }),
        ]}
        loadState="ready"
        onRecheck={vi.fn()}
      />,
    )
    expect(screen.getByText('Codex')).toBeVisible()
    expect(screen.getByText('使えます')).toBeVisible()
    expect(screen.queryByText('fake')).not.toBeInTheDocument()
    expect(screen.queryByText('開発用ハーネス')).not.toBeInTheDocument()
  })

  it('explains login required, not installed, and disconnected states', () => {
    render(
      <ProviderStatusPanel
        providers={[
          availability('codex', 'Codex', {
            status: 'login_required',
            installed: true,
          }),
          availability('grok-build', 'Grok Build', {
            status: 'not_installed',
          }),
          availability('claude-code', 'Claude Code', {
            status: 'disconnected',
            installed: true,
            authenticated: true,
          }),
        ]}
        loadState="ready"
        onRecheck={vi.fn()}
      />,
    )
    expect(screen.getByText('ログインが必要')).toBeVisible()
    expect(screen.getByText('未インストール')).toBeVisible()
    expect(screen.getByText('つながっていません')).toBeVisible()
    expect(
      screen.getByText(
        /ターミナルでこのCLIを一度起動し、ログインを完了してください/,
      ),
    ).toBeVisible()
    expect(screen.getByText('codex login')).toBeVisible()
  })

  it('shows cannot confirm when the catalog cannot be loaded', () => {
    render(
      <ProviderStatusPanel
        providers={[]}
        loadState="error"
        probeError="再確認に失敗しました"
        onRecheck={vi.fn()}
      />,
    )
    expect(screen.getByTestId('provider-probe-error')).toHaveTextContent(
      '再確認に失敗しました',
    )
    expect(screen.getAllByText('確認できません').length).toBeGreaterThan(0)
  })

  it('rechecks a provider and never lists the fake harness', async () => {
    const onRecheck = vi.fn()
    render(
      <ProviderStatusPanel
        providers={[
          availability('codex', 'Codex', { status: 'not_installed' }),
        ]}
        loadState="ready"
        onRecheck={onRecheck}
      />,
    )
    expect(screen.getAllByRole('button', { name: '再確認' })).toHaveLength(3)
    await userEvent.click(screen.getAllByRole('button', { name: '再確認' })[0]!)
    expect(onRecheck).toHaveBeenCalledWith('codex')
    expect(screen.queryByText(/fake/i)).not.toBeInTheDocument()
  })
})

function availability(
  id: ProviderAvailability['id'],
  displayName: string,
  options: {
    readonly status: ProviderAvailability['status']
    readonly connected?: boolean
    readonly installed?: boolean
    readonly authenticated?: boolean
  },
): ProviderAvailability {
  return {
    id,
    displayName,
    executionConnected: options.connected ?? false,
    installed: options.installed ?? false,
    authenticated: options.authenticated ?? false,
    status: options.status,
    capabilities: [],
  }
}
