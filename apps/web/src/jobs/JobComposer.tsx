import type { FormEvent } from 'react'
import type { Provider, ProviderId } from '@sikumi-local/core'

interface JobComposerProps {
  readonly enabled: boolean
  readonly busy: boolean
  readonly request: string
  readonly notice: string
  readonly providers: readonly Provider[]
  readonly selectedProvider: ProviderId | 'auto'
  readonly confirmation?: {
    readonly message: string
    readonly alternatives: readonly ProviderId[]
  }
  readonly onRequestChange: (value: string) => void
  readonly onProviderChange: (value: ProviderId | 'auto') => void
  readonly onSubmit: (request: string) => void
  readonly onConfirmFallback: (providerId: ProviderId) => void
  readonly onCancelConfirmation: () => void
}

export function JobComposer({
  enabled,
  busy,
  request,
  notice,
  providers,
  selectedProvider,
  confirmation,
  onRequestChange,
  onProviderChange,
  onSubmit,
  onConfirmFallback,
  onCancelConfirmation,
}: JobComposerProps) {
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
        <h2>サグルに何を調べてもらいますか</h2>
      </div>
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
              {provider.displayName}
              {provider.executionConnected ? ' ✓' : ' ×'}
            </option>
          ))}
        </select>
      </label>
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

function labelFor(id: ProviderId): string {
  if (id === 'codex') {
    return 'Codex'
  }
  if (id === 'grok-build') {
    return 'Grok Build'
  }
  return 'Claude Code'
}
