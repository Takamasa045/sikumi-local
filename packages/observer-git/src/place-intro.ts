import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const README_NAMES = [
  'README.ja.md',
  'readme.ja.md',
  'Readme.ja.md',
  'README.md',
  'readme.md',
  'Readme.md',
  'README',
  'readme',
] as const
const MAX_FILE_BYTES = 128 * 1024
const MAX_INTRO_LENGTH = 80
const HAS_JAPANESE = /[\u3040-\u30ff\u4e00-\u9faf]/
const WORK_WORDS = [
  '働きの画面',
  '観測の庭',
  '働く姿',
  'セッション',
  '動画',
  '記事',
  'ブログ',
  '観測',
] as const
const LANGUAGE_LABEL =
  /^(?:english|en|japanese|ja|日本語|中文|chinese|zh|한국어|korean|ko|kr|français|french|fr|deutsch|german|de|español|spanish|es|简体中文|繁體中文|繁体中文)$/i

const ENGLISH_PLACE_LOOKS: ReadonlyArray<{
  readonly pattern: RegExp
  readonly spoken: string
}> = [
  {
    pattern: /video[- ]?production|\bvideo\b[^.]{0,40}\bworkshop\b/i,
    spoken: '動画を作る場所',
  },
  {
    pattern: /\bobserv(?:e|ation|atory|er)\b/i,
    spoken: '観測する場所',
  },
  {
    pattern: /\bblog\b|\barticles?\b/i,
    spoken: '記事を書く場所',
  },
]

export function readPlaceIntro(root: string): string | null {
  const text = readReadme(root)
  if (!text) {
    return null
  }
  const heading = sanitizeIntroPart(firstHeading(text))
  const paragraph = sanitizeIntroPart(firstWorkParagraph(text))
  const spokenHeading = spokenIntro(heading)
  const spokenParagraph = spokenIntro(paragraph)
  if (spokenHeading && spokenParagraph && spokenHeading !== spokenParagraph) {
    const joined = `${spokenHeading}。${spokenParagraph}`
    const spokenJoined = spokenIntro(joined) ?? spokenParagraph
    return clipIntro(spokenJoined, spokenParagraph)
  }
  return clipIntro(spokenParagraph ?? spokenHeading)
}

function readReadme(root: string): string | null {
  const found: { readonly name: string; readonly text: string }[] = []
  for (const name of README_NAMES) {
    const text = readBoundedFile(join(root, name))
    if (text) {
      found.push({ name, text })
    }
  }
  const japaneseJa = found.find(
    (item) => /\.ja\.md$/i.test(item.name) && HAS_JAPANESE.test(item.text),
  )
  if (japaneseJa) {
    return japaneseJa.text
  }
  const japanese = found.find((item) => HAS_JAPANESE.test(item.text))
  if (japanese) {
    return japanese.text
  }
  return found[0]?.text ?? null
}

function firstHeading(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const match = /^#{1,3}\s+(.+)$/.exec(raw.trim())
    if (match) {
      return match[1] ?? null
    }
  }
  return null
}

function firstWorkParagraph(text: string): string | null {
  const japanese = collectWorkParagraph(text, true)
  if (japanese) {
    return japanese
  }
  return collectWorkParagraph(text, false)
}

function collectWorkParagraph(
  text: string,
  japaneseOnly: boolean,
): string | null {
  const parts: string[] = []
  let started = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (isLanguageSwitchLine(line) || isBadgeOrImageLine(line)) {
      continue
    }
    if (!line || isStructuralSkipLine(line)) {
      if (started) {
        break
      }
      continue
    }
    if (japaneseOnly && !HAS_JAPANESE.test(line)) {
      if (started) {
        break
      }
      continue
    }
    started = true
    parts.push(line)
  }
  return parts.length > 0 ? parts.join('') : null
}

function isStructuralSkipLine(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^[-*+]\s/.test(line) ||
    /^[-|: ]+$/.test(line) ||
    /^>/.test(line)
  )
}

