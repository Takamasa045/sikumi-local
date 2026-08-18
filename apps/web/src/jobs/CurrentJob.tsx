import type { Job } from '@sikumi-local/core'
import { gardenStationLabels } from '../garden/worlds'
import type { GardenPresence } from '../garden/presence'

interface CurrentJobProps {
  readonly job: Job | null
  readonly presence: GardenPresence
  readonly employeeName: string
  readonly busy: boolean
  readonly onCancel: () => void
}

export function CurrentJob({
  job,
  presence,
  employeeName,
  busy,
  onCancel,
}: CurrentJobProps) {
  if (!job) {
    return (
      <section className="current-job" aria-label="いまの仕事">
        <p className="section-kicker">いまの仕事</p>
        <h2>まだ頼んだ仕事はありません</h2>
        <p>担当と道具を選んで、調べてほしいことを頼んでください。</p>
      </section>
    )
  }

  return (
    <section
      className="current-job"
      aria-label="いまの仕事"
      data-testid="current-job"
      data-employee-id={job.employeeId}
    >
      <p className="section-kicker">いまの仕事</p>
      <h2>
        {employeeName} · {gardenStationLabels[presence.station]}
      </h2>
      <p className="current-job__request">{job.request}</p>
      <small>{toolLabel(job.selectedProvider)}</small>
      {job.status === 'running' ? (
        <div className="job-live">
          <button type="button" disabled={busy} onClick={onCancel}>
            仕事を中止
          </button>
        </div>
      ) : null}
    </section>
  )
}

function toolLabel(id: Job['selectedProvider']): string {
  if (id === 'codex') {
    return 'Codex'
  }
  if (id === 'grok-build') {
    return 'Grok Build'
  }
  if (id === 'claude-code') {
    return 'Claude Code'
  }
  return '開発用ハーネス'
}
