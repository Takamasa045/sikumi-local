import { nowIso } from '@sikumi-local/observer-core'
import { identifyLiveAgent } from './identify.js'
import { matchRegisteredRoot } from './match.js'
import { listCurrentUserLiveProcesses } from './processes.js'
import {
  listRecentSessionRecords,
  toLiveSighting,
} from './session-files.js'
import type {
  LiveDiscoveryInput,
  LiveSighting,
} from './types.js'

export function discoverLiveSessions(
  input: LiveDiscoveryInput,
): LiveSighting[] {
  if (input.roots.length === 0) {
    return []
  }
  const now = input.now ?? Date.now()
  const nowStamp = nowIso(new Date(now))
  const byKey = new Map<string, LiveSighting>()

  for (const process of listCurrentUserLiveProcesses({
    currentUser: input.currentUser,
    ...(input.listProcesses ? { listRaw: input.listProcesses } : {}),
  })) {
    const identified = identifyLiveAgent(process)
    const matched = matchRegisteredRoot(process.cwd, input.roots)
    if (!identified || !matched || !process.cwd) {
      continue
    }
    const sighting: LiveSighting = {
      source: identified.source,
      surface: identified.surface,
      kind: 'process',
      cwd: process.cwd,
      repositoryId: matched.repositoryId,
      workspaceId: matched.workspaceId,
      title: null,
      lastObservedAt: nowStamp,
      attributionConfidence: 'verified',
      ingestionMethod: 'process-scan',
      externalSessionId: `live:${identified.source}:${matched.repositoryId}`,
      pid: process.pid,
    }
    byKey.set(`${identified.source}:${matched.repositoryId}`, sighting)
  }

  for (const record of listRecentSessionRecords({
    homeDir: input.homeDir,
    roots: input.roots,
    now,
  })) {
    const sighting = toLiveSighting(record, input.roots)
    if (!sighting) {
      continue
    }
    const key = `${sighting.source}:${sighting.repositoryId}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, sighting)
      continue
    }
    if (existing.kind === 'process' && !existing.title && sighting.title) {
      byKey.set(key, { ...existing, title: sighting.title })
    }
  }

  return [...byKey.values()]
}
