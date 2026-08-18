import type { EmployeeSummary, Job, ProviderId } from '@sikumi-local/core'
import type { ProviderAvailability } from '../api/providers'
import { statusLabel } from '../jobs/JobComposer'

interface EmployeeDrawerProps {
  readonly employee: EmployeeSummary | null
  readonly recentJobs: readonly Job[]
  readonly providers: readonly ProviderAvailability[]
  readonly open: boolean
  readonly busy: boolean
  readonly onClose: () => void
  readonly onDefaultProviderChange: (providerId: ProviderId | null) => void
  readonly growth?: {
    readonly level: number
    readonly permissionProfile: string
    readonly metrics: readonly { id: string; label: string; value: number }[]
  } | null
}

export function EmployeeDrawer({
  employee,
  recentJobs,
  providers,
  open,
  busy,
  onClose,
  onDefaultProviderChange,
  growth,
}: EmployeeDrawerProps) {
  if (!open || !employee) {
    return null
  }

  return (
    <div className="drawer-backdrop" role="presentation">
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-drawer-title"
        data-testid="employee-drawer"
      >
        <p className="section-kicker">AI社員</p>
        <h2 id="employee-drawer-title">{employee.name}</h2>
        <p className="drawer__role">{employee.role}</p>
        <p>{employee.description}</p>

        <dl className="drawer__facts">
          <div>
            <dt>標準の道具</dt>
            <dd>
              <label>
                <span className="visually-hidden">標準の道具</span>
                <select
                  aria-label="標準の道具"
                  value={employee.defaultProviderId ?? ''}
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.value
                    onDefaultProviderChange(
                      value === '' ? null : (value as ProviderId),
                    )
                  }}
                >
                  <option value="">工房の標準に従う</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.displayName} · {statusLabel(provider, employee)}
                    </option>
                  ))}
                </select>
              </label>
            </dd>
          </div>
          <div>
            <dt>受けられる仕事</dt>
            <dd>{employee.supportedJobTypes.join(' / ')}</dd>
          </div>
        </dl>

        <h3>道具の相性</h3>
        <ul className="drawer__providers">
          {providers.map((provider) => (
            <li key={provider.id}>
              {provider.displayName} · {statusLabel(provider, employee)}
            </li>
          ))}
        </ul>

        {growth ? (
          <section data-testid="employee-growth">
            <h3>実績</h3>
            <p>
              Lv.{growth.level} · 権限は {growth.permissionProfile} のままです
            </p>
            <ul className="drawer__jobs">
              {growth.metrics.map((metric) => (
                <li key={metric.id}>
                  {metric.label} {metric.value}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <h3>最近の仕事</h3>
        {recentJobs.length === 0 ? (
          <p>まだ仕事はありません</p>
        ) : (
          <ul className="drawer__jobs">
            {recentJobs.map((job) => (
              <li key={job.id}>
                <strong>{job.request}</strong>
                <small>
                  {job.status} · {job.jobType}
                </small>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="is-quiet" onClick={onClose}>
          閉じる
        </button>
      </aside>
    </div>
  )
}
