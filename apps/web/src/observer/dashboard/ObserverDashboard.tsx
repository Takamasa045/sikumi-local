import type { FormEvent } from 'react'
import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import { PlaceResidentList } from '../places/PlaceResidentList'

interface ObserverDashboardProps {
  readonly overview: TodayOverview | null
  readonly workspace: Workspace | null
  readonly workspaces?: readonly Workspace[]
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
  workspaces = [],
  selectedRepositoryId,
  busy,
  error,
  onRegister,
  onSelectRepository,
  onOpenConflicts,
}: ObserverDashboardProps) {
  return (
    <section className="observer-home" aria-label="今日の作業場">
      <p className="section-kicker">今日の作業場</p>
      <h2>いま何が、どこで起きているか</h2>
      <p className="observer-lead">
        フォルダを登録して、普段どおり各AIアプリで作業してください。つなぐ操作は不要です。ここは作業を頼む場所ではなく、登録した場所の様子を眺める場所です。
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

      <PlaceResidentList
        overview={overview}
        workspaces={workspaces}
        selectedRepositoryId={selectedRepositoryId}
        onSelect={onSelectRepository}
      />

      <ObserverRepositoryAdd
        busy={busy}
        error={error}
        onRegister={onRegister}
      />
    </section>
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
