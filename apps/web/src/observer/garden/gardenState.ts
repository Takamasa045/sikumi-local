import type { TodayOverview } from '../../api/observer'

export const GARDEN_ACTIVE_WINDOW_MS = 5 * 60_000
export const UNKNOWN_GARDEN_WORK = '仕事の内容はまだ分かっていません'

type OverviewRepository = TodayOverview['repositories'][number]
type OverviewSession = OverviewRepository['sessions'][number]

export type AgentStation =
  'observatory' | 'workbench' | 'delivery' | 'waiting' | 'rest'
export type ActorTone = 'waiting' | 'working' | 'completed' | 'observing'

export type GardenActor = {
  key: string
  session: OverviewSession
  repository: OverviewRepository
  station: AgentStation
  tone: ActorTone
  column: number
  row: number
  slot: number
  jitterX: number
  jitterY: number
  sourceDisplayName: string
  sessionDisplayName: string
  workSummary: string
}

export type BulletinItem = {
  key: string
  repository: OverviewRepository
}

const KNOWN_SOURCE_LABELS: Record<string, string> = {
  aider: 'Aider',
  anthropic: 'Claude',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claudeアプリ',
  codex: 'Codex',
  continue: 'Continue',
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
  gemini: 'Gemini',
  grok: 'Grok Build',
  'grok-build': 'Grok Build',
  local: 'ローカル',
  observer: '観測',
  openai: 'OpenAI',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
}

const SOURCE_COLUMN: Record<string, number> = {
  anthropic: 0,
  claude: 0,
  'claude-code': 0,
  'claude-desktop': 0,
  codex: 0,
  copilot: 1,
  cursor: 1,
  vscode: 1,
  windsurf: 1,
  chatgpt: 2,
  gemini: 2,
  grok: 2,
  'grok-build': 2,
  openai: 2,
}

const GENERIC_WORK_TITLES = new Set([
  '作業',
  '作業中',
  '無題',
  '変更元不明の作業',
])

const GENERIC_WORK_PATTERNS = [
  /の作業が始まりました$/,
  /の作業が終わりました$/,
  /の様子が届きました$/,
  /が確認を待っています$/,
  /がファイルを扱っています$/,
  /が道具を使っています$/,
  /のサブエージェントが始まりました$/,
]

const ATLAS_COLUMNS = 3
const ATLAS_ROWS = 4

export function sourceKey(source: string | null | undefined): string {
  return (source ?? '').trim().toLowerCase()
}

export function knownSourceLabel(
  source: string | null | undefined,
): string | null {
  const key = sourceKey(source)
  if (!key) return null
  return KNOWN_SOURCE_LABELS[key] ?? null
}

export function atlasColumnForSource(
  source: string | null | undefined,
): number {
  const key = sourceKey(source)
  const mapped = SOURCE_COLUMN[key]
  if (mapped != null) return mapped % ATLAS_COLUMNS
  return stableHash(`source:${key}`) % ATLAS_COLUMNS
}

export function resolveTone(
  status: string | null | undefined,
  activity: string | null | undefined,
): ActorTone {
  const haystack = `${status ?? ''} ${activity ?? ''}`.toLowerCase()
  if (includesToken(haystack, 'waiting')) return 'waiting'
  if (
    includesToken(haystack, 'running') ||
    includesToken(haystack, 'working') ||
    includesToken(haystack, 'active')
  ) {
    return 'working'
  }
  if (
    includesToken(haystack, 'completed') ||
    includesToken(haystack, 'finished')
  ) {
    return 'completed'
  }
  return 'observing'
}

export function stationForTone(tone: ActorTone): AgentStation {
  if (tone === 'waiting') return 'waiting'
  if (tone === 'working') return 'workbench'
  if (tone === 'completed') return 'delivery'
  return 'rest'
}

export function isUnconfirmedChange(session: OverviewSession): boolean {
  return (
    sourceKey(session.source) === 'git' ||
    session.attributionConfidence === 'inferred'
  )
}

export function isObservedAgent(session: OverviewSession): boolean {
  return (
    sourceKey(session.source) !== 'git' &&
    session.attributionConfidence !== 'inferred'
  )
}

