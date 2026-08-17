import { useState } from 'react'
import { WorldStage } from '../garden/WorldStage'
import { getWorldPack, worldPacks, type WorldPackId } from '../garden/worlds'
import './app.css'

export function App() {
  const [worldPackId, setWorldPackId] = useState<WorldPackId>('dog-office')
  const world = getWorldPack(worldPackId)

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
          基盤準備中
        </div>
      </header>

      <main id="garden">
        <div className="workspace-line">
          <div>
            <span className="eyebrow">最初の工房</span>
            <strong>Repository未登録</strong>
          </div>
          <div>
            <span className="eyebrow">標準の道具</span>
            <strong>次のPhaseで選択</strong>
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
          1の庭プレビューです。実行・承認・成果保存はまだ接続していません。
        </p>
        <span>Shikumi Local · 127.0.0.1</span>
      </footer>
    </div>
  )
}
