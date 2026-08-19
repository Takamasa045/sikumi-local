import { nowIso } from '@sikumi-local/observer-core'
import { identifyLiveAgent, isIgnoredLiveHaystack } from './identify.js'
import {
  declaredWorkspaceCwd,
  locateLiveProcess,
  sightingFromLocatedProcess,
} from './locate.js'
import { matchRegisteredPlace, uniqueMatchedPlace } from './match.js'
import { listCurrentUserLiveProcesses } from './processes.js'
import { listRecentSessionRecords, toLiveSighting } from './session-files.js'
import { isSittingLiveProcess } from './sitting.js'
import { acceptStoredTitle } from './titles.js'
import type {
  ExistingLiveSession,
  LiveDiscoveryInput,
  LiveProcessRow,
  LiveSighting,
  LiveSightingActivity,
} from './types.js'

export function discoverLiveSessions(
  input: LiveDiscoveryInput,
): LiveSighting[] {
  if (input.roots.length === 0) {
    return []
  }
  const now = input.now ?? Date.now()
  const nowStamp = nowIso(new Date(now))
  const sessionRecords = listRecentSessionRecords({
    homeDir: input.homeDir,
    roots: input.roots,
    now,
  })
  const byKey = new Map<string, LiveSighting>()

  for (const process of listCurrentUserLiveProcesses({
    currentUser: input.currentUser,
    ...(input.listProcesses ? { listRaw: input.listProcesses } : {}),
  })) {
    if (
      isIgnoredLiveHaystack(
        `${process.command} ${process.args} ${process.cwd ?? ''}`,
      )
    ) {
      continue
    }
    const identified = identifyLiveAgent(process)
    if (!identified) {
      continue
    }
    const recentCwds = sessionRecords
      .filter((record) => record.source === identified.source)
      .map((record) => record.cwd)
    const waitingCwds = waitingSessionCwds(
      input.existingSessions,
      identified.source,
    )
    const located =
      locateLiveProcess({
        process,
        roots: input.roots,
        sessionCwds: recentCwds,
      }) ??
      locateLiveProcess({
        process,
        roots: input.roots,
        sessionCwds: waitingCwds,
      })
    if (!located) {
      continue
    }
    const activity = activityForLocatedProcess({
      process,
      now,
      boundFromOwnCwd: boundFromOwnPlace(process, input.roots),
      waitingHere: waitingCwds.some(
        (cwd) =>
          matchRegisteredPlace(cwd, input.roots)?.root.repositoryId ===
          located.root.repositoryId,
      ),
    })
    const title = titleForLocatedPlace(
      sessionRecords,
      identified.source,
      located.root.repositoryId,
      input.roots,
    )
    const sighting = sightingFromLocatedProcess({
      process,
      source: identified.source,
      surface: identified.surface,
      located,
      title,
      lastObservedAt: nowStamp,
      activity,
    })
    byKey.set(processSightingKey(identified.source, process.pid), sighting)
  }

  for (const record of sessionRecords) {
    if (isIgnoredLiveHaystack(record.cwd)) {
      continue
    }
    const sighting = toLiveSighting(record, input.roots)
    if (!sighting) {
      continue
    }
    if (attachSessionTitleToProcesses(byKey, sighting)) {
      continue
    }
    const key = sessionFileSightingKey(sighting.source, sighting.repositoryId)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, sighting)
    }
  }

  return [...byKey.values()]
}

function processSightingKey(source: string, pid: number): string {
  return `process:${source}:${pid}`
}

function sessionFileSightingKey(source: string, repositoryId: string): string {
  return `session:${source}:${repositoryId}`
}

function attachSessionTitleToProcesses(
  byKey: Map<string, LiveSighting>,
  sighting: LiveSighting,
): boolean {
  let attached = false
  for (const [key, existing] of byKey) {
    if (
      existing.kind !== 'process' ||
      existing.source !== sighting.source ||
      existing.repositoryId !== sighting.repositoryId
    ) {
      continue
    }
    attached = true
    if (
      !acceptStoredTitle(existing.title) &&
      acceptStoredTitle(sighting.title)
    ) {
      byKey.set(key, { ...existing, title: sighting.title })
    }
  }
  return attached
}

function waitingSessionCwds(
  sessions: readonly ExistingLiveSession[] | undefined,
  source: string,
): string[] {
  if (!sessions) {
    return []
  }
  const cwds: string[] = []
  for (const session of sessions) {
    if (session.source !== source || !session.cwd) {
      continue
    }
    if (!isAdoptableWaitingSession(session)) {
      continue
    }
    cwds.push(session.cwd)
  }
  return cwds
}

function isAdoptableWaitingSession(session: ExistingLiveSession): boolean {
  if (isTerminalSessionStatus(session.status)) {
    return false
  }
  return (
    session.status === 'waiting-for-user' ||
    session.activity === 'waiting-for-user' ||
    session.status === 'stale'
  )
}

function isTerminalSessionStatus(status: string): boolean {
  return status === 'completed' || status === 'ended' || status === 'failed'
}

function boundFromOwnPlace(
  process: LiveProcessRow,
  roots: LiveDiscoveryInput['roots'],
): boolean {
  return Boolean(
    uniqueMatchedPlace(
      [declaredWorkspaceCwd(process.args), process.cwd],
      roots,
    ) || uniqueMatchedPlace(process.childCwds ?? [], roots),
  )
}

function activityForLocatedProcess(input: {
  readonly process: LiveProcessRow
  readonly now: number
  readonly boundFromOwnCwd: boolean
  readonly waitingHere: boolean
}): LiveSightingActivity {
  if (isSittingLiveProcess(input.process, input.now)) {
    return 'idle'
  }
  if (!input.boundFromOwnCwd && input.waitingHere) {
    return 'waiting-for-user'
  }
  return 'editing'
}

function titleForLocatedPlace(
  records: readonly {
    readonly source: string
    readonly cwd: string
    readonly title: string | null
  }[],
  source: string,
  repositoryId: string,
  roots: LiveDiscoveryInput['roots'],
): string | null {
  const titles = records
    .filter(
      (record) =>
        record.source === source &&
        record.title &&
        matchRegisteredPlace(record.cwd, roots)?.root.repositoryId ===
          repositoryId,
    )
    .map((record) => acceptStoredTitle(record.title))
    .filter((title): title is string => Boolean(title))
  return titles[0] ?? null
}
