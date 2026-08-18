import { useEffect, useMemo, useState } from 'react'
import type {
  ApprovalRequest,
  Artifact,
  EmployeeSummary,
  InstalledPack,
  Job,
  PersistedEvent,
  ProviderId,
  Workspace,
} from '@sikumi-local/core'
import { AppError, isGardenStationId } from '@sikumi-local/core'
import { listApprovals, resolveApproval } from '../api/approvals'
import {
  getEmployee,
  listEmployees,
  updateEmployeeDefaultProvider,
} from '../api/employees'
import { getHealth } from '../api/health'
import { getEmployeeGrowth, listGrowth } from '../api/growth'
import {
  applyArtifact,
  cancelJob,
  createJob,
  discardWorktree,
  exportArtifact,
  getJob,
  getJobWorktree,
  keepWorktree,
  listArtifacts,
  listJobEvents,
  listJobs,
} from '../api/jobs'
import {
  installPack,
  listPacks,
  previewPack,
  uninstallPack,
} from '../api/packs'
import { openEventStream } from '../api/live'
import {
  listProviders,
  probeProvider,
  type ProviderAvailability,
} from '../api/providers'
import {
  listWorkspaces,
  registerWorkspace,
  updateWorkspace,
} from '../api/workspaces'
import { ApprovalPanel } from '../approvals/ApprovalPanel'
import { ArtifactShelf } from '../artifacts/ArtifactShelf'
import { EmployeeDrawer } from '../employees/EmployeeDrawer'
import { resolveGardenPresence, type GardenStateMap } from '../garden/presence'
import { WorldStage } from '../garden/WorldStage'
import { getWorldPack, worldPacks, type WorldPackId } from '../garden/worlds'
import { CurrentJob } from '../jobs/CurrentJob'
import { JobComposer } from '../jobs/JobComposer'
import { SettingsPanel } from '../settings/SettingsPanel'
import { RepositoryPanel } from '../workspace/RepositoryPanel'
import { FirstRunGuide } from '../workspace/FirstRunGuide'
import {
  deriveProviderConnectionSummary,
  type ProviderLoadState,
} from '../providers/connection-summary'
import './app.css'

type Screen = 'garden' | 'artifacts' | 'employees' | 'settings'

