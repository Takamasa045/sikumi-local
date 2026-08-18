import type { ProviderId } from '@sikumi-local/core'
import type { ProviderAvailability } from '../api/providers'
import type { ProviderLoadState } from '../providers/connection-summary'

const REAL_PROVIDER_ORDER: readonly ProviderId[] = [
  'codex',
  'grok-build',
  'claude-code',
]

const KNOWN_LOGIN_COMMANDS: Partial<Record<ProviderId, string>> = {
  codex: 'codex login',
  'claude-code': 'claude auth login',
}

interface ProbeSnapshot {
  readonly version?: string
  readonly transport?: string
  readonly warnings?: readonly string[]
  readonly errors?: readonly string[]
}

interface ProviderStatusPanelProps {
  readonly providers: readonly ProviderAvailability[]
  readonly loadState: ProviderLoadState
  readonly busy?: boolean
  readonly probeError?: string | null
  readonly probes?: Partial<Record<ProviderId, ProbeSnapshot>>
  readonly onRecheck: (id: ProviderId) => void
}

export function ProviderStatusPanel({
  providers,
  loadState,
  busy = false,
  probeError = null,
  probes = {},
  onRecheck,
}: ProviderStatusPanelProps) {
  const realProviders = REAL_PROVIDER_ORDER.map((id) => {
    const listed = providers.find((provider) => provider.id === id)
    return {
      id,
      displayName: listed?.displayName ?? displayNameFor(id),
      listed,
    }
  })

  return (
    <section
      className="provider-status-panel"
      aria-label="実行エンジンの状態"
      data-testid="provider-status-panel"
    >
      <p className="section-kicker">実行エンジン</p>
      <h3>道具のつながり</h3>
      {loadState === 'error' || probeError ? (
        <p role="alert" data-testid="provider-probe-error">
          {probeError ?? '接続状態を確認できません'}
        </p>
      ) : null}
      <ul>
        {realProviders.map(({ id, displayName, listed }) => {
          const probe = probes[id]
          const status = primaryStatus(listed, loadState)
          return (
            <li key={id} data-provider={id}>
              <div>
                <strong>{displayName}</strong>
                <p>{status}</p>
                {probe?.version ? <small>版 {probe.version}</small> : null}
                {probe?.transport ? (
                  <small>経路 {probe.transport}</small>
                ) : null}
              </div>
              {listed?.status === 'login_required' ? (
                <p className="provider-status-panel__login">
                  ターミナルでこのCLIを一度起動し、ログインを完了してください。その後「再確認」を押してください。
                  {KNOWN_LOGIN_COMMANDS[id] ? (
                    <>
                      {' '}
                      例: <code>{KNOWN_LOGIN_COMMANDS[id]}</code>
                    </>
                  ) : null}
                </p>
              ) : null}
              {probe?.warnings && probe.warnings.length > 0 ? (
                <details>
                  <summary>注意</summary>
                  <ul>
                    {probe.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {probe?.errors && probe.errors.length > 0 ? (
                <details>
                  <summary>詳細</summary>
                  <ul>
                    {probe.errors.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRecheck(id)
                }}
              >
                再確認
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function primaryStatus(
  provider: ProviderAvailability | undefined,
  loadState: ProviderLoadState,
): string {
  if (loadState === 'error') {
    return '確認できません'
  }
  if (!provider) {
    return '確認できません'
  }
  if (provider.executionConnected || provider.status === 'ready') {
    return '使えます'
  }
  if (provider.status === 'login_required') {
    return 'ログインが必要'
  }
  if (provider.status === 'not_installed') {
    return '未インストール'
  }
  return 'つながっていません'
}

function displayNameFor(id: ProviderId): string {
  if (id === 'codex') {
    return 'Codex'
  }
  if (id === 'grok-build') {
    return 'Grok Build'
  }
  return 'Claude Code'
}
