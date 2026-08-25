import type { ControlPlaneSnapshot } from '../api/observer'

const HAS_JAPANESE = /[\u3040-\u30ff\u4e00-\u9faf]/
const SHA_TOKEN = /\b[0-9a-f]{7,40}\b/i
const SHA_ONLY = /^[0-9a-f]{7,40}$/i

const FORBIDDEN_EVERYDAY = [/Grok 2/gi, /fake-claude/gi, /変更元不明/g, /縁側/g]

const GENERIC_AFTER_STRIP = new Set(['作業', 'の作業', '作業中', '無題'])

const TOOL_LABELS: Record<string, string> = {
  codex: 'Codex',
  cursor: 'Cursor',
  'grok-build': 'Grok',
  grok: 'Grok',
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Code',
}

const ACTIVITY_LOOK: Record<string, string> = {
  starting: '始めています',
  planning: '組み立てています',
  reading: '読んでいます',
  editing: '直しています',
  'running-command': '道具を使っています',
  testing: '確かめています',
  reviewing: '見直しています',
  'waiting-for-user': '確認を待っています',
  idle: '合間にいます',
  completed: '届けました',
  failed: '止まっています',
  unknown: '動いています',
}

export type ControlRoomWork = ControlPlaneSnapshot['works'][number]
export type ControlRoomAttention = ControlPlaneSnapshot['attention'][number]
export type ControlRoomPlace = ControlPlaneSnapshot['repositories'][number]

export interface ControlRoomSummary {
  readonly runningAiCount: number
  readonly placeCount: number
  readonly attentionCount: number
  readonly waitingCount: number
}

export interface ControlRoomTechnical {
  readonly branch: string | null
  readonly worktreePath: string | null
  readonly commit: string | null
}

export function toolLabel(
  source: string | null | undefined,
  displayName?: string | null,
): string | null {
  const key = (source ?? '').trim().toLowerCase()
  if (key === 'git') {
    return null
  }
  if (TOOL_LABELS[key]) {
    return TOOL_LABELS[key]
  }
  const named = everydayText(displayName)
  if (named && !isForbiddenEveryday(named)) {
    return named
  }
  return null
}

export function everydayText(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) {
    return null
  }
  if (SHA_ONLY.test(trimmed)) {
    return null
  }
  let next = trimmed
    .replace(/\bGrok Build\b/gi, 'Grok')
    .replace(/\bGrok 2\b/gi, 'Grok')
  for (const pattern of FORBIDDEN_EVERYDAY) {
    next = next.replace(pattern, '')
  }
  next = next.replace(SHA_TOKEN, '').replace(/\s+/g, ' ').trim()
  next = next.replace(/^[のでにをはがとへ]+\s*/u, '').trim()
  if (!next || GENERIC_AFTER_STRIP.has(next)) {
    return null
  }
  if (
    !HAS_JAPANESE.test(next) &&
    SHA_ONLY.test(next.replace(/[^0-9a-f]/gi, ''))
  ) {
    return null
  }
  return next
}

export function isForbiddenEveryday(value: string): boolean {
  return (
    /Grok 2/i.test(value) ||
    /fake-claude/i.test(value) ||
    value.includes('変更元不明') ||
    value.includes('縁側') ||
    SHA_ONLY.test(value.trim())
  )
}

export function isRunningWork(
  work: Pick<ControlRoomWork, 'source' | 'status'>,
): boolean {
  return (
    work.source !== 'git' &&
    work.status !== 'ended' &&
    work.status !== 'completed' &&
    work.status !== 'failed'
  )
}

export function summarizeControlPlane(
  snapshot: ControlPlaneSnapshot,
): ControlRoomSummary {
  return {
    runningAiCount: snapshot.works.filter(isRunningWork).length,
    placeCount: snapshot.repositories.length,
    attentionCount: snapshot.attention.length,
    waitingCount: snapshot.attention.filter(
      (item) => item.kind === 'waiting-for-user',
    ).length,
  }
}

export function workNowText(work: ControlRoomWork): string {
  const tool = toolLabel(work.source, work.displayName)
  const title = everydayText(work.title)
  const look = activityLook(work.activity, work.status)
  if (tool && title) {
    return `${tool}が、${title}をしています`
  }
  if (tool) {
    return `${tool}が${look}`
  }
  if (title) {
    return title
  }
  return 'いまの仕事を見ています'
}

