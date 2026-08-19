import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MAX_SESSION_ID_LENGTH,
  MIN_SESSION_ID_LENGTH,
  SESSION_ID_PATTERN,
} from './events.js'

export const cooperativeSessionStatuses = [
  'active',
  'waiting-for-user',
  'completed',
  'failed',
] as const
export type CooperativeSessionStatus =
  (typeof cooperativeSessionStatuses)[number]

export interface CooperativeSession {
  readonly id: string
  readonly repositoryId: string
  readonly repositoryPath: string
  readonly status: CooperativeSessionStatus
  readonly summary: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export function cooperativeSessionStorePath(dataDirectory: string): string {
  return join(dataDirectory, 'observer', 'claude-desktop', 'sessions.json')
}

export function createOpaqueSessionId(): string {
  return `cd_${randomBytes(16).toString('hex')}`
}

export function isOpaqueSessionId(value: string): boolean {
  return (
    value.length >= MIN_SESSION_ID_LENGTH &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(value)
  )
}

export function readCooperativeSessions(
  dataDirectory: string,
): Record<string, CooperativeSession> {
  const path = cooperativeSessionStorePath(dataDirectory)
  if (!existsSync(path)) {
    return {}
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    const sessions = (parsed as { sessions?: unknown }).sessions
    if (
      typeof sessions !== 'object' ||
      sessions === null ||
      Array.isArray(sessions)
    ) {
      return {}
    }
    const result: Record<string, CooperativeSession> = {}
    for (const [id, value] of Object.entries(sessions)) {
      if (isSession(value) && isOpaqueSessionId(id)) {
        result[id] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export function writeCooperativeSessions(
  dataDirectory: string,
  sessions: Readonly<Record<string, CooperativeSession>>,
): void {
  const path = cooperativeSessionStorePath(dataDirectory)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(
    temp,
    `${JSON.stringify({ schemaVersion: 1, sessions }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temp, path)
}

export function upsertCooperativeSession(
  dataDirectory: string,
  session: CooperativeSession,
): CooperativeSession {
  const sessions = readCooperativeSessions(dataDirectory)
  sessions[session.id] = session
  writeCooperativeSessions(dataDirectory, sessions)
  return session
}

export function getCooperativeSession(
  dataDirectory: string,
  sessionId: string,
): CooperativeSession | undefined {
  return readCooperativeSessions(dataDirectory)[sessionId]
}

export function sessionFingerprint(input: {
  readonly repositoryId: string
  readonly summary: string | null
}): string {
  return createHash('sha256')
    .update(`${input.repositoryId}\0${input.summary ?? ''}`)
    .digest('hex')
    .slice(0, 16)
}

function isSession(value: unknown): value is CooperativeSession {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    isOpaqueSessionId(record.id) &&
    typeof record.repositoryId === 'string' &&
    typeof record.repositoryPath === 'string' &&
    typeof record.status === 'string' &&
    (cooperativeSessionStatuses as readonly string[]).includes(record.status) &&
    (record.summary === null || typeof record.summary === 'string') &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  )
}
