import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ARTICLES_LOG = 'articles.log'
const BLOG_WORKSPACE = 'BLOG_WORKSPACE.md'
const TOPICS_DIR = 'topics'
const BRIEF_NAMES = ['brief.yml', 'brief.yaml'] as const
const KIT_FILE_NAMES = new Set([
  ARTICLES_LOG,
  BLOG_WORKSPACE,
  'MEMORY.md',
  'STYLE.md',
])
const MAX_FILE_BYTES = 64 * 1024
const MAX_TITLE_LENGTH = 80
const MAX_ARTICLE_TITLES = 10
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/
const TOPIC_FOLDER = /^(\d{4}-\d{2}-\d{2})_[A-Za-z0-9][A-Za-z0-9._-]*$/
const TITLE_LINE = /^\s*title\s*:\s*(.+?)\s*$/i

export type BlogArticleTitle = {
  readonly title: string
  readonly date: string | null
}

export function looksLikeBlogKit(root: string): boolean {
  const articlesLog = isFile(join(root, ARTICLES_LOG))
  const topics = isDirectory(join(root, TOPICS_DIR))
  const workspace = isFile(join(root, BLOG_WORKSPACE))
  return articlesLog || (topics && workspace)
}

export function readBlogWorkStory(
  root: string,
  input: { readonly changedPaths?: readonly string[] } = {},
): string | null {
  if (!looksLikeBlogKit(root)) {
    return null
  }

  const changed = normalizeChangedPaths(input.changedPaths)
  const inProgress = readInProgressTopicTitle(root, changed)
  if (inProgress) {
    return `『${inProgress}』を書いています`
  }

  const latest = readLatestArticleTitle(root)
  if (latest) {
    return `いちばん新しい記事は『${latest}』です`
  }

  return '記事の続きがある'
}

export function readBlogArticleTitles(
  root: string,
  limit = MAX_ARTICLE_TITLES,
): BlogArticleTitle[] {
  if (!looksLikeBlogKit(root)) {
    return []
  }

  const seen = new Set<string>()
  const collected: BlogArticleTitle[] = []

  for (const article of readArticlesLogTitles(root).reverse()) {
    addArticleTitle(collected, seen, article)
  }
  for (const article of readTopicBriefTitles(root).reverse()) {
    addArticleTitle(collected, seen, article)
  }

  collected.sort((left, right) => {
    if (left.date && right.date && left.date !== right.date) {
      return right.date.localeCompare(left.date)
    }
    if (left.date && !right.date) {
      return -1
    }
    if (!left.date && right.date) {
      return 1
    }
    return 0
  })

  return collected.slice(0, Math.min(12, Math.max(1, limit)))
}

function addArticleTitle(
  collected: BlogArticleTitle[],
  seen: Set<string>,
  article: BlogArticleTitle,
): void {
  if (seen.has(article.title)) {
    return
  }
  seen.add(article.title)
  collected.push(article)
}

function readLatestArticleTitle(root: string): string | null {
  const fromLog = readLatestArticlesLogTitle(root)
  if (fromLog) {
    return fromLog
  }
  return readNewestTopicBriefTitle(root)
}

function readLatestArticlesLogTitle(root: string): string | null {
  const titles = readArticlesLogTitles(root)
  return titles[titles.length - 1]?.title ?? null
}

function readArticlesLogTitles(root: string): BlogArticleTitle[] {
  const text = readBoundedFile(join(root, ARTICLES_LOG))
  if (text === null) {
    return []
  }
  const articles: BlogArticleTitle[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const article = parseArticlesLogEntry(rawLine)
    if (article) {
      articles.push(article)
    }
  }
  return articles
}

function parseArticlesLogEntry(line: string): BlogArticleTitle | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || /^[-|: ]+$/.test(trimmed)) {
    return null
  }
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
  if (cells.length < 2) {
    return null
  }
  const date = cells[0] ?? ''
  const title = sanitizeArticleTitle(cells[1] ?? '')
  if (!DATE_PREFIX.test(date) || !title) {
    return null
  }
  return { title, date }
}

function readTopicBriefTitles(root: string): BlogArticleTitle[] {
  const articles: BlogArticleTitle[] = []
  for (const folder of listTopicFolders(root)) {
    const title = readTopicBriefTitle(root, folder)
    if (!title) {
      continue
    }
    const date = DATE_PREFIX.exec(folder)?.[1] ?? null
    articles.push({ title, date })
  }
  return articles
}

function readInProgressTopicTitle(
  root: string,
  changedPaths: readonly string[],
): string | null {
  const folders = listTopicFolders(root)
  const dirty = folders.filter((folder) =>
    changedPaths.some(
      (path) => path === `topics/${folder}` || path.startsWith(`topics/${folder}/`),
    ),
  )
  const newestDirty = dirty[dirty.length - 1]
  if (!newestDirty) {
    return null
  }
  return readTopicBriefTitle(root, newestDirty)
}

function readNewestTopicBriefTitle(root: string): string | null {
  const folders = listTopicFolders(root)
  for (let index = folders.length - 1; index >= 0; index -= 1) {
    const title = readTopicBriefTitle(root, folders[index]!)
    if (title) {
      return title
    }
  }
  return null
}

function listTopicFolders(root: string): string[] {
  const directory = join(root, TOPICS_DIR)
  if (!isDirectory(directory)) {
    return []
  }
  try {
    return readdirSync(directory)
      .filter((name) => TOPIC_FOLDER.test(name) && isDirectory(join(directory, name)))
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function readTopicBriefTitle(root: string, folder: string): string | null {
  for (const name of BRIEF_NAMES) {
    const title = readBriefTitle(join(root, TOPICS_DIR, folder, name))
    if (title) {
      return title
    }
  }
  return null
}

function readBriefTitle(path: string): string | null {
  const text = readBoundedFile(path)
  if (text === null) {
    return null
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const match = TITLE_LINE.exec(rawLine)
    if (!match) {
      continue
    }
    const title = sanitizeArticleTitle(stripYamlQuotes(match[1] ?? ''))
    if (title) {
      return title
    }
  }
  return null
}

function sanitizeArticleTitle(value: string): string | null {
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return null
  }
  if (KIT_FILE_NAMES.has(title)) {
    return null
  }
  if (/[\\/]/.test(title) || /\.(md|ya?ml|log|ts|tsx|css|json)$/i.test(title)) {
    return null
  }
  if (/^[0-9a-f]{7,40}$/i.test(title)) {
    return null
  }
  if (title.includes('まだ分かっていません') || title.includes('変更元不明')) {
    return null
  }
  return title
}

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function normalizeChangedPaths(
  paths: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const path of paths ?? []) {
    const next = path.replaceAll('\\', '/').replace(/^\.?\//, '').replace(/\/+$/, '')
    if (!next || seen.has(next)) {
      continue
    }
    seen.add(next)
    normalized.push(next)
  }
  return normalized
}

function readBoundedFile(path: string): string | null {
  if (!isFile(path)) {
    return null
  }
  try {
    const size = statSync(path).size
    if (size <= 0 || size > MAX_FILE_BYTES) {
      return null
    }
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}
