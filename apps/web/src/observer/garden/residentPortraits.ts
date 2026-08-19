import blogBanPortrait from '../../assets/garden/residents/blog-ban.webp'
import hatarakiPortrait from '../../assets/garden/residents/hataraki.webp'
import shikumiLocalBanPortrait from '../../assets/garden/residents/shikumi-local-ban.webp'

export type GardenResidentKind = 'blog' | 'shikumi' | 'hataraki'

const BLOG_PLACE_NAME = 'ブログ番'
const SHIKUMI_PLACE_NAME = 'しくみローカル番'
const HATARAKI_PLACE_NAME = 'はたらき'
const BLOG_REPO_KEYS = ['blog-agent-kit'] as const
const HATARAKI_KEYS = ['hataraki', 'はたらき'] as const

const PORTRAITS: Readonly<Record<GardenResidentKind, string>> = {
  blog: blogBanPortrait,
  shikumi: shikumiLocalBanPortrait,
  hataraki: hatarakiPortrait,
}

export function gardenResidentPortraitUrl(
  kind: GardenResidentKind | null,
): string | null {
  return kind ? PORTRAITS[kind] : null
}

export function resolveGardenResidentKind(
  placeName: string,
  repositoryName: string,
): GardenResidentKind | null {
  if (isShikumiResident(placeName, repositoryName)) {
    return 'shikumi'
  }
  if (isBlogResident(placeName, repositoryName)) {
    return 'blog'
  }
  if (isHatarakiResident(placeName, repositoryName)) {
    return 'hataraki'
  }
  return null
}

function isShikumiResident(placeName: string, repositoryName: string): boolean {
  if (placeName.trim() === SHIKUMI_PLACE_NAME) {
    return true
  }
  return mentionsShikumiName(placeName) || mentionsShikumiName(repositoryName)
}

function mentionsShikumiName(value: string): boolean {
  const normalized = value.toLowerCase()
  return normalized.includes('shikumi') || normalized.includes('sikumi')
}

function isBlogResident(placeName: string, repositoryName: string): boolean {
  if (placeName.trim() === BLOG_PLACE_NAME) {
    return true
  }
  return identityTokens(placeName, repositoryName).some((token) =>
    BLOG_REPO_KEYS.some((key) => token === key || token.includes(key)),
  )
}

function isHatarakiResident(
  placeName: string,
  repositoryName: string,
): boolean {
  if (
    placeName.trim() === HATARAKI_PLACE_NAME ||
    placeName.trim() === `${HATARAKI_PLACE_NAME}番`
  ) {
    return true
  }
  return identityTokens(placeName, repositoryName).some((token) =>
    HATARAKI_KEYS.some((key) => token === key),
  )
}

function identityTokens(placeName: string, repositoryName: string): string[] {
  return unique([
    ...comparableTokens(placeName),
    ...comparableTokens(repositoryName),
  ])
}

function comparableTokens(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }
  if (isPathLikeName(trimmed)) {
    return [normalizeToken(trimmed)]
  }
  const normalized = normalizeToken(trimmed)
  const withoutBan = normalized.replace(/番$/, '')
  return unique([normalized, withoutBan])
}

function isPathLikeName(value: string): boolean {
  return /[\\/]/.test(value) || value.includes('*')
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replaceAll('_', '-')
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    items.push(value)
  }
  return items
}
