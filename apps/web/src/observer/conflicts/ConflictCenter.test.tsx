import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConflictCenter } from './ConflictCenter'

const sample = {
  id: 'cnf_1',
  repositoryId: 'repo_1',
  repositoryDisplayName: 'sikumi',
  leftSource: 'codex',
  rightSource: 'cursor',
  leftAttributionConfidence: 'verified',
  rightAttributionConfidence: 'verified',
  leftActorLabel: 'Codex',
  rightActorLabel: 'Cursor',
  level: 'high',
  score: 82,
  headline: '🔴 同じ仕組みを変更しています',
  summary: '🔴 CodexとCursorが同じユーザー情報ファイルを変更しています',
  recommendation:
    '先に一方を仕上げてください。こちらから自動では取り込みません。',
  reasons: ['同じファイル（ユーザー情報）を両方とも変更しています'],
  evidence: [{ kind: 'same-file', label: '同じファイル' }],
  status: 'open',
  technical: {
    leftBranch: 'main',
    rightBranch: 'feature',
    leftWorktreePath: '/repo',
    rightWorktreePath: '/repo-wt',
    leftHead: 'aaa111',
    rightHead: 'bbb222',
    commonBase: 'abc123',
    changedPaths: ['src/users.ts'],
  },
}

describe('ConflictCenter', () => {
  it('filters, shows easy mode first, and exposes accessible actions', async () => {
    const onFilterChange = vi.fn()
    const onAcknowledge = vi.fn()
    const onToggleTechnical = vi.fn()
    render(
      <ConflictCenter
        conflicts={[sample]}
        counts={{ red: 1, orange: 0, yellow: 0 }}
        repositories={[{ id: 'repo_1', name: 'sikumi' }]}
        selectedId="cnf_1"
        detail={sample}
        showTechnical={false}
        busy={false}
        error={null}
        filters={{
          repositoryId: '',
          source: '',
          level: '',
          unconfirmed: false,
        }}
        onFilterChange={onFilterChange}
        onSelect={vi.fn()}
        onToggleTechnical={onToggleTechnical}
        onAcknowledge={onAcknowledge}
        onResolve={vi.fn()}
        onRecheck={vi.fn()}
        onBack={vi.fn()}
      />,
    )

    expect(screen.getByTestId('conflict-counts')).toHaveTextContent('🔴 1')
    expect(screen.getByLabelText('Repository')).toBeVisible()
    expect(screen.getByLabelText('AIアプリ')).toBeVisible()
    expect(screen.getByLabelText('危険度')).toBeVisible()
    expect(screen.getByLabelText('未確認のみ')).toBeVisible()
    expect(screen.queryByText('src/users.ts')).toBeNull()
    expect(screen.getByText(/自動では取り込みません/)).toBeVisible()

    await userEvent.selectOptions(screen.getByLabelText('AIアプリ'), 'codex')
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'codex' }),
    )
    await userEvent.click(screen.getByLabelText('未確認のみ'))
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ unconfirmed: true }),
    )
    await userEvent.click(screen.getByRole('button', { name: '確認した' }))
    expect(onAcknowledge).toHaveBeenCalledWith('cnf_1')
    await userEvent.click(
      screen.getByRole('button', { name: '技術の詳細を見る' }),
    )
    expect(onToggleTechnical).toHaveBeenCalled()
  })

  it('shows technical details only when asked and keeps action names', () => {
    render(
      <ConflictCenter
        conflicts={[sample]}
        counts={{ red: 1, orange: 2, yellow: 4 }}
        repositories={[{ id: 'repo_1', name: 'sikumi' }]}
        selectedId="cnf_1"
        detail={sample}
        showTechnical
        busy
        error="確認できませんでした"
        filters={{
          repositoryId: 'repo_1',
          source: 'codex',
          level: 'high',
          unconfirmed: true,
        }}
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onResolve={vi.fn()}
        onRecheck={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('src/users.ts')).toBeVisible()
    expect(screen.getByText('abc123')).toBeVisible()
    expect(screen.getByText('aaa111 / bbb222')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('確認できませんでした')
    expect(
      screen.getByRole('button', { name: 'もう重なっていない' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'いまの状態を確認' }),
    ).toBeDisabled()
  })

  it('Scenario E: names only the verified side and keeps simple mode path-free', () => {
    render(
      <ConflictCenter
        conflicts={[
          {
            ...sample,
            leftActorLabel: 'Codex',
            rightActorLabel: '変更元不明',
            leftAttributionConfidence: 'verified',
            rightAttributionConfidence: 'correlated',
            summary:
              '🔴 Codexと変更元不明が同じユーザー情報ファイルを変更しています',
          },
        ]}
        counts={{ red: 1, orange: 0, yellow: 0 }}
        repositories={[{ id: 'repo_1', name: 'sikumi' }]}
        selectedId="cnf_1"
        detail={{
          ...sample,
          leftActorLabel: 'Codex',
          rightActorLabel: '変更元不明',
          leftAttributionConfidence: 'verified',
          rightAttributionConfidence: 'correlated',
          summary:
            '🔴 Codexと変更元不明が同じユーザー情報ファイルを変更しています',
          technical: undefined,
        }}
        showTechnical={false}
        busy={false}
        error={null}
        filters={{
          repositoryId: '',
          source: 'cursor',
          level: '',
          unconfirmed: false,
        }}
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onResolve={vi.fn()}
        onRecheck={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('関係する作業: Codex / 変更元不明')).toBeVisible()
    expect(screen.queryByText('関係する作業: Codex / Cursor')).toBeNull()
    expect(screen.queryByText('src/users.ts')).toBeNull()
    expect(screen.queryByText('/repo')).toBeNull()
  })

  it('falls back to 変更元不明 when source is present but that side is not verified', () => {
    render(
      <ConflictCenter
        conflicts={[
          { ...sample, leftActorLabel: undefined, rightActorLabel: undefined },
        ]}
        counts={{ red: 1, orange: 0, yellow: 0 }}
        repositories={[{ id: 'repo_1', name: 'sikumi' }]}
        selectedId="cnf_1"
        detail={{
          ...sample,
          leftSource: 'codex',
          rightSource: 'cursor',
          leftActorLabel: undefined,
          rightActorLabel: undefined,
          leftAttributionConfidence: 'verified',
          rightAttributionConfidence: 'correlated',
        }}
        showTechnical={false}
        busy={false}
        error={null}
        filters={{
          repositoryId: '',
          source: '',
          level: '',
          unconfirmed: false,
        }}
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onResolve={vi.fn()}
        onRecheck={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('関係する作業: Codex / 変更元不明')).toBeVisible()
  })

  it('keeps git-only conflicts unnamed and maps unknown merge-base to 不明', () => {
    render(
      <ConflictCenter
        conflicts={[sample]}
        counts={{ red: 1, orange: 0, yellow: 0 }}
        repositories={[{ id: 'repo_1', name: 'sikumi' }]}
        selectedId="cnf_1"
        detail={{
          ...sample,
          leftSource: 'git',
          rightSource: 'git',
          leftActorLabel: '変更元不明',
          rightActorLabel: '変更元不明',
          leftAttributionConfidence: 'inferred',
          rightAttributionConfidence: 'inferred',
          summary:
            '🔴 変更元不明の2つの作業が同じユーザー情報ファイルを変更しています',
          technical: {
            ...sample.technical,
            commonBase: 'unknown',
          },
        }}
        showTechnical
        busy={false}
        error={null}
        filters={{
          repositoryId: '',
          source: '',
          level: '',
          unconfirmed: false,
        }}
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onResolve={vi.fn()}
        onRecheck={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    const detail = within(screen.getByLabelText('衝突の詳細'))
    expect(
      detail.getByText('関係する作業: 変更元不明 / 変更元不明'),
    ).toBeVisible()
    expect(detail.queryByText('Codex')).toBeNull()
    expect(detail.queryByText('unknown')).toBeNull()
    expect(detail.getByText('不明')).toBeVisible()
  })

  it('labels statuses, source names, and remaining danger tones', async () => {
    const onFilterChange = vi.fn()
    const onResolve = vi.fn()
    const onRecheck = vi.fn()
    const onBack = vi.fn()
    const onSelect = vi.fn()
    render(
      <ConflictCenter
        conflicts={[
          {
            ...sample,
            id: 'cnf_ack',
            status: 'acknowledged',
            level: 'caution',
            headline: undefined,
            leftSource: 'claude-code',
            rightSource: 'grok-build',
            leftActorLabel: 'Claude Code',
            rightActorLabel: 'Grok Build',
            leftAttributionConfidence: 'verified',
            rightAttributionConfidence: 'verified',
          },
          {
            ...sample,
            id: 'cnf_res',
            status: 'resolved',
            level: 'related',
            leftSource: 'claude-desktop',
            rightSource: 'codex',
            leftActorLabel: 'Claudeアプリ',
            rightActorLabel: 'Codex',
            leftAttributionConfidence: 'verified',
            rightAttributionConfidence: 'verified',
          },
        ]}
        counts={{ red: 0, orange: 1, yellow: 1 }}
        repositories={[{ id: 'repo_1', name: 'sikumi' }]}
        selectedId="cnf_ack"
        detail={null}
        showTechnical={false}
        busy={false}
        error={null}
        filters={{
          repositoryId: '',
          source: '',
          level: '',
          unconfirmed: false,
        }}
        onFilterChange={onFilterChange}
        onSelect={onSelect}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onResolve={onResolve}
        onRecheck={onRecheck}
        onBack={onBack}
      />,
    )
    expect(screen.getByText('確認済み')).toBeVisible()
    expect(screen.getByText('解消')).toBeVisible()
    expect(screen.getByText('🟠 完了順を調整した方が安全です')).toBeVisible()
    await userEvent.selectOptions(screen.getByLabelText('Repository'), 'repo_1')
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 'repo_1' }),
    )
    await userEvent.selectOptions(screen.getByLabelText('危険度'), 'caution')
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'caution' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'もう重なっていない' }),
    )
    expect(onResolve).toHaveBeenCalledWith('cnf_ack')
    await userEvent.click(
      screen.getByRole('button', { name: 'いまの状態を確認' }),
    )
    expect(onRecheck).toHaveBeenCalledWith('cnf_ack')
    await userEvent.click(
      screen.getByRole('button', { name: '今日の作業場へ戻る' }),
    )
    expect(onBack).toHaveBeenCalled()
    await userEvent.click(
      screen.getAllByRole('button', { name: '詳しく見る' })[0]!,
    )
    expect(onSelect).toHaveBeenCalled()
  })

  it('shows an empty conflict list without a selected detail', () => {
    render(
      <ConflictCenter
        conflicts={[]}
        counts={{ red: 0, orange: 0, yellow: 0 }}
        repositories={[]}
        selectedId={null}
        detail={null}
        showTechnical={false}
        busy={false}
        error={null}
        filters={{
          repositoryId: '',
          source: '',
          level: '',
          unconfirmed: false,
        }}
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onToggleTechnical={vi.fn()}
        onAcknowledge={vi.fn()}
        onResolve={vi.fn()}
        onRecheck={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('heading', { name: '何がぶつかりそうか' }),
    ).toBeVisible()
  })
})
