import { nowIso } from '@sikumi-local/observer-core'
import { identifyLiveAgent, isIgnoredLiveHaystack } from './identify.js'
import { locateLiveProcess, sightingFromLocatedProcess } from './locate.js'
import { matchRegisteredPlace } from './match.js'
import { listCurrentUserLiveProcesses } from './processes.js'
import { listRecentSessionRecords, toLiveSighting } from './session-files.js'
import { acceptStoredTitle } from './titles.js'
import type { LiveDiscoveryInput, LiveSighting } from './types.js'

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
    const located = locateLiveProcess({
      process,
      roots: input.roots,
      sessionCwds: sessionRecords
        .filter((record) => record.source === identified.source)
        .map((record) => record.cwd),
    })
    if (!located) {
      continue
    }
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
