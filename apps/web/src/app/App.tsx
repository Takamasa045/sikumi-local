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
  updateWorkspaceEmployeeName,
} from '../api/workspaces'
import { ApprovalPanel } from '../approvals/ApprovalPanel'
import { ArtifactShelf } from '../artifacts/ArtifactShelf'
import { EmployeeDrawer } from '../employees/EmployeeDrawer'
import { ObserverGarden } from '../observer/garden/ObserverGarden'
import {
  acknowledgeConflict,
  getConflict,
  getRepositoryActivity,
  getTodayOverview,
  listConflicts,
  recheckConflict,
  rescanRepository,
  resolveConflict,
  type ConflictView,
  type RepositoryActivity,
  type TodayOverview,
} from '../api/observer'
import { ConflictCenter } from '../observer/conflicts/ConflictCenter'
import { ObserverDashboard } from '../observer/dashboard/ObserverDashboard'
import { RepositoryObserverPage } from '../observer/repositories/RepositoryObserverPage'
import { SettingsPanel } from '../settings/SettingsPanel'
import {
  deriveObserverSurfaceSummary,
  deriveProviderConnectionSummary,
  type ProviderLoadState,
} from '../providers/connection-summary'
import './app.css'

type Screen =
  | 'observer'
  | 'repository'
  | 'conflicts'
  | 'garden'
  | 'artifacts'
  | 'employees'
  | 'settings'