export function isRecentlyObserved(
  lastObservedAt: string | null | undefined,
  nowMs: number,
  windowMs = GARDEN_ACTIVE_WINDOW_MS,
): boolean {
  if (!lastObservedAt) return false
  const then = Date.parse(lastObservedAt)
  if (Number.isNaN(then)) return false
  return nowMs - then <= windowMs
}

export function shouldShowGardenDog(
  session: OverviewSession,
  nowMs: number,
): boolean {
  if (!isObservedAgent(session) || isUnconfirmedChange(session)) {
    return false
  }
  const tone = resolveTone(session.status, session.activity)
  if (tone === 'waiting') return true
  if (tone === 'working') {
    return isRecentlyObserved(session.lastObservedAt, nowMs)
  }
  return false
}

export function isGenericWorkTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? ''
  if (!trimmed) return true
  if (GENERIC_WORK_TITLES.has(trimmed)) return true
  return GENERIC_WORK_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function describeGardenWork(
  session: OverviewSession,
  repository: Pick<OverviewRepository, 'displayName'>,
): string {
  const title = session.title?.trim()
  if (title && !isGenericWorkTitle(title)) {
    return title
  }

  const named = session.displayName?.trim()
  const sourceLabel = knownSourceLabel(session.source)
  if (
    named &&
    !isGenericWorkTitle(named) &&
    named !== sourceLabel &&
    named.toLowerCase() !== sourceKey(session.source)
  ) {
    return named
  }

  const repo = repository.displayName?.trim()
  if (repo) {
    return `${repo}が対象です`
  }

  return UNKNOWN_GARDEN_WORK
}

export function sessionVisibleName(session: OverviewSession): string {
  const named = session.displayName?.trim()
  if (named) return named
  const title = session.title?.trim()
  if (title && !isGenericWorkTitle(title)) return title
  return '無題'
}

export function actorNames(session: OverviewSession): {
  sourceDisplayName: string
  sessionDisplayName: string
} {
  const sessionDisplayName = sessionVisibleName(session)
  const mapped = knownSourceLabel(session.source)
  return {
    sourceDisplayName: mapped ?? sessionDisplayName,
    sessionDisplayName,
  }
}

export function collectGardenState(overview: TodayOverview | null): {
  actors: GardenActor[]
  bulletin: BulletinItem[]
} {
  const actors: GardenActor[] = []
  const bulletin: BulletinItem[] = []
  const seenRepositories = new Set<string>()
  const repositories = overview?.repositories ?? []
  const nowMs = parseOverviewNow(overview)

  for (const repository of repositories) {
    const sessions = repository.sessions ?? []
    let hasUnconfirmed = false

    for (const session of sessions) {
      if (isUnconfirmedChange(session)) {
        hasUnconfirmed = true
        continue
      }
      if (!shouldShowGardenDog(session, nowMs)) continue

      const hash = stableHash(`${repository.repositoryId}|${session.id}`)
      const tone = resolveTone(session.status, session.activity)
      const names = actorNames(session)
      actors.push({
        key: `${repository.repositoryId}:${session.id}`,
        session,
        repository,
        station: stationForTone(tone),
        tone,
        column: atlasColumnForSource(session.source),
        row: hash % ATLAS_ROWS,
        slot: 0,
        jitterX: ((hash % 7) - 3) * 0.18,
        jitterY: (((hash >>> 4) % 5) - 2) * 0.14,
        sourceDisplayName: names.sourceDisplayName,
        sessionDisplayName: names.sessionDisplayName,
        workSummary: describeGardenWork(session, repository),
      })
    }

    if (hasUnconfirmed && !seenRepositories.has(repository.repositoryId)) {
      seenRepositories.add(repository.repositoryId)
      bulletin.push({
        key: repository.repositoryId,
        repository,
      })
    }
  }

  const slotCursor = new Map<AgentStation, number>()
  actors.sort((left, right) => left.key.localeCompare(right.key))
  for (const actor of actors) {
    const next = slotCursor.get(actor.station) ?? 0
    actor.slot = next
    slotCursor.set(actor.station, next + 1)
  }

  return { actors, bulletin }
}

function parseOverviewNow(overview: TodayOverview | null): number {
  const parsed = overview?.generatedAt ? Date.parse(overview.generatedAt) : NaN
  return Number.isNaN(parsed) ? Date.now() : parsed
}

function includesToken(value: string, token: string): boolean {
  return value.includes(token)
}

function stableHash(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
