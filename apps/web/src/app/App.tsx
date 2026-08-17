import { useEffect, useState } from 'react'
import type { Workspace } from '@sikumi-local/core'
import { listWorkspaces, registerWorkspace } from '../api/workspaces'
import { WorldStage } from '../garden/WorldStage'
import { getWorldPack, worldPacks, type WorldPackId } from '../garden/worlds'
import { RepositoryPanel } from '../workspace/RepositoryPanel'
import './app.css'

export function App() {
  const [worldPackId, setWorldPackId] = useState<WorldPackId>('dog-office')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const world = getWorldPack(worldPackId)

  useEffect(() => {
    let cancelled = false

    void listWorkspaces()
      .then((workspaces) => {
        if (!cancelled) {
          setWorkspace(workspaces[0] ?? null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspace(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleRegister(path: string) {
    setBusy(true)
    setError(null)
    try {
      setWorkspace(await registerWorkspace(path))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登録に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#garden" aria-label="Shikumi Local ホーム">
          <span className="brand__crest" aria-hidden="true">
            仕
          </span>
          <span>
            <strong>Shikumi Local</strong>
            <small>ひとりのRepositoryに、小さな工房を。</small>
          </span>
        </a>
        <nav aria-label="主要画面">
          <a aria-current="page" href="#garden">
            庭
          </a>
          <a href="#artifacts">成果棚</a>
          <a href="#employees">AI社員</a>
          <a href="#settings">設定</a>
        </nav>
        <div className="connection-badge">
          <span aria-hidden="true" />
          実行エンジン未接続
        </div>
      </header>

      <main id="garden">
        <div className="workspace-line" data-testid="workspace-line">
          <div>
            <span className="eyebrow">最初の工房</span>
            <strong>
              {workspace
                ? workspace.repository.displayName
                : 'Repository未登録'}
            </strong>
          </div>
          <div>
            <span className="eyebrow">標準の道具</span>
            <strong>実行エンジン未接続</strong>
          </div>
        </div>

        <WorldStage world={world} />

        <section className="garden-controls" aria-label="庭の操作">
          <div className="world-selector">
            <div>
              <p className="section-kicker">庭の見立て</p>
              <h2>どの工房で迎えますか</h2>
            </div>
            <div
              className="world-selector__tabs"
              role="group"
              aria-label="World Pack"
            >
              {worldPacks.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  className={
                    pack.id === world.id ? 'washi-tab is-active' : 'washi-tab'
                  }
                  aria-pressed={pack.id === world.id}
                  aria-label={`${pack.name}を表示`}
                  onClick={() => setWorldPackId(pack.id)}
                >
                  <span>{pack.shortName}</span>
                  <small>
                    {pack.id === 'dog-office'
                      ? '竹・苔・縁側'
                      : '木工・金工・和紙・漆'}
                  </small>
                </button>
              ))}
            </div>
          </div>

          <RepositoryPanel
            workspace={workspace}
            busy={busy}
            error={error}
            onRegister={(path) => {
              void handleRegister(path)
            }}
          />

          <form className="job-composer" aria-label="仕事を頼む">
            <div className="job-composer__intro">
              <p className="section-kicker">仕事の入口</p>
              <h2>サグルに何を調べてもらいますか</h2>
            </div>
            <label>
              <span>依頼内容</span>
              <textarea
                disabled
                placeholder="例：このRepositoryの構成と改善点を調べて"
                rows={3}
              />
            </label>
            <div className="job-composer__footer">
              <p>
                <span aria-hidden="true">◇</span>{' '}
                実行機能は次のPhaseで接続します
              </p>
              <button type="submit" disabled>
                仕事を頼む
              </button>
            </div>
          </form>
        </section>
      </main>

      <footer>
        <p>
          この画面はPhase
          2です。Repository登録と履歴の保存はできます。実行・承認・成果保存はまだ接続していません。
        </p>
        <span>Shikumi Local · 127.0.0.1</span>
      </footer>
    </div>
  )
}
