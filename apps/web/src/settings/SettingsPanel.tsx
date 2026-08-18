import type { ProviderId, Workspace } from '@sikumi-local/core'
import type { ProviderAvailability } from '../api/providers'
import { RepositoryPanel } from '../workspace/RepositoryPanel'

interface SettingsPanelProps {
  readonly workspace: Workspace | null
  readonly providers: readonly ProviderAvailability[]
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string) => void
  readonly onWorkspaceProviderChange?: (providerId: ProviderId | null) => void
}

export function SettingsPanel({
  workspace,
  providers,
  busy,
  error,
  onRegister,
  onWorkspaceProviderChange,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel" id="settings" aria-label="設定">
      <p className="section-kicker">設定</p>
      <h2>工房の整え方</h2>
      <RepositoryPanel
        workspace={workspace}
        busy={busy}
        error={error}
        onRegister={onRegister}
      />
      {workspace && onWorkspaceProviderChange ? (
        <label className="settings-panel__tool">
          <span>この工房の標準の道具</span>
          <select
            aria-label="この工房の標準の道具"
            value={workspace.defaultProviderId ?? ''}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value
              onWorkspaceProviderChange(
                value === '' ? null : (value as ProviderId),
              )
            }}
          >
            <option value="">まだ選ばない</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  )
}