export function App() {
  const [screen, setScreen] = useState<Screen>(readScreen())
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
  const [employees, setEmployees] = useState<EmployeeSummary[]>([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [employeeDrawerOpen, setEmployeeDrawerOpen] = useState(false)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [, setEvents] = useState<PersistedEvent[]>([])
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
  const [overview, setOverview] = useState<TodayOverview | null>(null)
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | null>(
    null,
  )
  const [repositoryActivity, setRepositoryActivity] =
    useState<RepositoryActivity | null>(null)
  const [conflicts, setConflicts] = useState<ConflictView[]>([])
  const [conflictCounts, setConflictCounts] = useState({
    red: 0,
    orange: 0,
    yellow: 0,
  })
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(
    null,
  )
  const [conflictDetail, setConflictDetail] = useState<ConflictView | null>(null)
  const [conflictFilters, setConflictFilters] = useState({
    repositoryId: '',
    source: '',
    level: '',
    unconfirmed: false,
  })
  const [showConflictTechnical, setShowConflictTechnical] = useState(false)
  const [worktree, setWorktree] = useState<{
    branchName: string
    baseCommit: string
    status: string
    summary: string
    files: string[]
    patch: string
  } | null>(null)
  const employeeList = useMemo(
    () =>
      employees.map((employee, index) =>
        index === 0 && workspace?.employeeName
          ? { ...employee, name: workspace.employeeName }
          : employee,
      ),
    [employees, workspace?.employeeName],
  )
  const selectedEmployee =
    employeeList.find((employee) => employee.id === selectedEmployeeId) ??
    employeeList[0] ??
    null
  const displayEmployeeId = job?.employeeId ?? selectedEmployeeId
  const displayEmployee =
    employeeList.find((employee) => employee.id === displayEmployeeId) ?? null
  const observerFacing =
    screen === 'garden' ||
    screen === 'observer' ||
    screen === 'repository' ||
    screen === 'conflicts' ||
    screen === 'settings'
  const connection = observerFacing
    ? deriveObserverSurfaceSummary()
    : deriveProviderConnectionSummary({
        loadState: providerLoadState,
        providers,
        fakeHarness,
        defaultProviderId: workspace?.defaultProviderId ?? null,
      })
  const gardenEmployeeName = displayEmployee?.name ?? selectedEmployee?.name ?? '担当'

  useEffect(() => {
    const onHash = () => {
      setScreen(readScreen())
      const repositoryId = readRepositoryId()
      if (repositoryId) {
        setSelectedRepositoryId(repositoryId)
      }
      const conflictId = readConflictId()
      if (conflictId) {
        setSelectedConflictId(conflictId)
      }
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  useEffect(() => {
    if (
      screen !== 'garden' &&
      screen !== 'observer' &&
      screen !== 'repository' &&
      screen !== 'conflicts'
    ) {
      return
    }
    let cancelled = false
    void getTodayOverview()
      .then((listed) => {
        if (!cancelled) {
          setOverview(listed)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOverview((current) =>
            current ?? {
              generatedAt: new Date().toISOString(),
              repositoryCount: 0,
              activeRepositoryCount: 0,
              waitingCount: 0,
              conflictCount: 0,
              repositories: [],
            },
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [screen])

  useEffect(() => {
    if (
      screen !== 'garden' &&
      screen !== 'observer' &&
      screen !== 'repository' &&
      screen !== 'conflicts'
    ) {
      return
    }
    let cancelled = false
    let inflight = false
    let pending = false

    const refreshOverview = () => {
      if (cancelled) {
        return
      }
      if (inflight) {
        pending = true
        return
      }
      inflight = true
      void getTodayOverview()
        .then((listed) => {
          if (!cancelled) {
            setOverview(listed)
          }
        })
        .catch(() => {
          // Keep the last overview.
        })
        .finally(() => {
          inflight = false
          if (pending && !cancelled) {
            pending = false
            refreshOverview()
          }
        })
    }

    const close = openEventStream(
      '/api/observer/events/stream',
      () => {
        refreshOverview()
      },
      () => {
        // Keep the last overview if the stream drops.
      },
    )
    return () => {
      cancelled = true
      close()
    }
  }, [screen])

  useEffect(() => {
    if (!selectedRepositoryId || screen !== 'repository') {
      return
    }
    let cancelled = false
    void getRepositoryActivity(selectedRepositoryId)
      .then((activity) => {
        if (!cancelled) {
          setRepositoryActivity(activity)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRepositoryActivity(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedRepositoryId, screen])

  useEffect(() => {
    if (screen !== 'conflicts') {
      return
    }
    let cancelled = false
    void listConflicts({
      ...(conflictFilters.repositoryId
        ? { repositoryId: conflictFilters.repositoryId }
        : {}),
      ...(conflictFilters.source ? { source: conflictFilters.source } : {}),
      ...(conflictFilters.level ? { level: conflictFilters.level } : {}),
      ...(conflictFilters.unconfirmed ? { unconfirmed: true } : {}),
    })
      .then((listed) => {
        if (cancelled) {
          return
        }
        setConflicts(listed.conflicts)
        setConflictCounts(listed.counts ?? { red: 0, orange: 0, yellow: 0 })
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '衝突の一覧を取得できませんでした')
        }
      })
    return () => {
      cancelled = true
    }
  }, [screen, conflictFilters])

  useEffect(() => {
    if (screen !== 'conflicts' || !selectedConflictId) {
      return
    }
    let cancelled = false
    void getConflict(selectedConflictId, showConflictTechnical ? 'detail' : 'simple')
      .then((conflict) => {
        if (!cancelled) {
          setConflictDetail(conflict)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConflictDetail(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [screen, selectedConflictId, showConflictTechnical])

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

  async function handleRegister(path: string, employeeName: string) {
    setBusy(true)
    setError(null)
    try {
      const created = await registerWorkspace(path, employeeName || undefined)
      if (!workspace) {
        setWorkspace(created)
      }
      try {
        setOverview(await getTodayOverview())
      } catch {
        // Observer can refresh later.
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登録に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function runConflictAction(action: () => Promise<ConflictView>) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      setConflictDetail(next)
      setConflicts((current) =>
        current.map((item) => (item.id === next.id ? next : item)),
      )
      const listed = await listConflicts({
        ...(conflictFilters.repositoryId
          ? { repositoryId: conflictFilters.repositoryId }
          : {}),
        ...(conflictFilters.source ? { source: conflictFilters.source } : {}),
        ...(conflictFilters.level ? { level: conflictFilters.level } : {}),
        ...(conflictFilters.unconfirmed ? { unconfirmed: true } : {}),
      })
      setConflicts(listed.conflicts)
      setConflictCounts(listed.counts ?? { red: 0, orange: 0, yellow: 0 })
      setOverview(await getTodayOverview())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '衝突の操作に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleEmployeeNameChange(employeeName: string) {
    if (!workspace) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      setWorkspace(
        await updateWorkspaceEmployeeName(workspace.id, employeeName),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '名前の保存に失敗しました',
      )
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
            aria-current={isGardenDestination(screen) ? 'page' : undefined}
            href="#garden"
          >
            庭
          </a>
          <a
            aria-current={
              screen === 'observer' ||
              screen === 'repository' ||
              screen === 'conflicts'
                ? 'page'
                : undefined
            }
            href="#observer"
          >
            今日の作業場
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

      {screen === 'observer' ||
      screen === 'repository' ||
      screen === 'conflicts' ||
      screen === 'garden' ||
      screen === 'artifacts' ||
      screen === 'employees' ||
      screen === 'settings' ? (
        <main
          id={
            screen === 'garden'
              ? 'garden'
              : screen === 'observer'
                ? 'observer'
                : screen
          }
        >
          <div className="workspace-line" data-testid="workspace-line">
            <div>
              <span className="eyebrow">観測している場所</span>
              <strong>
                {workspace
                  ? workspace.repository.displayName
                  : 'Repository未登録'}
              </strong>
            </div>
            <div>
              <span className="eyebrow">観測の状態</span>
              <strong data-testid="default-tool">{connection.toolLabel}</strong>
            </div>
          </div>

          {screen === 'observer' ? (
            <ObserverDashboard
              overview={overview}
              workspace={workspace}
              selectedRepositoryId={selectedRepositoryId}
              busy={busy}
              error={error}
              onRegister={(path, employeeName) => {
                void handleRegister(path, employeeName)
              }}
              onSelectRepository={(id) => {
                setSelectedRepositoryId(id)
                window.location.hash = `repository/${id}`
                void getRepositoryActivity(id)
                  .then(setRepositoryActivity)
                  .catch(() => setRepositoryActivity(null))
              }}
              onRescan={(id) => {
                void rescanRepository(id)
                  .then(async (activity) => {
                    setRepositoryActivity(activity)
                    setOverview(await getTodayOverview())
                  })
                  .catch(() => {
                    // Keep the last overview.
                  })
              }}
              onOpenConflicts={() => {
                window.location.hash = 'conflicts'
              }}
            />
          ) : null}

          {screen === 'conflicts' ? (
            <ConflictCenter
              conflicts={conflicts}
              counts={conflictCounts}
              repositories={(overview?.repositories ?? []).map((item) => ({
                id: item.repositoryId,
                name: item.displayName,
              }))}
              selectedId={selectedConflictId}
              detail={conflictDetail}
              showTechnical={showConflictTechnical}
              busy={busy}
              error={error}
              filters={conflictFilters}
              onFilterChange={setConflictFilters}
              onSelect={(id) => {
                setSelectedConflictId(id)
                window.location.hash = `conflicts/${id}`
              }}
              onToggleTechnical={() => {
                setShowConflictTechnical((current) => !current)
              }}
              onAcknowledge={(id) => {
                void runConflictAction(() => acknowledgeConflict(id))
              }}
              onResolve={(id) => {
                void runConflictAction(() => resolveConflict(id))
              }}
              onRecheck={(id) => {
                void runConflictAction(() => recheckConflict(id))
              }}
              onBack={() => {
                window.location.hash = 'observer'
              }}
            />
          ) : null}

          {screen === 'repository' ? (
            <RepositoryObserverPage
              activity={repositoryActivity}
              busy={busy}
              onBack={() => {
                window.location.hash = 'observer'
              }}
              onOpenConflicts={(id) => {
                window.location.hash = id ? `conflicts/${id}` : 'conflicts'
              }}
              onRescan={() => {
                if (!selectedRepositoryId) {
                  return
                }
                void rescanRepository(selectedRepositoryId)
                  .then(setRepositoryActivity)
                  .catch(() => {
                    // Keep the last detail.
                  })
              }}
            />
          ) : null}

          {screen === 'garden' ? (
            <ObserverGarden
              overview={overview}
              onOpenWorkshop={() => {
                window.location.hash = 'observer'
              }}
              onOpenSettings={() => {
                window.location.hash = 'settings'
              }}
            />
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
                onRegister={(path, employeeName) => {
                  void handleRegister(path, employeeName)
                }}
                onEmployeeNameChange={(employeeName) => {
                  void handleEmployeeNameChange(employeeName)
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
          登録した場所の様子を整理します。Gitの用語や、誰が直したかの断定はしません。
        </p>
        <span>Shikumi Local · 127.0.0.1</span>
      </footer>
    </div>
  )
}

function readRepositoryId(): string | null {
  const hash = window.location.hash.replace('#', '')
  if (!hash.startsWith('repository/')) {
    return null
  }
  const id = hash.slice('repository/'.length).trim()
  return id.length > 0 ? id : null
}

function readConflictId(): string | null {
  const hash = window.location.hash.replace('#', '')
  if (!hash.startsWith('conflicts/')) {
    return null
  }
  const id = hash.slice('conflicts/'.length).trim()
  return id.length > 0 ? id : null
}

function isGardenDestination(screen: Screen): boolean {
  return screen === 'garden' || screen === 'artifacts' || screen === 'employees'
}

function readScreen(): Screen {
  const hash = window.location.hash.replace('#', '')
  if (hash.startsWith('repository')) {
    return 'repository'
  }
  if (hash.startsWith('conflicts')) {
    return 'conflicts'
  }
  if (
    hash === 'artifacts' ||
    hash === 'employees' ||
    hash === 'settings' ||
    hash === 'garden' ||
    hash === 'observer'
  ) {
    return hash
  }
  if (hash === 'labs') {
    return 'garden'
  }
  return 'garden'
}