function isBadgeOrImageLine(line: string): boolean {
  return /^!\[/.test(line) || /^\[!\[/.test(line)
}

function isLanguageSwitchLine(line: string): boolean {
  const visible = unwrapMarkup(line)
  if (!visible) {
    return false
  }
  if (
    /言語切替|language\s*(?:switch|select|toggle)|translations?/i.test(visible)
  ) {
    return true
  }
  const parts = visible
    .replace(/[（）()【】[\]]/g, ' ')
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    const languageParts = parts.filter((part) => LANGUAGE_LABEL.test(part))
    if (languageParts.length >= 2) {
      return true
    }
  }
  const tokens = visible.split(/\s+/).filter(Boolean)
  return (
    tokens.length >= 2 && tokens.every((token) => LANGUAGE_LABEL.test(token))
  )
}

function unwrapMarkup(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeIntroPart(value: string | null): string | null {
  if (!value) {
    return null
  }
  const title = unwrapMarkup(value)
  if (!title || isLanguageSwitchLine(title) || isProperNameOnly(title)) {
    return null
  }
  if (
    title === 'README' ||
    title === 'readme' ||
    /[\\/]/.test(title) ||
    /\.(md|ya?ml|log|ts|tsx|css|json)$/i.test(title) ||
    /^[0-9a-f]{7,40}$/i.test(title) ||
    /\b(SHA|commit|HEAD|origin)\b/i.test(title) ||
    title.includes('まだ分かっていません') ||
    title.includes('変更元不明') ||
    title.includes('縁側にいます') ||
    isLeftoverAreaOnly(title)
  ) {
    return null
  }
  return title
}

function isProperNameOnly(value: string): boolean {
  if (HAS_JAPANESE.test(value)) {
    return false
  }
  return /^[A-Za-z][A-Za-z0-9._-]{0,40}$/.test(value)
}

function isLeftoverAreaOnly(value: string): boolean {
  const normalized = value.replace(/[。．.、，,\s]/g, '')
  return (
    normalized === '確認用の仕組み' ||
    normalized === '確認の仕組み' ||
    normalized === '作業中のファイル'
  )
}

function spokenIntro(value: string | null): string | null {
  if (!value) {
    return null
  }
  if (HAS_JAPANESE.test(value)) {
    return value
  }
  return everydayJapaneseFromEnglish(value)
}

function everydayJapaneseFromEnglish(value: string): string | null {
  for (const look of ENGLISH_PLACE_LOOKS) {
    if (look.pattern.test(value)) {
      return look.spoken
    }
  }
  return null
}

function clipIntro(
  value: string | null,
  fallbackWithWork?: string | null,
): string | null {
  if (!value) {
    return null
  }
  if (value.length <= MAX_INTRO_LENGTH) {
    return value
  }
  const workPreserving = clipKeepingWorkWord(value)
  if (hasWorkWord(workPreserving)) {
    return workPreserving
  }
  if (fallbackWithWork && hasWorkWord(fallbackWithWork)) {
    return clipKeepingWorkWord(fallbackWithWork)
  }
  return clipAtSentence(value.slice(0, MAX_INTRO_LENGTH))
}

function clipKeepingWorkWord(value: string): string {
  if (value.length <= MAX_INTRO_LENGTH) {
    return value
  }
  const work = firstWorkWord(value)
  if (!work) {
    return clipAtSentence(value.slice(0, MAX_INTRO_LENGTH))
  }
  const workEnd = work.index + work.word.length
  if (workEnd <= MAX_INTRO_LENGTH) {
    return clipAtSentence(value.slice(0, MAX_INTRO_LENGTH))
  }
  const sentenceStart = value.lastIndexOf('。', work.index) + 1
  const fromSentence = value.slice(sentenceStart).trim()
  if (fromSentence.length <= MAX_INTRO_LENGTH) {
    return fromSentence
  }
  if (work.word.length >= MAX_INTRO_LENGTH) {
    return work.word.slice(0, MAX_INTRO_LENGTH)
  }
  const localEnd = work.index - sentenceStart + work.word.length
  const windowStart = Math.max(0, localEnd - MAX_INTRO_LENGTH)
  return fromSentence.slice(windowStart, windowStart + MAX_INTRO_LENGTH).trim()
}

function clipAtSentence(value: string): string {
  const end = value.lastIndexOf('。')
  if (end >= 12) {
    return value.slice(0, end + 1).trim()
  }
  return value.trim()
}

function firstWorkWord(
  value: string,
): { readonly word: string; readonly index: number } | null {
  let best: { readonly word: string; readonly index: number } | null = null
  for (const word of WORK_WORDS) {
    const index = value.indexOf(word)
    if (index >= 0 && (!best || index < best.index)) {
      best = { word, index }
    }
  }
  return best
}

function hasWorkWord(value: string | null | undefined): boolean {
  return Boolean(value && firstWorkWord(value))
}

function readBoundedFile(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) {
      return null
    }
    const size = statSync(path).size
    if (size <= 0 || size > MAX_FILE_BYTES) {
      return null
    }
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
