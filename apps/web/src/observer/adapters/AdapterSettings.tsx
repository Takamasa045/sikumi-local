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
          setError(cause instanceof Error ? cause.message : '観測口を読めませんでした')
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
        ...(selected.repositoryId ? { repositoryId: selected.repositoryId } : {}),
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

  async function handlePreview(source: string, action: 'install' | 'uninstall') {
    const target = targetFor(source)
    if (supportsRepoScope(source) && target.scope === 'repo' && !target.repositoryId) {
      setError('Repository 限定の導入には、登録済み Repository を選んでください')
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
      setError(cause instanceof Error ? cause.message : '差分を作れませんでした')
    } finally {
      setBusySource(null)
    }
  }

  async function handleApply(source: string) {
    const plan = plans[source]
    if (!plan || (!plan.confirmationToken && !plan.planDigest)) {
      setError('先に差分を確認してください')
      return
    }
    setBusySource(source)
    setError(null)
    try {
      const result = await applyObserverAdapterAction(source, plan.action, {
        scope: plan.scope,
        ...(plan.repositoryId === undefined ? {} : { repositoryId: plan.repositoryId }),
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
      setError(cause instanceof Error ? cause.message : '適用できませんでした')
    } finally {
      setBusySource(null)
    }
  }

  return (
    <section className="observer-adapters" data-testid="observer-adapters">
      <h3>観測するAIアプリ</h3>
      <p>
        Codex、Cursor、Grok Build、Claude Code は公式 Hooks / Plugin で様子を受け取ります。「導入差分」「解除差分」はまだ書き込みません。対象と差分だけを表示します。「表示した対象へこの差分を適用する」を押すと、表示中の対象へ書き込みます。認可はログインと
        CSRF です。plan digest は確認後に設定が変わっていないかを見るためのもので、認可トークンではありません。Claudeアプリの通常チャットは制限付きの協調報告です。自動の全観測ではありません。生成した
        .mcpb は Claude Desktop の Settings &gt; Extensions からユーザー自身が入れてください。Sikumi は Claude の設定を書き換えません。
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
            <li key={adapter.id} data-testid={`observer-adapter-${adapter.source}`}>
              <header>
                <strong>{adapter.displayName}</strong>
                <span>{statusLabel(adapter.installationStatus)}</span>
              </header>
              <p>{statusEvidence(adapter)}</p>
              {adapter.lastEventAt ? (
                <small>最終受信: {adapter.lastEventAt}</small>
              ) : null}
              {supportsRepoScope(adapter.source) ? (
                <div className="observer-adapter-scope">
                  <label>
                    <span>導入範囲</span>
                    <select
                      aria-label={`${adapter.displayName} の導入範囲`}
                      value={(scopes[adapter.source] ?? { scope: 'user' }).scope}
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
                      <option value="user">ユーザー全体</option>
                      <option value="repo">登録した Repository だけ</option>
                    </select>
                  </label>
                  {(scopes[adapter.source] ?? { scope: 'user' }).scope ===
                  'repo' ? (
                    <label>
                      <span>対象の Repository</span>
                      <select
                        aria-label={`${adapter.displayName} の対象 Repository`}
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
                <p>Codex はユーザー全体へ導入します。</p>
              ) : adapter.source === 'claude-desktop' ? (
                <p>
                  制限付き / 協調報告。通常チャットを自動で全部見ることはできません。報告がない Git
                  変更は変更元不明のままです。
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
                  状態を確認
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
                        ? 'パッケージ差分'
                        : '導入差分'}
                    </button>
                    <button
                      type="button"
                      className="washi-tab"
                      disabled={busySource === adapter.source}
                      onClick={() => {
                        void handlePreview(adapter.source, 'uninstall')
                      }}
                    >
                      解除差分
                    </button>
                  </>
                ) : null}
              </div>
              {plan ? (
                <div className="observer-adapter-plan">
                  <pre className="observer-adapter-preview">
                    {plan.message}
                    {plan.targetRoot ? `\n対象: ${plan.targetRoot}` : ''}
                    {`\n範囲: ${plan.scope === 'repo' ? '登録Repository' : 'ユーザー全体'}`}
                    {plan.preview ? `\n\n${plan.preview}` : ''}
                  </pre>
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
                      {adapter.source === 'claude-desktop'
                        ? 'パッケージを生成する'
                        : '表示した対象へこの差分を適用する'}
                    </button>
                  ) : null}
                  {adapter.source === 'claude-desktop' &&
                  plan.applied &&
                  plan.ok ? (
                    <a
                      className="washi-tab"
                      href="/api/observer/adapters/claude-desktop/package"
                    >
                      パッケージをダウンロード
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
  return source === 'claude-code' || source === 'cursor' || source === 'grok-build'
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
      return '未導入'
    case 'needs_review':
      return '要レビュー'
    case 'ready':
      return '有効'
    case 'degraded':
      return '劣化'
    case 'error':
      return 'エラー'
    case 'needs_update':
      return '更新が必要'
    case 'unavailable':
      return '利用できません'
    default:
      return status
  }
}

function statusEvidence(adapter: ObserverAdapterView): string {
  const warnings = adapter.health?.warnings ?? []
  const errors = adapter.health?.errors ?? []
  if (errors.length > 0) {
    return errors.join(' / ')
  }
  if (warnings.length > 0) {
    return warnings.join(' / ')
  }
  if (adapter.installationStatus === 'ready') {
    return '観測口は使える状態です'
  }
  return '根拠はまだありません'
}
