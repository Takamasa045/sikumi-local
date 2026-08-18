import { useEffect, useState } from 'react'
import type {
  ApprovalRequest,
  Artifact,
  Job,
  PersistedEvent,
  Workspace,
} from '@sikumi-local/core'
import { listApprovals, resolveApproval } from '../api/approvals'
import { getHealth } from '../api/health'
import {
  cancelJob,
  createJob,
  getJob,
  listArtifacts,
  listJobEvents,
  listJobs,
} from '../api/jobs'
import { listWorkspaces, registerWorkspace } from '../api/workspaces'
import { ApprovalPanel } from '../approvals/ApprovalPanel'
import { ArtifactShelf } from '../artifacts/ArtifactShelf'
import { WorldStage } from '../garden/WorldStage'
import { getWorldPack, worldPacks, type WorldPackId } from '../garden/worlds'
import { JobComposer } from '../jobs/JobComposer'
import { RepositoryPanel } from '../workspace/RepositoryPanel'
import './app.css'

export function App() {
  const [worldPackId, setWorldPackId] = useState<WorldPackId>('dog-office')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [fakeHarness, setFakeHarness] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<PersistedEvent[]>([])
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const world = getWorldPack(worldPackId)
  const jobEnabled = fakeHarness && workspace !== null
  const activitySummary =
    latestSummary(events) ??
    (job ? statusLabel(job.status) : 'まだ仕事は始まっていません')

  useEffect(() => {
    let cancelled = false

    void Promise.all([listWorkspaces(), getHealth()])
      .then(([workspaces, health]) => {
        if (cancelled) {
          return
        }
        setWorkspace(workspaces[0] ?? null)
        setFakeHarness(health.fakeHarness)
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspace(null)
          setFakeHarness(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!workspace || !fakeHarness) {
      return
    }
    let cancelled = false
    void listJobs(workspace.id)
      .then((jobs) => {
        if (!cancelled && jobs[0]) {
          setJob(jobs[0])
        }
      })
      .catch(() => {
        // The garden remains usable if job history cannot be loaded.
      })
    return () => {
      cancelled = true
    }
  }, [workspace, fakeHarness])

  useEffect(() => {
    if (!job) {
      return
    }
    let cancelled = false

    async function refresh() {
      if (!job) {
        return
      }
      try {
        const [nextJob, nextEvents, nextApprovals, nextArtifacts] =
          await Promise.all([
            getJob(job.id),
            listJobEvents(job.id),
            listApprovals({ jobId: job.id, status: 'pending' }),
            listArtifacts(job.id),
          ])
        if (cancelled) {
          return
        }
        setJob(nextJob)
        setEvents(nextEvents)
        setApprovals(nextApprovals)
        setArtifacts(nextArtifacts)
      } catch {
        // Keep the last known snapshot while a poll fails.
      }
    }

    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 400)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [job?.id])

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

  async function handleSubmitJob(value: string) {
    if (!workspace) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createJob({
        workspaceId: workspace.id,
        request: value,
      })
      setJob(created)
      setEvents([])
      setApprovals([])
      setArtifacts([])
      setRequest('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '依頼に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleResolve(id: string, decision: 'approved' | 'denied') {
    setBusy(true)
    setError(null)
    try {
      await resolveApproval(id, decision)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '確認に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!job) {
      return
    }
    setBusy(true)
    try {
      setJob(await cancelJob(job.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '中止に失敗しました')
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
          {fakeHarness ? '開発用ハーネス' : '実行エンジン未接続'}
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
            <strong>
              {fakeHarness
                ? 'テスト実行（実エンジン未接続）'
                : '実行エンジン未接続'}
            </strong>
          </div>
        </div>

        <WorldStage world={world} activitySummary={activitySummary} />

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

          <JobComposer
            enabled={jobEnabled}
            busy={busy}
            request={request}
            notice={
              fakeHarness
                ? '開発用ハーネスです。Codex / Grok Build / Claude Code としては表示しません'
                : '実行エンジン（Codex / Grok Build / Claude Code）は未接続です'
            }
            onRequestChange={setRequest}
            onSubmit={(value) => {
              void handleSubmitJob(value)
            }}
          />

          <ApprovalPanel
            approvals={approvals}
            busy={busy}
            onResolve={(id, decision) => {
              void handleResolve(id, decision)
            }}
          />

          {job && job.status === 'running' ? (
            <div className="job-live">
              <button type="button" onClick={() => void handleCancel()}>
                仕事を中止
              </button>
            </div>
          ) : null}

          <ArtifactShelf artifacts={artifacts} />
        </section>
      </main>

      <footer>
        <p>
          この画面はPhase 4です。Codex / Grok Build / Claude Code
          は未接続です。開発用ハーネスを有効にすると、実エンジンなしで仕事・承認・成果の流れを確認できます。
        </p>
        <span>Shikumi Local · 127.0.0.1</span>
      </footer>
    </div>
  )
}

function latestSummary(events: readonly PersistedEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const summary = events[index]?.payload.summary
    if (typeof summary === 'string' && summary.length > 0) {
      return summary
    }
  }
  return null
}

function statusLabel(status: Job['status']): string {
  switch (status) {
    case 'waiting_for_user':
      return 'あなたの確認を待っています'
    case 'running':
    case 'preparing':
      return '仕事を進めています'
    case 'completed':
      return '調査が完了しました'
    case 'failed':
      return '調査を完了できませんでした'
    case 'cancelled':
      return '仕事を中止しました'
    default:
      return 'まだ仕事は始まっていません'
  }
}
