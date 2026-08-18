import type { ApprovalRequest } from '@sikumi-local/core'

interface ApprovalPanelProps {
  readonly approvals: readonly ApprovalRequest[]
  readonly busy: boolean
  readonly onResolve: (id: string, decision: 'approved' | 'denied') => void
}

export function ApprovalPanel({
  approvals,
  busy,
  onResolve,
}: ApprovalPanelProps) {
  if (approvals.length === 0) {
    return null
  }

  return (
    <section
      className="approval-panel"
      aria-label="確認待ち"
      data-testid="approval-panel"
    >
      <p className="section-kicker">確認待ち {approvals.length}件</p>
      <h2>サグルから確認があります</h2>
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
              許可
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
          </div>
        </article>
      ))}
    </section>
  )
}
