import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import { PlaceAddForm } from '../../workspace/PlaceAddForm'
import { PlaceResidentList } from '../places/PlaceResidentList'

interface ObserverDashboardProps {
  readonly overview: TodayOverview | null
  readonly workspace: Workspace | null
  readonly workspaces?: readonly Workspace[]
  readonly selectedRepositoryId: string | null
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
  readonly onChooseFolder?: () => Promise<string | null>
  readonly onUnregister?: (workspaceId: string) => void
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
  onChooseFolder,
  onUnregister,
  onSelectRepository,
  onOpenConflicts,
}: ObserverDashboardProps) {
  return (
    <section className="observer-home" aria-label="今日の作業場">
      <p className="section-kicker">今日の作業場</p>
      <h2>登録した場所</h2>
      <p className="observer-lead">
        登録した場所を確認する場所です。つなぐは必須ではありません。普段どおり各AIアプリで作業してください。
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
        {...(onUnregister ? { onUnregister } : {})}
      />

      <PlaceAddForm
        busy={busy}
        error={error}
        onRegister={onRegister}
        {...(onChooseFolder ? { onChooseFolder } : {})}
      />
    </section>
  )
}
