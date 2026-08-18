import type { ApprovalRequest } from '@sikumi-local/core'

interface ApprovalPanelProps {
  readonly approvals: readonly ApprovalRequest[]
  readonly employeeName: string
  readonly busy: boolean
  readonly onResolve: (id: string, decision: 'approved' | 'denied') => void
  readonly onCancelJob?: () => void
}

export function ApprovalPanel({
  approvals,
  employeeName,
  busy,
  onResolve,
  onCancelJob,
}: ApprovalPanelProps) {
  if (approvals.length === 0) {
    return null
  }

  return (
    <div className="drawer-backdrop" role="presentation">
      <aside
        className="drawer approval-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="確認待ち"
        data-testid="approval-panel"
      >
        <p className="section-kicker">確認待ち {approvals.length}件</p>
        <h2>{employeeName}から確認があります</h2>
        {approvals.map((approval) => (
          <article key={approval.id} className="approval-card">
            <p>{approval.summary}</p>
            <div className="approval-card__actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onResolve(approval.id, 'approved')
                }}
              >
                今回だけ許可
              </button>
              <button
                type="button"
                className="is-quiet"
                disabled={busy}
                onClick={() => {
                  onResolve(approval.id, 'denied')
                }}
              >
                拒否
              </button>
              {onCancelJob ? (
                <button
                  type="button"
                  className="is-quiet"
                  disabled={busy}
                  onClick={onCancelJob}
                >
                  仕事を中止
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </aside>
    </div>
  )
}