export function App() {
  const [screen, setScreen] = useState<Screen>(readScreen())
  const [worldPackId, setWorldPackId] = useState<WorldPackId>('dog-office')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [fakeHarness, setFakeHarness] = useState(false)
  const [providers, setProviders] = useState<ProviderAvailability[]>([])
  const [providerLoadState, setProviderLoadState] =
    useState<ProviderLoadState>('loading')
  const [providerProbeError, setProviderProbeError] = useState<string | null>(
    null,
  )
  const [providerProbes, setProviderProbes] = useState<
    Partial<
      Record<
        ProviderId,
        {
          readonly version?: string
          readonly transport?: string
          readonly warnings?: readonly string[]
          readonly errors?: readonly string[]
        }
      >
    >
  >({})
  const [hasJobs, setHasJobs] = useState(false)
  const [employees, setEmployees] = useState<EmployeeSummary[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | 'auto'>(
    'auto',
  )
  const [employeeDrawerOpen, setEmployeeDrawerOpen] = useState(false)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [stateMap, setStateMap] = useState<GardenStateMap | undefined>()
  const [confirmation, setConfirmation] = useState<{
    message: string
    alternatives: ProviderId[]
    request: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [events, setEvents] = useState<PersistedEvent[]>([])
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [growth, setGrowth] = useState<{
    level: number
    permissionProfile: string
    metrics: Array<{ id: string; label: string; value: number }>
    unlocks: string[]
  } | null>(null)
  const [packs, setPacks] = useState<InstalledPack[]>([])
  const [packPreview, setPackPreview] = useState<Awaited<
    ReturnType<typeof previewPack>
  > | null>(null)
  const [dirtyRepo, setDirtyRepo] = useState<{
    message: string
    request: string
  } | null>(null)
  const [worktree, setWorktree] = useState<{
    branchName: string
    baseCommit: string
    status: string
    summary: string
    files: string[]
    patch: string
  } | null>(null)
  const world = getWorldPack(worldPackId)
  const selectedEmployee =
    employees.find((employee) => employee.id === selectedEmployeeId) ??
    employees[0] ??
    null
  const displayEmployeeId = job?.employeeId ?? selectedEmployeeId
  const displayEmployee =
    employees.find((employee) => employee.id === displayEmployeeId) ?? null
  const jobEnabled =
    workspace !== null &&
    (fakeHarness || providers.some((provider) => provider.executionConnected))
  const connection = deriveProviderConnectionSummary({
    loadState: providerLoadState,
    providers,
    fakeHarness,
    defaultProviderId: workspace?.defaultProviderId ?? null,
  })
  const hasConnectedProvider = providers.some(
    (provider) => provider.executionConnected,
  )
  const presence = resolveGardenPresence({
    job,
    events,
    ...(stateMap ? { stateMap } : {}),
  })
  const gardenEmployeeName = displayEmployee?.name ?? world.character.name
  const gardenEmployeeRole = displayEmployee?.role ?? world.character.role

  useEffect(() => {
    const onHash = () => {
      setScreen(readScreen())
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

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
    void getHealth()
      .then((health) => {
        if (!cancelled) {
          setFakeHarness(health.fakeHarness)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFakeHarness(false)
        }
      })
    void listProviders()
      .then((listed) => {
        if (cancelled) {
          return
        }
        setProviders(listed.providers)
        if (listed.fakeHarness) {
          setFakeHarness(true)
        }
        setProviderLoadState('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setProviderLoadState('error')
        }
      })
    void listEmployees()
      .then((listed) => {
        if (cancelled) {
          return
        }
        setEmployees(listed)
        setSelectedEmployeeId((current) => current || listed[0]?.id || '')
      })
      .catch(() => {
        // Garden stays usable with the world pack name.
      })
    void listGrowth()
      .then((listed) => {
        if (!cancelled && listed[0]) {
          setGrowth(listed[0])
        }
      })
      .catch(() => {
        // Growth is optional decoration.
      })
    void listPacks()
      .then((listed) => {
        if (!cancelled) {
          setPacks(listed)
        }
      })
      .catch(() => {
        // Settings can stay usable without the pack catalog.
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!workspace) {
      return
    }
    let cancelled = false
    void listJobs(workspace.id)
      .then((jobs) => {
        if (cancelled) {
          return
        }
        setHasJobs(jobs.length > 0)
        if (jobs[0]) {
          setJob(jobs[0])
        }
      })
      .catch(() => {
        // The garden remains usable if job history cannot be loaded.
      })
    return () => {
      cancelled = true
    }
  }, [workspace])

  useEffect(() => {
    if (!displayEmployeeId) {
      return
    }
    let cancelled = false
    void getEmployee(displayEmployeeId)
      .then((detail) => {
        if (cancelled) {
          return
        }
        setStateMap(toGardenStateMap(detail.stateMap))
      })
      .catch(() => {
        if (!cancelled) {
          setStateMap(undefined)
        }
      })
    return () => {
      cancelled = true
    }
  }, [displayEmployeeId])

  useEffect(() => {
    if (!selectedEmployeeId) {
      return
    }
    let cancelled = false
    void getEmployee(selectedEmployeeId)
      .then((detail) => {
        if (!cancelled) {
          setRecentJobs(detail.recentJobs)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecentJobs([])
        }
      })
    void getEmployeeGrowth(selectedEmployeeId, workspace?.id)
      .then((next) => {
        if (!cancelled) {
          setGrowth(next)
        }
      })
      .catch(() => {
        // Drawer still works without growth.
      })
    return () => {
      cancelled = true
    }
  }, [selectedEmployeeId, workspace?.id])

  useEffect(() => {
    if (!job) {
      return
    }
    let cancelled = false
    let lastSnapshot = 0

    async function snapshot() {
      if (!job || cancelled) {
        return
      }
      lastSnapshot = Date.now()
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
        try {
          const nextWorktree = await getJobWorktree(job.id)
          if (!cancelled) {
            setWorktree({
              branchName: nextWorktree.worktree.branchName,
              baseCommit: nextWorktree.worktree.baseCommit,
              status: nextWorktree.worktree.status,
              summary: nextWorktree.diff.summary,
              files: [...nextWorktree.diff.files],
              patch: nextWorktree.diff.patch,
            })
          }
        } catch {
          if (!cancelled) {
            setWorktree(null)
          }
        }
      } catch {
        // Keep the last known snapshot while recovery fails.
      }
    }

    void snapshot()
    const close = openEventStream(
      `/api/jobs/${job.id}/events`,
      (event) => {
        setEvents((current) =>
          current.some((item) => item.id === event.id)
            ? current
            : [...current, event],
        )
        void snapshot()
      },
      () => {
        if (Date.now() - lastSnapshot < 1000) {
          return
        }
        void snapshot()
      },
    )
    return () => {
      cancelled = true
      close()
    }
  }, [job?.id])

  async function refreshProviders() {
    setProviderLoadState('loading')
    setProviderProbeError(null)
    try {
      const listed = await listProviders()
      setProviders(listed.providers)
      if (listed.fakeHarness) {
        setFakeHarness(true)
      }
      setProviderLoadState('ready')
      return listed
    } catch (caught) {
      setProviderLoadState('error')
      setProviderProbeError(
        caught instanceof Error ? caught.message : '接続状態を確認できません',
      )
      throw caught
    }
  }

  async function handleRecheckProvider(id: ProviderId) {
    setBusy(true)
    setProviderProbeError(null)
    try {
      const probed = await probeProvider(id)
      setProviderProbes((current) => ({
        ...current,
        [id]: {
          ...(probed.probe.version ? { version: probed.probe.version } : {}),
          transport: probed.probe.transport,
          warnings: probed.probe.warnings,
          errors: probed.probe.errors,
        },
      }))
      await refreshProviders()
    } catch (caught) {
      setProviderProbeError(
        caught instanceof Error ? caught.message : '再確認に失敗しました',
      )
    } finally {
      setBusy(false)
    }
  }

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

  function jobCreateFields() {
    return {
      ...(selectedEmployeeId ? { employeeId: selectedEmployeeId } : {}),
      ...(selectedEmployee?.supportedJobTypes[0]
        ? { jobType: selectedEmployee.supportedJobTypes[0] }
        : {}),
      ...(selectedProvider === 'auto' ? {} : { selectedProvider }),
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
        ...jobCreateFields(),
      })
      setJob(created)
      setHasJobs(true)
      setEvents([])
      setApprovals([])
      setArtifacts([])
      setRequest('')
      setConfirmation(null)
    } catch (caught) {
      if (
        caught instanceof AppError &&
        (caught.code === 'PROVIDER_UNAVAILABLE' ||
          caught.code === 'PROVIDER_EXECUTION_DISCONNECTED')
      ) {
        const alternatives = Array.isArray(caught.details?.alternatives)
          ? (caught.details.alternatives.filter(
              (item): item is ProviderId =>
                item === 'codex' ||
                item === 'grok-build' ||
                item === 'claude-code',
            ) as ProviderId[])
          : []
        setConfirmation({
          message: caught.message,
          alternatives,
          request: value,
        })
      } else if (
        caught instanceof AppError &&
        caught.code === 'WORKTREE_DIRTY_REPO'
      ) {
        setDirtyRepo({
          message: caught.message,
          request: value,
        })
      } else {
        setError(
          caught instanceof Error ? caught.message : '依頼に失敗しました',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleResolve(id: string, decision: 'approved' | 'denied') {
    setBusy(true)
    setError(null)
    try {
      await resolveApproval(id, decision)
      if (job) {
        const [nextJob, nextEvents, nextApprovals, nextArtifacts] =
          await Promise.all([
            getJob(job.id),
            listJobEvents(job.id),
            listApprovals({ jobId: job.id, status: 'pending' }),
            listArtifacts(job.id),
          ])
        setJob(nextJob)
        setEvents(nextEvents)
        setApprovals(nextApprovals)
        setArtifacts(nextArtifacts)
      }
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

  async function handleDirtyPolicy(
    policy: 'from-head' | 'include-dirty-patch' | 'cancel',
  ) {
    const pending = dirtyRepo?.request ?? request
    setDirtyRepo(null)
    if (policy === 'cancel' || !workspace) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createJob({
        workspaceId: workspace.id,
        request: pending,
        dirtyWorktreePolicy: policy,
        ...jobCreateFields(),
      })
      setJob(created)
      setHasJobs(true)
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

  async function handleSubmitJobWithFallback(
    value: string,
    providerId: ProviderId,
  ) {
    if (!workspace) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createJob({
        workspaceId: workspace.id,
        request: value,
        confirmFallbackProvider: providerId,
        ...jobCreateFields(),
        selectedProvider: providerId,
      })
      setJob(created)
      setHasJobs(true)
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

  async function refreshWorktree(jobId: string) {
    try {
      const nextWorktree = await getJobWorktree(jobId)
      setWorktree({
        branchName: nextWorktree.worktree.branchName,
        baseCommit: nextWorktree.worktree.baseCommit,
        status: nextWorktree.worktree.status,
        summary: nextWorktree.diff.summary,
        files: [...nextWorktree.diff.files],
        patch: nextWorktree.diff.patch,
      })
    } catch {
      setWorktree(null)
    }
  }

  async function handleApplyArtifact(id: string) {
    setBusy(true)
    setError(null)
    try {
      await applyArtifact(id)
      if (job) {
        await refreshWorktree(job.id)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '適用に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleExportArtifact(id: string) {
    setBusy(true)
    setError(null)
    try {
      await exportArtifact(id)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '書き出しに失敗しました',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleKeepWorktree() {
    if (!job) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await keepWorktree(job.id)
      await refreshWorktree(job.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保持に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscardWorktree() {
    if (!job) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await discardWorktree(job.id)
      setWorktree(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '破棄に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const employeeList = useMemo(() => employees, [employees])

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
          <a
            aria-current={screen === 'garden' ? 'page' : undefined}
            href="#garden"
          >
            庭
          </a>
          <a
            aria-current={screen === 'artifacts' ? 'page' : undefined}
            href="#artifacts"
          >
            成果棚
          </a>
          <a
            aria-current={screen === 'employees' ? 'page' : undefined}
            href="#employees"
          >
            AI社員
          </a>
          <a
            aria-current={screen === 'settings' ? 'page' : undefined}
            href="#settings"
          >
            設定
          </a>
        </nav>
        <div
          className="connection-badge"
          data-testid="connection-badge"
          data-status={connection.status}
          title={connection.badgeDetail}
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {connection.badgeLabel}
        </div>
      </header>

      {screen === 'garden' ||
      screen === 'artifacts' ||
      screen === 'employees' ||
      screen === 'settings' ? (
        <main id={screen === 'garden' ? 'garden' : screen}>
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
              <strong data-testid="default-tool">{connection.toolLabel}</strong>
            </div>
          </div>

          {screen === 'garden' ? (
            <>
              <WorldStage
                world={world}
                employeeName={gardenEmployeeName}
                employeeRole={gardenEmployeeRole}
                {...(displayEmployeeId
                  ? { employeeId: displayEmployeeId }
                  : {})}
                level={growth?.level ?? 1}
                unlocks={growth?.unlocks ?? []}
                station={presence.station}
                pose={presence.pose}
                activitySummary={
                  job &&
                  (job.status === 'completed' ||
                    job.status === 'failed' ||
                    job.status === 'cancelled' ||
                    job.status === 'completed_with_invalid_result')
                    ? presence.summary
                    : (latestSummary(events) ?? presence.summary)
                }
              />

              <section className="garden-controls" aria-label="庭の操作">
                <FirstRunGuide
                  hasWorkspace={workspace !== null}
                  hasConnectedProvider={hasConnectedProvider}
                  hasJobs={hasJobs}
                />
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
                          pack.id === world.id
                            ? 'washi-tab is-active'
                            : 'washi-tab'
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
                  employees={employeeList}
                  selectedEmployeeId={selectedEmployeeId}
                  providers={providers}
                  selectedProvider={selectedProvider}
                  {...(confirmation
                    ? {
                        confirmation: {
                          message: confirmation.message,
                          alternatives: confirmation.alternatives,
                        },
                      }
                    : {})}
                  {...(dirtyRepo
                    ? { dirtyRepo: { message: dirtyRepo.message } }
                    : {})}
                  notice={
                    fakeHarness
                      ? '開発用ハーネスです。Codex / Grok Build / Claude Code としては表示しません'
                      : '道具を選び、ログイン済みの実行エンジンだけで仕事を始めます。自動切替はしません'
                  }
                  onRequestChange={setRequest}
                  onEmployeeChange={setSelectedEmployeeId}
                  onProviderChange={setSelectedProvider}
                  onSubmit={(value) => {
                    void handleSubmitJob(value)
                  }}
                  onConfirmFallback={(providerId) => {
                    const pending = confirmation?.request ?? request
                    setSelectedProvider(providerId)
                    setConfirmation(null)
                    void handleSubmitJobWithFallback(pending, providerId)
                  }}
                  onCancelConfirmation={() => {
                    setConfirmation(null)
                  }}
                  onDirtyPolicy={(policy) => {
                    void handleDirtyPolicy(policy)
                  }}
                />

                <CurrentJob
                  job={job}
                  presence={presence}
                  employeeName={gardenEmployeeName}
                  busy={busy}
                  onCancel={() => {
                    void handleCancel()
                  }}
                />

                <div className="garden-peek">
                  <button
                    type="button"
                    className="washi-tab"
                    onClick={() => {
                      setEmployeeDrawerOpen(true)
                    }}
                  >
                    {selectedEmployee?.name ?? gardenEmployeeName}を確認する
                  </button>
                  <a className="washi-tab" href="#artifacts">
                    成果を受け取る
                  </a>
                  <a className="washi-tab" href="#settings">
                    設定
                  </a>
                </div>

                <ArtifactShelf
                  artifacts={artifacts}
                  worktree={worktree}
                  busy={busy}
                  onApply={(id) => {
                    void handleApplyArtifact(id)
                  }}
                  onExport={(id) => {
                    void handleExportArtifact(id)
                  }}
                  onKeep={() => {
                    void handleKeepWorktree()
                  }}
                  onDiscard={() => {
                    void handleDiscardWorktree()
                  }}
                />
              </section>
            </>
          ) : null}

          {screen === 'artifacts' ? (
            <section className="garden-controls">
              <ArtifactShelf
                artifacts={artifacts}
                worktree={worktree}
                busy={busy}
                onApply={(id) => {
                  void handleApplyArtifact(id)
                }}
                onExport={(id) => {
                  void handleExportArtifact(id)
                }}
                onKeep={() => {
                  void handleKeepWorktree()
                }}
                onDiscard={() => {
                  void handleDiscardWorktree()
                }}
              />
            </section>
          ) : null}

          {screen === 'employees' ? (
            <section className="garden-controls" id="employees">
              <p className="section-kicker">庭の住人</p>
              <h2>AI社員</h2>
              <ul className="employee-index">
                {employeeList.map((employee) => (
                  <li key={employee.id}>
                    <button
                      type="button"
                      className="washi-tab"
                      onClick={() => {
                        setSelectedEmployeeId(employee.id)
                        setEmployeeDrawerOpen(true)
                      }}
                    >
                      <span>{employee.name}</span>
                      <small>{employee.role}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {screen === 'settings' ? (
            <section className="garden-controls">
              <SettingsPanel
                workspace={workspace}
                providers={providers}
                busy={busy}
                error={error}
                onRegister={(path) => {
                  void handleRegister(path)
                }}
                onWorkspaceProviderChange={(providerId) => {
                  if (!workspace) {
                    return
                  }
                  void updateWorkspace(workspace.id, providerId).then(
                    setWorkspace,
                  )
                }}
                packs={packs}
                packPreview={packPreview}
                onPreviewPack={(input) => {
                  void previewPack(input).then(setPackPreview)
                }}
                onInstallPack={() => {
                  if (!packPreview) {
                    return
                  }
                  void installPack(packPreview.id).then(() => {
                    setPackPreview(null)
                    void listPacks().then(setPacks)
                    void listEmployees().then(setEmployees)
                  })
                }}
                onUninstallPack={(id) => {
                  void uninstallPack(id).then(() => {
                    void listPacks().then(setPacks)
                    void listEmployees().then(setEmployees)
                  })
                }}
                providerLoadState={providerLoadState}
                providerProbeError={providerProbeError}
                providerProbes={providerProbes}
                onRecheckProvider={(id) => {
                  void handleRecheckProvider(id)
                }}
              />
            </section>
          ) : null}
        </main>
      ) : null}

      <ApprovalPanel
        approvals={approvals}
        employeeName={gardenEmployeeName}
        busy={busy}
        onResolve={(id, decision) => {
          void handleResolve(id, decision)
        }}
        onCancelJob={() => {
          void handleCancel()
        }}
      />

      <EmployeeDrawer
        employee={selectedEmployee}
        recentJobs={recentJobs}
        providers={providers}
        open={employeeDrawerOpen}
        busy={busy}
        onClose={() => {
          setEmployeeDrawerOpen(false)
        }}
        growth={growth}
        onDefaultProviderChange={(providerId) => {
          if (!selectedEmployee) {
            return
          }
          void updateEmployeeDefaultProvider(
            selectedEmployee.id,
            providerId,
          ).then((updated) => {
            setEmployees((current) =>
              current.map((employee) =>
                employee.id === updated.id ? updated : employee,
              ),
            )
          })
        }}
      />

      <footer>
        <p>
          庭だけで頼む・確認する・受け取る。偽の進捗は出しません。社員は資料棚・望遠鏡・作業台・納品台のあいだを移ります。
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

function readScreen(): Screen {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'artifacts' || hash === 'employees' || hash === 'settings') {
    return hash
  }
  return 'garden'
}

function toGardenStateMap(input: {
  states: Record<string, { station: string; pose: string; summary: string }>
  eventBindings: Record<string, string>
}): GardenStateMap {
  const states: Record<string, GardenStateMap['states'][string]> = {}
  for (const [name, state] of Object.entries(input.states)) {
    if (!isGardenStationId(state.station)) {
      continue
    }
    states[name] = {
      station: state.station,
      pose: state.pose,
      summary: state.summary,
    }
  }
  return {
    states,
    eventBindings: input.eventBindings,
  }
}
