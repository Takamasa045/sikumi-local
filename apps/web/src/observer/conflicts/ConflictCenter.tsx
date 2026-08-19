import { useMemo } from 'react'
import type { ConflictView } from '../../api/observer'

export interface ConflictCenterProps {
  readonly conflicts: readonly ConflictView[]
  readonly counts: { readonly red: number; readonly orange: number; readonly yellow: number }
  readonly repositories: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly selectedId: string | null
  readonly detail: ConflictView | null
  readonly showTechnical: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly filters: {
    readonly repositoryId: string
    readonly source: string
    readonly level: string
    readonly unconfirmed: boolean
  }
  readonly onFilterChange: (next: ConflictCenterProps['filters']) => void
  readonly onSelect: (id: string) => void
  readonly onToggleTechnical: () => void
  readonly onAcknowledge: (id: string) => void
  readonly onResolve: (id: string) => void
  readonly onRecheck: (id: string) => void
  readonly onBack: () => void
}

const SOURCE_OPTIONS = [
  { value: '', label: 'すべてのAIアプリ' },
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'grok-build', label: 'Grok Build' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude-desktop', label: 'Claudeアプリ' },
  { value: 'git', label: '変更元不明' },
]

const LEVEL_OPTIONS = [
  { value: '', label: 'すべての危険度' },
  { value: 'critical', label: '重大' },
  { value: 'high', label: '強い注意' },
  { value: 'caution', label: '調整推奨' },
  { value: 'related', label: '関連あり' },
]

