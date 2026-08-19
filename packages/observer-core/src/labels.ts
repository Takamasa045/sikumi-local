import type { ObserverChangeType } from './types.js'

export interface AreaLabel {
  readonly category: string
  readonly label: string
}

const AREA_RULES: ReadonlyArray<{
  readonly pattern: RegExp
  readonly category: string
  readonly label: string
}> = [
  {
    pattern: /(^|\/)(auth|login|session|oauth)/i,
    category: 'auth',
    label: 'ログイン状態',
  },
  {
    pattern: /(^|\/)(user|users|profile|account)/i,
    category: 'users',
    label: 'ユーザー情報',
  },
  {
    pattern: /(^|\/)(api|route|routes|endpoint)/i,
    category: 'api',
    label: 'API',
  },
  {
    pattern: /(schema|migration|prisma|drizzle|sql)/i,
    category: 'schema',
    label: 'データの形',
  },
  {
    pattern: /(config|\.env|settings|yaml|toml)/i,
    category: 'config',
    label: '設定',
  },
  {
    pattern: /(package\.json|pnpm-lock|yarn\.lock|package-lock)/i,
    category: 'package',
    label: '道具の一覧',
  },
  { pattern: /(test|spec|e2e)/i, category: 'test', label: '確認用の仕組み' },
  {
    pattern: /(dashboard|ui|component|page|view|css)/i,
    category: 'ui',
    label: '画面',
  },
  { pattern: /(worktree)/i, category: 'worktree', label: '別作業場' },
]

export function classifyChangedPath(path: string): AreaLabel {
  for (const rule of AREA_RULES) {
    if (rule.pattern.test(path)) {
      return { category: rule.category, label: rule.label }
    }
  }
  return { category: 'other', label: '作業中のファイル' }
}

export function summarizeAreas(paths: readonly string[]): string[] {
  const labels = new Set<string>()
  for (const path of paths) {
    labels.add(classifyChangedPath(path).label)
  }
  return [...labels]
}

export function changeTypeLabel(type: ObserverChangeType): string {
  switch (type) {
    case 'added':
      return '追加'
    case 'deleted':
      return '削除'
    case 'renamed':
      return '名前の変更'
    case 'copied':
      return 'コピー'
    case 'untracked':
      return 'まだ記録していない変更'
    case 'unmerged':
      return '取り込み待ち'
    case 'modified':
      return '変更'
  }
}

export function relativeTimeLabel(
  iso: string | null,
  now = Date.now(),
): string | null {
  if (!iso) {
    return null
  }
  const then = Date.parse(iso)
  if (Number.isNaN(then)) {
    return null
  }
  const deltaMs = Math.max(0, now - then)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) {
    return 'たった今'
  }
  if (minutes < 60) {
    return `${minutes}分前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}時間前`
  }
  const days = Math.floor(hours / 24)
  return `${days}日前`
}
