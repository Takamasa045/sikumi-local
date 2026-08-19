import type { FormEvent } from 'react'
import type { Workspace } from '@sikumi-local/core'
import type { RepositoryActivity, TodayOverview } from '../../api/observer'

interface ObserverDashboardProps {
  readonly overview: TodayOverview | null
  readonly workspace: Workspace | null
  readonly selectedRepositoryId: string | null
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
  readonly onSelectRepository: (id: string) => void
  readonly onRescan: (id: string) => void
  readonly onOpenConflicts?: () => void
}

export function ObserverDashboard({
  overview,
  selectedRepositoryId,
  busy,
  error,
  onRegister,
  onSelectRepository,
  onRescan,
  onOpenConflicts,
}: ObserverDashboardProps) {
  return (
    <section className="observer-home" aria-label="今日の作業場">
      <p className="section-kicker">今日の作業場</p>
      <h2>いま何が、どこで起きているか</h2>
      <p className="observer-lead">
        普段どおり各AIアプリで作業してください。ここは作業を頼む場所ではなく、登録した場所の様子を眺める場所です。
      </p>

      {overview ? (
        <div className="observer-stats" data-testid="observer-stats">
          <span>{overview.repositoryCount} 件の場所</span>
          <span>{overview.activeRepositoryCount} 件で動きがあります</span>
          <span>{overview.waitingCount} 件の確認待ち</span>
          <span>{overview.conflictCount} 件の注意</span>
          {overview.truncated ? (
            <span data-testid="observer-truncated">一部だけ表示しています</span>
          ) : null}
        </div>
      ) : null}

      {overview && overview.conflictCount > 0 ? (
        <p role="status" data-testid="observer-conflict-warning">
          ⚠ {overview.conflictCount} 件の衝突注意があります。
          <button type="button" className="washi-tab" onClick={onOpenConflicts}>
            衝突の一覧を見る
          </button>
        </p>
      ) : null}

      <ObserverRepositoryAdd
        busy={busy}
        error={error}
        onRegister={onRegister}
      />

      {overview && overview.repositories.length === 0 ? (
        <p>登録した場所がまだありません。上の欄からフォルダを追加してください。</p>
      ) : null}

      <ul className="observer-repo-list">
        {(overview?.repositories ?? []).map((repository) => (
          <li key={repository.repositoryId}>
            <RepositoryActivityCard
              activity={repository}
              selected={repository.repositoryId === selectedRepositoryId}
              busy={busy}
              onOpen={() => onSelectRepository(repository.repositoryId)}
              onRescan={() => onRescan(repository.repositoryId)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function RepositoryActivityCard({
  activity,
  selected,
  busy,
  onOpen,
  onRescan,
}: {
  readonly activity: RepositoryActivity
  readonly selected: boolean
  readonly busy: boolean
  readonly onOpen: () => void
  readonly onRescan: () => void
}) {
  return (
    <article
      className={selected ? 'observer-card is-selected' : 'observer-card'}
      data-testid={`observer-repo-${activity.repositoryId}`}
    >
      <header>
        <strong>{activity.displayName}</strong>
        <span>{toneFor(activity)}</span>
      </header>
      <p>{activity.summary}</p>
      {activity.sessions.length > 0 ? (
        <ul className="observer-session-list">
          {activity.sessions.map((session) => (
            <li key={session.id}>
              <strong>{session.displayName}</strong>
              <span>{session.title}</span>
              {session.lastObservedLabel ? (
                <small>最終確認: {session.lastObservedLabel}</small>
              ) : null}
              {session.attributionConfidence === 'inferred' ? (
                <small>AIによる作業だと決めてはいません</small>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="observer-empty">
          {activity.changedFileCount > 0
            ? `まだ記録していない変更が ${activity.changedFileCount} 件あります`
            : '現在観測中の作業はありません'}
        </p>
      )}
      {activity.areas.length > 0 ? (
        <p>関係しそうなところ: {activity.areas.join('、')}</p>
      ) : null}
      <div className="observer-card__actions">
        <button type="button" className="washi-tab" onClick={onOpen}>
          この場所を見る
        </button>
        <button
          type="button"
          className="washi-tab"
          disabled={busy}
          onClick={onRescan}
        >
          いまの状態を確認
        </button>
      </div>
    </article>
  )
}

function ObserverRepositoryAdd({
  busy,
  error,
  onRegister,
}: {
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const path = String(form.get('path') ?? '')
    const employeeName = String(form.get('employeeName') ?? '').trim()
    onRegister(path, employeeName)
    event.currentTarget.reset()
  }

  return (
    <form
      className="observer-add-repository"
      data-testid="observer-add-repository"
      onSubmit={handleSubmit}
    >
      <h3>観測するRepositoryを追加</h3>
      <p>
        フォルダを指定すると、この画面で様子を眺められます。複数の場所を並べて登録できます。
      </p>
      <label>
        <span>担当の名前（任意）</span>
        <input
          name="employeeName"
          aria-label="担当の名前（任意）"
          placeholder="例：ブログ番"
          autoComplete="off"
          maxLength={40}
          disabled={busy}
        />
      </label>
      <label>
        <span>観測するRepositoryの場所</span>
        <input
          name="path"
          aria-label="観測するRepositoryの場所"
          placeholder="/Users/example/Projects/my-website"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
      </label>
      {error ? (
        <p className="repository-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy}>
        観測するRepositoryを追加
      </button>
    </form>
  )
}

function toneFor(activity: RepositoryActivity): string {
  if (activity.conflicts.some((item) => item.status === 'open')) {
    return activity.conflicts.some(
      (item) => item.level === 'high' || item.level === 'critical',
    )
      ? '🔴 注意'
      : activity.conflicts.some((item) => item.level === 'caution')
        ? '🟠 注意'
        : '🟡 注意'
  }
  if (activity.sessions.some((session) => session.status === 'waiting-for-user')) {
    return '確認待ち'
  }
  if (activity.changedFileCount > 0) {
    return '動きあり'
  }
  return '静か'
}
