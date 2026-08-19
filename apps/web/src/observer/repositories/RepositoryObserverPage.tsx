import type { RepositoryActivity } from '../../api/observer'

interface RepositoryObserverPageProps {
  readonly activity: RepositoryActivity | null
  readonly busy: boolean
  readonly onBack: () => void
  readonly onRescan: () => void
  readonly onOpenConflicts?: (id?: string) => void
}

export function RepositoryObserverPage({
  activity,
  busy,
  onBack,
  onRescan,
  onOpenConflicts,
}: RepositoryObserverPageProps) {
  if (!activity) {
    return (
      <section className="observer-detail">
        <p>この場所の様子をまだ受け取っていません。</p>
        <button type="button" className="washi-tab" onClick={onBack}>
          今日の作業場へ戻る
        </button>
      </section>
    )
  }

  return (
    <section className="observer-detail" aria-label={`${activity.displayName}の様子`}>
      <p className="section-kicker">場所の様子</p>
      <h2>{activity.displayName}</h2>
      <p>{activity.summary}</p>
      {activity.truncated ? (
        <p data-testid="activity-truncated">
          変更が多すぎるため、一部だけを表示しています。件数の合計は残しています。
        </p>
      ) : null}
      <p>
        Gitの用語は使いません。ここに出ているのは「いま残っている変更」の整理です。誰が直したかは、直接つながっていない場合は分かりません。
      </p>

      <h3>いまの作業</h3>
      {activity.sessions.length === 0 ? (
        <p>直接つながった作業はありません。</p>
      ) : (
        <ul>
          {activity.sessions.map((session) => (
            <li key={session.id}>
              {session.displayName} / {session.title}
              {session.attributionConfidence === 'inferred'
                ? '（変更元不明）'
                : ''}
            </li>
          ))}
        </ul>
      )}

      <h3>変更されているところ</h3>
      {activity.worktrees.map((worktree) => (
        <article key={worktree.path} className="observer-worktree">
          <strong>
            {worktree.isPrimary ? '本体の作業場' : '別の作業場'}
          </strong>
          <p>
            {worktree.changedFileCount} 件の変更
            {worktree.filesTruncated
              ? `（${worktree.returnedFileCount ?? worktree.files.length} 件まで表示）`
              : ''}
          </p>
          {worktree.filesTruncated ? (
            <p data-testid="worktree-truncated">一部だけ表示しています</p>
          ) : null}
          <ul>
            {worktree.files.map((file) => (
              <li key={`${worktree.path}:${file.path}`}>
                {file.areaLabel}（{file.changeLabel}）
              </li>
            ))}
          </ul>
        </article>
      ))}

      <h3>注意</h3>
      {activity.conflicts.length === 0 ? (
        <p>いま重なっている作業は見当たりません。</p>
      ) : (
        <div>
          <p role="status">
            ⚠ この場所に {activity.conflicts.length} 件の衝突注意があります。
          </p>
          <ul>
            {activity.conflicts.map((conflict) => (
              <li key={conflict.id}>
                {conflict.headline ?? conflict.summary}
                {onOpenConflicts ? (
                  <button
                    type="button"
                    className="washi-tab"
                    onClick={() => onOpenConflicts(conflict.id)}
                  >
                    衝突の詳細を見る
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="observer-card__actions">
        <button type="button" className="washi-tab" onClick={onBack}>
          今日の作業場へ戻る
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
    </section>
  )
}