export function workListText(work: ControlRoomWork): string {
  const tool = toolLabel(work.source, work.displayName)
  const title = everydayText(work.title)
  const look = activityLook(work.activity, work.status)
  if (tool && title) {
    return `${tool}が、${title}`
  }
  if (tool) {
    return `${tool}が${look}`
  }
  return title ?? '動いている仕事があります'
}

export function activityLook(
  activity: string | null | undefined,
  status?: string | null,
): string {
  if (status === 'waiting-for-user' || activity === 'waiting-for-user') {
    return '確認を待っています'
  }
  if (status === 'stale') {
    return '様子が途切れています'
  }
  return ACTIVITY_LOOK[activity ?? ''] ?? '動いています'
}

export function workNextText(
  work: ControlRoomWork,
  attention: readonly ControlRoomAttention[],
): string {
  const related = attention.filter((item) => item.workIds.includes(work.id))
  if (related.some((item) => item.kind === 'waiting-for-user')) {
    return 'あなたの確認が必要です'
  }
  if (related.some((item) => item.kind === 'conflict')) {
    return 'ぶつからないか、先に見てください'
  }
  if (
    work.status === 'waiting-for-user' ||
    work.activity === 'waiting-for-user'
  ) {
    return 'あなたの確認が必要です'
  }
  if (
    work.status === 'stale' ||
    related.some((item) => item.kind === 'stale-work')
  ) {
    return '続きがあるか、様子を見てください'
  }
  return 'この仕事の続きです'
}

export function placeNowText(place: ControlRoomPlace): string {
  const running = place.works.filter(isRunningWork)
  if (running.length === 0) {
    return 'いま動いている仕事はありません'
  }
  if (running.length === 1) {
    return workNowText(running[0]!)
  }
  const names = unique(
    running
      .map((work) => toolLabel(work.source, work.displayName))
      .filter((name): name is string => Boolean(name)),
  )
  if (names.length === 0) {
    return `${running.length}件の仕事が動いています`
  }
  if (names.length === 1) {
    return `${names[0]}が、${running.length}件の仕事をしています`
  }
  return `${names.join('と')}が、同じ場所で動いています`
}

export function placeNextText(place: ControlRoomPlace): string {
  if (place.attention.some((item) => item.kind === 'conflict')) {
    return '同じファイルを書いていないか、見てください'
  }
  if (place.waitingCount > 0) {
    return '確認待ちがあります'
  }
  if (place.staleCount > 0) {
    return '途切れている仕事の様子を見てください'
  }
  if (place.works.some(isRunningWork)) {
    return 'この場所の仕事の続きです'
  }
  return 'いまは待ちはありません'
}

export function relatedWorkSentence(
  current: ControlRoomWork,
  works: readonly ControlRoomWork[],
): string | null {
  const others = works.filter(
    (work) =>
      work.id !== current.id &&
      work.repositoryId &&
      work.repositoryId === current.repositoryId &&
      isRunningWork(work),
  )
  if (others.length === 0) {
    return null
  }
  const first = others[0]!
  const tool = toolLabel(first.source, first.displayName)
  const title = everydayText(first.title)
  if (tool && title) {
    return `同じ場所で、${tool}も${title}をしています`
  }
  if (tool) {
    return `同じ場所で、${tool}も動いています`
  }
  return '同じ場所で、ほかの仕事も動いています'
}

export function attentionTone(
  severity: string,
): 'red' | 'yellow' | 'orange' | 'info' {
  if (severity === 'red') {
    return 'red'
  }
  if (severity === 'orange') {
    return 'orange'
  }
  if (severity === 'info') {
    return 'info'
  }
  return 'yellow'
}

export function attentionKindLabel(kind: string): string {
  switch (kind) {
    case 'conflict':
      return '衝突'
    case 'waiting-for-user':
      return '確認待ち'
    case 'stale-work':
      return '止まっている可能'
    case 'unknown-owner':
      return '持ち主不明'
    case 'observer-degraded':
      return '観測の劣化'
    default:
      return '注意'
  }
}

export function degradedAdapterLabel(source: string): string {
  return toolLabel(source) ?? '観測の道具'
}

export function placeLabel(
  repositoryId: string | null,
  repositories: readonly ControlRoomPlace[],
): string | null {
  if (!repositoryId) {
    return null
  }
  return (
    repositories.find((item) => item.repositoryId === repositoryId)
      ?.displayName ?? null
  )
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
