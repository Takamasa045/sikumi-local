import { useEffect, useState } from 'react'
import type { Workspace } from '@sikumi-local/core'
import { UNSAFE_HOOK_COMMAND_MESSAGE } from '@sikumi-local/observer-core'
import { listWorkspaces } from '../../api/workspaces'
import {
  checkObserverAdapter,
  listObserverAdapters,
  runObserverAdapterAction,
  type ObserverAdapterView,
} from '../../api/observer'

type AdapterOutcome = {
  action: 'install' | 'uninstall'
}

export function AdapterSettings() {
  const [adapters, setAdapters] = useState<ObserverAdapterView[]>([])
  const [repositories, setRepositories] = useState<
    readonly Workspace['repository'][]
  >([])
  const [error, setError] = useState<string | null>(null)
  const [busySource, setBusySource] = useState<string | null>(null)
  const [scopes, setScopes] = useState<
    Partial<Record<string, { scope: 'user' | 'repo'; repositoryId: string }>>
  >({})
  const [outcomes, setOutcomes] = useState<
    Partial<Record<string, AdapterOutcome>>
  >({})

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listObserverAdapters(),
      listWorkspaces().catch(() => [] as Workspace[]),
    ])
      .then(([listed, workspaces]) => {
        if (cancelled) {
          return
        }
        setAdapters(listed)
        setRepositories(workspaces.map((workspace) => workspace.repository))
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : '道具の一覧を読めませんでした',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh() {
    setAdapters(await listObserverAdapters())
  }

  function targetFor(source: string): {
    readonly scope: 'user' | 'repo'
    readonly repositoryId?: string
  } {
    if (!supportsRepoScope(source)) {
      return { scope: 'user' }
    }
    const selected = scopes[source] ?? { scope: 'user', repositoryId: '' }
    if (selected.scope === 'repo') {
      return {
        scope: 'repo',
        ...(selected.repositoryId
          ? { repositoryId: selected.repositoryId }
          : {}),
      }
    }
    return { scope: 'user' }
  }

  async function handleCheck(source: string) {
    setBusySource(source)
    setError(null)
    try {
      await checkObserverAdapter(source)
      await refresh()
    } catch (cause) {
      setError(friendlyCaughtError(cause, '確認できませんでした'))
    } finally {
      setBusySource(null)
    }
  }

  async function handleConnect(
    source: string,
    action: 'install' | 'uninstall',
  ) {
    const target = targetFor(source)
    if (
      supportsRepoScope(source) &&
      target.scope === 'repo' &&
      !target.repositoryId
    ) {
      setError('この場所だけにつなぐには、登録した場所を選んでください')
      return
    }
    setBusySource(source)
    setError(null)
    setOutcomes((current) => {
      const next = { ...current }
      delete next[source]
      return next
    })
    try {
      const result = await runObserverAdapterAction(source, action, target)
      if (!isConnectSuccess(source, result)) {
        setError(friendlyInstallError(connectFailureMessage(result)))
        return
      }
      setOutcomes((current) => ({
        ...current,
        [source]: { action },
      }))
      await refresh()
    } catch (cause) {
      setError(friendlyCaughtError(cause))
    } finally {
      setBusySource(null)
    }
  }

  return (
    <section className="observer-adapters" data-testid="observer-adapters">
      <h3>庭につなぐ道具</h3>
      <p>
        フォルダを登録したあと、Codex や Claude Code
        が庭に様子を知らせるには、一度つなぎます。つないだら、そのフォルダでいつもどおり動かせば庭が反応します。Cursor
        と Grok Build
        も同じです。Claudeアプリは、自分から知らせてくれた分だけ届きます。
      </p>
      {error ? (
        <p className="repository-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      <ul>
        {adapters.map((adapter) => {
          const outcome = outcomes[adapter.source]
          return (
            <li
              key={adapter.id}
              data-testid={`observer-adapter-${adapter.source}`}
            >
              <header>
                <strong>{adapter.displayName}</strong>
                <span>{statusLabel(adapter.installationStatus)}</span>
              </header>
              <p>{statusEvidence(adapter)}</p>
              {adapter.lastEventAt ? (
                <small>さいごに届いた様子: {adapter.lastEventAt}</small>
              ) : null}
              {supportsRepoScope(adapter.source) ? (
                <div className="observer-adapter-scope">
                  <label>
                    <span>つなぐ範囲</span>
                    <select
                      aria-label={`${adapter.displayName} のつなぐ範囲`}
                      value={
                        (scopes[adapter.source] ?? { scope: 'user' }).scope
                      }
                      onChange={(event) => {
                        const scope =
                          event.target.value === 'repo' ? 'repo' : 'user'
                        setScopes((current) => ({
                          ...current,
                          [adapter.source]: {
                            scope,
                            repositoryId:
                              current[adapter.source]?.repositoryId ?? '',
                          },
                        }))
                      }}
                    >
                      <option value="user">このパソコン全体</option>
                      <option value="repo">この場所だけ</option>
                    </select>
                  </label>
                  {(scopes[adapter.source] ?? { scope: 'user' }).scope ===
                  'repo' ? (
                    <label>
                      <span>どの場所</span>
                      <select
                        aria-label={`${adapter.displayName} の場所`}
                        value={
                          (scopes[adapter.source] ?? { repositoryId: '' })
                            .repositoryId
                        }
                        onChange={(event) => {
                          setScopes((current) => ({
                            ...current,
                            [adapter.source]: {
                              scope: 'repo',
                              repositoryId: event.target.value,
                            },
                          }))
                        }}
                      >
                        <option value="">選んでください</option>
                        {repositories.map((repository) => (
                          <option key={repository.id} value={repository.id}>
                            {repository.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : adapter.source === 'codex' ? (
                <p>Codex はこのパソコン全体につなぎます。</p>
              ) : adapter.source === 'claude-desktop' ? (
                <p>
                  自分から知らせてくれた分だけ庭に届きます。全部を自動で見ることはできません。
                </p>
              ) : null}
              <div className="observer-card__actions">
                <button
                  type="button"
                  className="washi-tab"
                  disabled={busySource === adapter.source}
                  onClick={() => {
                    void handleCheck(adapter.source)
                  }}
                >
                  つながりを確認
                </button>
                {canInstall(adapter.source) ? (
                  <>
                    <button
                      type="button"
                      className="washi-tab"
                      disabled={busySource === adapter.source}
                      onClick={() => {
                        void handleConnect(adapter.source, 'install')
                      }}
                    >
                      {adapter.source === 'claude-desktop'
                        ? 'パッケージをつくる'
                        : 'つなぐ'}
                    </button>
                    <button
                      type="button"
                      className="washi-tab"
                      disabled={busySource === adapter.source}
                      onClick={() => {
                        void handleConnect(adapter.source, 'uninstall')
                      }}
                    >
                      はずす
                    </button>
                  </>
                ) : null}
              </div>
              {outcome ? (
                <div className="observer-adapter-plan">
                  <p className="observer-adapter-confirm">
                    {outcomeCopy(adapter.source, outcome.action)}
                  </p>
                  {adapter.source === 'claude-desktop' &&
                  outcome.action === 'install' ? (
                    <a
                      className="washi-tab"
                      href="/api/observer/adapters/claude-desktop/package"
                    >
                      できたファイルを受け取る
                    </a>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function supportsRepoScope(source: string): boolean {
  return (
    source === 'claude-code' || source === 'cursor' || source === 'grok-build'
  )
}

function canInstall(source: string): boolean {
  return (
    source === 'codex' ||
    source === 'claude-code' ||
    source === 'cursor' ||
    source === 'grok-build' ||
    source === 'claude-desktop'
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'not_installed':
      return 'まだつながっていない'
    case 'needs_review':
      return '要確認'
    case 'ready':
      return 'つながっている'
    case 'degraded':
      return '調子が悪い'
    case 'error':
      return 'うまくつながらない'
    case 'needs_update':
      return 'つなぎ直しが必要'
    case 'unavailable':
      return '使えません'
    default:
      return status
  }
}

function statusEvidence(adapter: ObserverAdapterView): string {
  if (adapter.installationStatus === 'error') {
    const errors = adapter.health?.errors ?? []
    if (errors.length > 0) {
      return errors.join(' / ')
    }
    return 'うまくつながりませんでした'
  }
  switch (adapter.installationStatus) {
    case 'not_installed':
      return adapter.source === 'claude-desktop'
        ? 'まだパッケージを作っていません'
        : 'まだつながっていません'
    case 'needs_review':
      return 'つなぎ方はあるようですが、庭が様子を受け取った記録はまだありません'
    case 'ready':
      return 'つながっています。この場所でいつもどおり動かせば、庭が反応します'
    case 'degraded':
      return 'つながっていますが、様子が届きにくいかもしれません'
    case 'needs_update':
      return 'つなぎ方が古くなっています。もう一度つなぎ直してください'
    case 'unavailable':
      return 'いまはこの道具を使えません'
    default:
      return 'まだつながっていません'
  }
}

function outcomeCopy(source: string, action: 'install' | 'uninstall'): string {
  if (source === 'claude-desktop') {
    return action === 'install'
      ? 'パッケージを作りました。Claude Desktop の設定から自分で入れてください。'
      : 'はずしました'
  }
  return action === 'install' ? 'つながりました' : 'はずしました'
}

function isConnectSuccess(
  source: string,
  result: { readonly ok: boolean; readonly applied?: boolean },
): boolean {
  if (!result.ok) {
    return false
  }
  if (source === 'claude-desktop') {
    return true
  }
  return result.applied === true
}

function connectFailureMessage(result: {
  readonly ok: boolean
  readonly message: string
  readonly applied?: boolean
}): string {
  if (!result.ok) {
    return result.message
  }
  if (
    result.message.includes('つなぐ準備') ||
    result.message.includes('はずす準備')
  ) {
    return 'つなぎ直せませんでした'
  }
  return result.message || 'つなぎ直せませんでした'
}

function friendlyInstallError(message: string): string {
  if (message.includes('Hookコマンドの絶対pathが安全ではありません')) {
    return UNSAFE_HOOK_COMMAND_MESSAGE
  }
  return message
}

function friendlyCaughtError(
  cause: unknown,
  fallback = 'つなぎ直せませんでした',
): string {
  const message = cause instanceof Error ? cause.message : ''
  if (
    !message ||
    message.includes('Unexpected server error') ||
    message.includes('INTERNAL_ERROR')
  ) {
    return fallback
  }
  return friendlyInstallError(message)
}
