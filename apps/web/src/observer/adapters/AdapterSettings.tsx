import { useEffect, useState } from 'react'
import type { Workspace } from '@sikumi-local/core'
import { listWorkspaces } from '../../api/workspaces'
import {
  applyObserverAdapterAction,
  checkObserverAdapter,
  listObserverAdapters,
  previewObserverAdapterAction,
  type ObserverAdapterView,
  type ObserverInstallView,
} from '../../api/observer'

type AdapterPlan = ObserverInstallView & {
  action: 'install' | 'uninstall'
  scope: 'user' | 'repo'
  repositoryId?: string
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
  const [plans, setPlans] = useState<Partial<Record<string, AdapterPlan>>>({})

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
      setError(cause instanceof Error ? cause.message : '確認できませんでした')
    } finally {
      setBusySource(null)
    }
  }

  async function handlePreview(
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
    try {
      const result = await previewObserverAdapterAction(source, action, target)
      setPlans((current) => ({
        ...current,
        [source]: {
          ...result,
          action,
          scope: target.scope,
          ...(target.repositoryId === undefined
            ? {}
            : { repositoryId: target.repositoryId }),
        },
      }))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'つなぐ準備ができませんでした',
      )
    } finally {
      setBusySource(null)
    }
  }

  async function handleApply(source: string) {
    const plan = plans[source]
    if (!plan || (!plan.confirmationToken && !plan.planDigest)) {
      setError('先に、どこへつなぐかを確認してください')
      return
    }
    setBusySource(source)
    setError(null)
    try {
      const result = await applyObserverAdapterAction(source, plan.action, {
        scope: plan.scope,
        ...(plan.repositoryId === undefined
          ? {}
          : { repositoryId: plan.repositoryId }),
        ...(plan.confirmationToken
          ? { confirmationToken: plan.confirmationToken }
          : {}),
        ...(plan.planDigest ? { planDigest: plan.planDigest } : {}),
      })
      setPlans((current) => ({
        ...current,
        [source]: {
          ...result,
          action: plan.action,
          scope: plan.scope,
          ...(plan.repositoryId === undefined
            ? {}
            : { repositoryId: plan.repositoryId }),
        },
      }))
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'つなぎ直せませんでした',
      )
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
          const plan = plans[adapter.source]
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
                        void handlePreview(adapter.source, 'install')
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
                        void handlePreview(adapter.source, 'uninstall')
                      }}
                    >
                      はずす
                    </button>
                  </>
                ) : null}
              </div>
              {plan ? (
                <div className="observer-adapter-plan">
                  <p className="observer-adapter-confirm">
                    {planConfirmation(plan, adapter, repositories)}
                  </p>
                  <details className="observer-adapter-details">
                    <summary>くわしく見る</summary>
                    <pre className="observer-adapter-preview">
                      {plan.message}
                      {plan.targetRoot ? `\n場所: ${plan.targetRoot}` : ''}
                      {`\n範囲: ${plan.scope === 'repo' ? 'この場所だけ' : 'このパソコン全体'}`}
                      {plan.preview ? `\n\n${plan.preview}` : ''}
                    </pre>
                  </details>
                  {plan.requiresConfirm &&
                  (plan.confirmationToken || plan.planDigest) ? (
                    <button
                      type="button"
                      className="washi-tab"
                      disabled={busySource === adapter.source}
                      onClick={() => {
                        void handleApply(adapter.source)
                      }}
                    >
                      {applyLabel(adapter.source, plan.action)}
                    </button>
                  ) : null}
                  {adapter.source === 'claude-desktop' &&
                  plan.applied &&
                  plan.ok ? (
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

function placeLabel(
  plan: AdapterPlan,
  repositories: readonly Workspace['repository'][],
): string {
  if (plan.scope !== 'repo') {
    return 'このパソコン全体'
  }
  const name = repositories.find(
    (repository) => repository.id === plan.repositoryId,
  )?.displayName
  return name ? `${name} だけ` : 'この場所だけ'
}

function planConfirmation(
  plan: AdapterPlan,
  adapter: ObserverAdapterView,
  repositories: readonly Workspace['repository'][],
): string {
  if (adapter.source === 'claude-desktop') {
    if (plan.action === 'install') {
      return plan.applied && plan.ok
        ? 'パッケージを作りました。Claude Desktop の設定から自分で入れてください。'
        : 'Claudeアプリ用の小さな道具を作ります。できたファイルは、Claude Desktop の設定から自分で入れてください。'
    }
    return plan.applied && plan.ok
      ? 'パッケージの用意をやめました。'
      : '作っておいた Claudeアプリ用のパッケージをやめます。'
  }
  const place = placeLabel(plan, repositories)
  if (plan.action === 'install') {
    return plan.applied && plan.ok
      ? `${place}で、${adapter.displayName} が庭に様子を知らせるようになりました。この場所でいつもどおり動かせば、庭が反応します。`
      : `${place}で、${adapter.displayName} が庭に様子を知らせるようにします。`
  }
  return plan.applied && plan.ok
    ? `${place}で、${adapter.displayName} から庭への知らせをやめました。`
    : `${place}で、${adapter.displayName} から庭への知らせをやめます。`
}

function applyLabel(source: string, action: 'install' | 'uninstall'): string {
  if (source === 'claude-desktop') {
    return action === 'install' ? 'このパッケージをつくる' : 'この用意をやめる'
  }
  return action === 'install' ? 'この場所につなぐ' : 'この場所からはずす'
}
