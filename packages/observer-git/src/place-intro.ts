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
const MAX_FILE_BYTES = 16 * 1024
const MAX_INTRO_LENGTH = 80
const HAS_JAPANESE = /[\u3040-\u30ff\u4e00-\u9faf]/

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
  const paragraph = sanitizeIntroPart(firstParagraph(text))
  const spokenHeading = spokenIntro(heading)
  const spokenParagraph = spokenIntro(paragraph)
  if (spokenHeading && spokenParagraph && spokenHeading !== spokenParagraph) {
    const joined = `${spokenHeading}。${spokenParagraph}`
    return clipIntro(spokenIntro(joined) ?? spokenParagraph)
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

function firstParagraph(text: string): string | null {
  const parts: string[] = []
  let started = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (
      !line ||
      /^```/.test(line) ||
      /^#{1,6}\s/.test(line) ||
      /^[-*+]\s/.test(line) ||
      /^[-|: ]+$/.test(line)
    ) {
      if (started) {
        break
      }
      continue
    }
    started = true
    parts.push(line)
    if (parts.join('').length >= MAX_INTRO_LENGTH) {
      break
    }
  }
  return parts.length > 0 ? parts.join('') : null
}

function sanitizeIntroPart(value: string | null): string | null {
  if (!value) {
    return null
  }
  const title = value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) {
    return null
  }
  const clipped =
    title.length > MAX_INTRO_LENGTH
      ? title.slice(0, MAX_INTRO_LENGTH).trim()
      : title
  if (
    clipped === 'README' ||
    clipped === 'readme' ||
    /[\\/]/.test(clipped) ||
    /\.(md|ya?ml|log|ts|tsx|css|json)$/i.test(clipped) ||
    /^[0-9a-f]{7,40}$/i.test(clipped) ||
    /\b(SHA|commit|HEAD|origin)\b/i.test(clipped) ||
    clipped.includes('まだ分かっていません') ||
    clipped.includes('変更元不明')
  ) {
    return null
  }
  return clipped
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

function clipIntro(value: string | null): string | null {
  if (!value) {
    return null
  }
  if (value.length <= MAX_INTRO_LENGTH) {
    return value
  }
  return value.slice(0, MAX_INTRO_LENGTH).trim()
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