export function ConflictCenter({
  conflicts,
  counts,
  repositories,
  selectedId,
  detail,
  showTechnical,
  busy,
  error,
  filters,
  onFilterChange,
  onSelect,
  onToggleTechnical,
  onAcknowledge,
  onResolve,
  onRecheck,
  onBack,
}: ConflictCenterProps) {
  const selected = detail ?? conflicts.find((item) => item.id === selectedId) ?? null
  const actors = useMemo(() => actorLabels(selected), [selected])

  return (
    <section className="observer-detail conflict-center" aria-label="衝突・関連の可能性">
      <p className="section-kicker">衝突・関連の可能性</p>
      <h2>何がぶつかりそうか</h2>
      <p>
        ここは提案だけです。自動では取り込みも書き換えもしません。数字より、色とことばを見てください。
      </p>

      <div className="observer-stats" data-testid="conflict-counts">
        <span>🔴 {counts.red}</span>
        <span>🟠 {counts.orange}</span>
        <span>🟡 {counts.yellow}</span>
      </div>

      <form className="conflict-filters" aria-label="衝突の絞り込み">
        <label>
          <span>Repository</span>
          <select
            aria-label="Repository"
            value={filters.repositoryId}
            disabled={busy}
            onChange={(event) =>
              onFilterChange({ ...filters, repositoryId: event.target.value })
            }
          >
            <option value="">すべての場所</option>
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>AIアプリ</span>
          <select
            aria-label="AIアプリ"
            value={filters.source}
            disabled={busy}
            onChange={(event) =>
              onFilterChange({ ...filters, source: event.target.value })
            }
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>危険度</span>
          <select
            aria-label="危険度"
            value={filters.level}
            disabled={busy}
            onChange={(event) =>
              onFilterChange({ ...filters, level: event.target.value })
            }
          >
            {LEVEL_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="conflict-filters__check">
          <input
            type="checkbox"
            checked={filters.unconfirmed}
            disabled={busy}
            onChange={(event) =>
              onFilterChange({ ...filters, unconfirmed: event.target.checked })
            }
          />
          未確認のみ
        </label>
      </form>

      {error ? (
        <p className="repository-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="conflict-layout" aria-busy={busy}>
        <ul className="conflict-list">
          {conflicts.length === 0 ? (
            <li>いま重なっている作業は見当たりません。</li>
          ) : (
            conflicts.map((conflict) => (
              <li key={conflict.id}>
                <article
                  className={
                    conflict.id === selectedId
                      ? 'observer-card is-selected'
                      : 'observer-card'
                  }
                >
                  <header>
                    <strong>{conflict.headline ?? toneFor(conflict.level)}</strong>
                    <span>{statusLabel(conflict.status)}</span>
                  </header>
                  <p>{conflict.summary}</p>
                  <p>{conflict.repositoryDisplayName}</p>
                  <button
                    type="button"
                    className="washi-tab"
                    onClick={() => onSelect(conflict.id)}
                  >
                    詳しく見る
                  </button>
                </article>
              </li>
            ))
          )}
        </ul>

        {selected ? (
          <article className="observer-card" aria-label="衝突の詳細">
            <h3>{selected.headline ?? selected.summary}</h3>
            <p>{selected.summary}</p>
            <p>関係する作業: {actors.join(' / ')}</p>
            {selected.reasons && selected.reasons.length > 0 ? (
              <ul>
                {selected.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            <p>おすすめ: {selected.recommendation}</p>
            <p>状態: {statusLabel(selected.status)}</p>
            <p>
              <small>参考の強さ {selected.score}。ことばの色を優先してください。</small>
            </p>
            <button
              type="button"
              className="washi-tab"
              aria-expanded={showTechnical}
              onClick={onToggleTechnical}
            >
              {showTechnical ? 'かんたん表示' : '技術の詳細を見る'}
            </button>
            {showTechnical && selected.technical ? (
              <dl className="conflict-technical">
                <div>
                  <dt>branch</dt>
                  <dd>
                    {selected.technical.leftBranch ?? '不明'} /{' '}
                    {selected.technical.rightBranch ?? '不明'}
                  </dd>
                </div>
                <div>
                  <dt>worktree</dt>
                  <dd>
                    {selected.technical.leftWorktreePath ?? '不明'} /{' '}
                    {selected.technical.rightWorktreePath ?? '不明'}
                  </dd>
                </div>
                <div>
                  <dt>HEAD</dt>
                  <dd>
                    {selected.technical.leftHead ?? '不明'} /{' '}
                    {selected.technical.rightHead ?? '不明'}
                  </dd>
                </div>
                <div>
                  <dt>共通の起点</dt>
                  <dd>{displayCommonBase(selected.technical.commonBase)}</dd>
                </div>
                <div>
                  <dt>変更された場所</dt>
                  <dd>{(selected.technical.changedPaths ?? []).join('、') || 'なし'}</dd>
                </div>
              </dl>
            ) : null}
            <div className="observer-card__actions">
              <button
                type="button"
                className="washi-tab"
                disabled={busy}
                onClick={() => onAcknowledge(selected.id)}
              >
                確認した
              </button>
              <button
                type="button"
                className="washi-tab"
                disabled={busy}
                onClick={() => onResolve(selected.id)}
              >
                もう重なっていない
              </button>
              <button
                type="button"
                className="washi-tab"
                disabled={busy}
                onClick={() => onRecheck(selected.id)}
              >
                いまの状態を確認
              </button>
            </div>
          </article>
        ) : null}
      </div>

      <button type="button" className="washi-tab" onClick={onBack}>
        今日の作業場へ戻る
      </button>
    </section>
  )
}

const NAMED_CONFIDENCE = new Set(['verified', 'reported'])

function actorLabels(conflict: ConflictView | null): string[] {
  if (!conflict) {
    return []
  }
  return [
    conflict.leftActorLabel ??
      safeActorLabel(conflict.leftSource, conflict.leftAttributionConfidence),
    conflict.rightActorLabel ??
      safeActorLabel(conflict.rightSource, conflict.rightAttributionConfidence),
  ]
}

function safeActorLabel(
  source: string | null | undefined,
  confidence: string | null | undefined,
): string {
  if (!source || source === 'git' || !confidence || !NAMED_CONFIDENCE.has(confidence)) {
    return '変更元不明'
  }
  return labelForNamedSource(source)
}

function labelForNamedSource(source: string): string {
  if (source === 'claude-desktop') {
    return 'Claudeアプリ'
  }
  if (source === 'grok-build') {
    return 'Grok Build'
  }
  if (source === 'claude-code') {
    return 'Claude Code'
  }
  if (source === 'cursor') {
    return 'Cursor'
  }
  return 'Codex'
}

function displayCommonBase(value: string | null | undefined): string {
  if (!value || value === 'unknown') {
    return '不明'
  }
  return value
}

function statusLabel(status: string): string {
  if (status === 'acknowledged') {
    return '確認済み'
  }
  if (status === 'resolved') {
    return '解消'
  }
  return '未確認'
}

function toneFor(level: string): string {
  if (level === 'high' || level === 'critical') {
    return '🔴 同じ仕組みを変更しています'
  }
  if (level === 'caution') {
    return '🟠 完了順を調整した方が安全です'
  }
  if (level === 'related') {
    return '🟡 一部が関係しています'
  }
  return '🟢 別々に進められそうです'
}
