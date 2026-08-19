import type { TodayOverview } from '../../api/observer'

export const GARDEN_ACTIVE_WINDOW_MS = 5 * 60_000
export const UNKNOWN_GARDEN_WORK = '仕事の内容はまだ分かっていません'

type OverviewRepository = TodayOverview['repositories'][number]
type OverviewSession = OverviewRepository['sessions'][number]

export type AgentStation =
  'archive' | 'workbench' | 'delivery' | 'waiting' | 'rest'
export type ActorTone = 'waiting' | 'working' | 'completed' | 'observing'

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
  if (!isRecentlyObserved(session.lastObservedAt, nowMs)) {
    return false
  }
  const tone = resolveTone(session.status, session.activity)
  return tone === 'waiting' || tone === 'working'
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

function includesToken(value: string, token: string): boolean {
  return value.includes(token)
}
