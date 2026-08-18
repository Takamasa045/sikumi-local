import type { FormEvent } from 'react'
import type { EmployeeSummary, ProviderId } from '@sikumi-local/core'
import type { ProviderAvailability } from '../api/providers'

interface JobComposerProps {
  readonly enabled: boolean
  readonly busy: boolean
  readonly request: string
  readonly notice: string
  readonly employees: readonly EmployeeSummary[]
  readonly selectedEmployeeId: string
  readonly providers: readonly ProviderAvailability[]
  readonly selectedProvider: ProviderId | 'auto'
  readonly confirmation?: {
    readonly message: string
    readonly alternatives: readonly ProviderId[]
  }
  readonly dirtyRepo?: {
    readonly message: string
  }
  readonly onRequestChange: (value: string) => void
  readonly onEmployeeChange: (value: string) => void
  readonly onProviderChange: (value: ProviderId | 'auto') => void
  readonly onSubmit: (request: string) => void
  readonly onConfirmFallback: (providerId: ProviderId) => void
  readonly onCancelConfirmation: () => void
  readonly onDirtyPolicy?: (
    policy: 'from-head' | 'include-dirty-patch' | 'cancel',
  ) => void
}

export function JobComposer({
  enabled,
  busy,
  request,
  notice,
  employees,
  selectedEmployeeId,
  providers,
  selectedProvider,
  confirmation,
  dirtyRepo,
  onRequestChange,
  onEmployeeChange,
  onProviderChange,
  onSubmit,
  onConfirmFallback,
  onCancelConfirmation,
  onDirtyPolicy,
}: JobComposerProps) {
  const selected =
    employees.find((employee) => employee.id === selectedEmployeeId) ??
    employees[0]

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enabled && !busy && request.trim().length > 0) {
      onSubmit(request)
    }
  }

  return (
    <form
      className="job-composer"
      aria-label="仕事を頼む"
      onSubmit={handleSubmit}
    >
      <div className="job-composer__intro">
        <p className="section-kicker">仕事の入口</p>
        <h2>
          {selected ? `${selected.name}に何を頼みますか` : '誰に頼みますか'}
        </h2>
      </div>
      <label>
        <span>担当</span>
        <select
          aria-label="担当"
          value={selectedEmployeeId}
          disabled={busy || employees.length === 0}
          onChange={(event) => {
            onEmployeeChange(event.target.value)
          }}
        >
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} · {employee.role}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>道具</span>
        <select
          aria-label="道具"
          value={selectedProvider}
          disabled={!enabled || busy}
          onChange={(event) => {
            const value = event.target.value
            onProviderChange(value === 'auto' ? 'auto' : (value as ProviderId))
          }}
        >
          <option value="auto">この工房の標準 / 提案</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.displayName} · {statusLabel(provider, selected)}
            </option>
          ))}
        </select>
      </label>
      {dirtyRepo && onDirtyPolicy ? (
        <div className="provider-confirm" role="alertdialog">
          <p>{dirtyRepo.message}</p>
          <div className="provider-confirm__actions">
            <button
              type="button"
              onClick={() => {
                onDirtyPolicy('from-head')
              }}
            >
              HEADから新しいWorktreeを作る
            </button>
            <button
              type="button"
              onClick={() => {
                onDirtyPolicy('include-dirty-patch')
              }}
            >
              現在の差分を一時Patchとして含める
            </button>
            <button
              type="button"
              className="is-quiet"
              onClick={() => {
                onDirtyPolicy('cancel')
              }}
            >
              中止
            </button>
          </div>
        </div>
      ) : null}
      {confirmation ? (
        <div className="provider-confirm" role="alertdialog">
          <p>{confirmation.message}</p>
          <div className="provider-confirm__actions">
            {confirmation.alternatives.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onConfirmFallback(id)
                }}
              >
                {labelFor(id)}で始める
              </button>
            ))}
            <button
              type="button"
              className="is-quiet"
              onClick={onCancelConfirmation}
            >
              中止
            </button>
          </div>
        </div>
      ) : null}
      <label>
        <span>依頼内容</span>
        <textarea
          value={request}
          disabled={!enabled || busy}
          placeholder="例：このRepositoryの構成と改善点を調べて"
          rows={3}
          onChange={(event) => {
            onRequestChange(event.target.value)
          }}
        />
      </label>
      <div className="job-composer__footer">
        <p>
          <span aria-hidden="true">◇</span> {notice}
        </p>
        <button
          type="submit"
          disabled={!enabled || busy || request.trim().length === 0}
        >
          仕事を頼む
        </button>
      </div>
    </form>
  )
}

export function statusLabel(
  provider: ProviderAvailability,
  employee?: EmployeeSummary,
): string {
  if (employee) {
    const missing = employee.requiredProviderCapabilities.some(
      (key) => !provider.capabilities.includes(key),
    )
    if (provider.installed && missing && provider.capabilities.length > 0) {
      return 'この仕事に必要な権限へ対応していません'
    }
  }
  switch (provider.status) {
    case 'ready':
      return '使用できます'
    case 'login_required':
      return 'ログインが必要です'
    case 'not_installed':
      return 'インストールされていません'
    case 'capability_mismatch':
      return 'この仕事に必要な権限へ対応していません'
    default:
      return provider.executionConnected ? '使用できます' : '実行エンジン未接続'
  }
}

function labelFor(id: ProviderId): string {
  if (id === 'codex') {
    return 'Codex'
  }
  if (id === 'grok-build') {
    return 'Grok Build'
  }
  return 'Claude Code'
}
