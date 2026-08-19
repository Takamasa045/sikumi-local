import type { TodayOverview } from '../../api/observer'

export const GARDEN_ACTIVE_WINDOW_MS = 5 * 60_000
export const GARDEN_OVERVIEW_REFRESH_MS = 5_000
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
  'init',
  'initial commit',
  'first commit',
])

const GIT_JARGON =
  /\b(merge|rebase|cherry-pick|commit|commits|branch|HEAD|origin|refs)\b/i
const SHA_ONLY = /^[0-9a-f]{7,40}$/i
const HAS_JAPANESE = /[\u3040-\u30ff\u4e00-\u9faf]/
const CONVENTIONAL_COMMIT_PREFIX =
  /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\([^)]*\))?(!)?:\s*/i

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
  const statusKey = (status ?? '').toLowerCase()
  const activityKey = (activity ?? '').toLowerCase()
  if (
    includesToken(statusKey, 'waiting') ||
    includesToken(activityKey, 'waiting')
  ) {
    return 'waiting'
  }
  if (includesToken(statusKey, 'stale')) {
    return 'observing'
  }
  if (
    includesToken(activityKey, 'idle') &&
    !includesToken(statusKey, 'running') &&
    !includesToken(statusKey, 'working')
  ) {
    return 'observing'
  }
  if (
    includesToken(statusKey, 'running') ||
    includesToken(statusKey, 'working') ||
    includesToken(activityKey, 'running') ||
    includesToken(activityKey, 'working') ||
    includesToken(activityKey, 'editing') ||
    (includesToken(statusKey, 'active') && !includesToken(activityKey, 'idle'))
  ) {
    return 'working'
  }
  if (
    includesToken(statusKey, 'completed') ||
    includesToken(activityKey, 'completed') ||
    includesToken(statusKey, 'finished') ||
    includesToken(activityKey, 'finished')
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
  if (tone === 'waiting') {
    return true
  }
  if (tone !== 'working') {
    return false
  }
  return isRecentlyObserved(session.lastObservedAt, nowMs)
}

export function isGenericWorkTitle(title: string | null | undefined): boolean {
  const trimmed = title?.trim() ?? ''
  if (!trimmed) return true
  if (GENERIC_WORK_TITLES.has(trimmed)) return true
  return GENERIC_WORK_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function softenRecordTitle(title: string | null | undefined): string {
  return (title ?? '').trim().replace(CONVENTIONAL_COMMIT_PREFIX, '').trim()
}

export function isEverydayRecordTitle(
  title: string | null | undefined,
): boolean {
  const trimmed = softenRecordTitle(title)
  if (isGenericWorkTitle(trimmed)) return false
  if (SHA_ONLY.test(trimmed)) return false
  if (GIT_JARGON.test(trimmed)) return false
  if (/^(Merge|Revert|Rebase)\b/.test(trimmed)) return false
  return true
}

export function isSpokenJapaneseTitle(
  title: string | null | undefined,
): boolean {
  const trimmed = softenRecordTitle(title)
  return isEverydayRecordTitle(trimmed) && HAS_JAPANESE.test(trimmed)
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
