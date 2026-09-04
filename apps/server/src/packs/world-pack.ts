import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { AppError, type GardenWorld } from '@sikumi-local/core'
import { isInsideRoot } from '@sikumi-local/process-runtime'
import type { AppStore } from '../storage/store.js'
import { packError } from './inspect-tree.js'

export const BUILTIN_WORLD_PACKS = [
  { packId: 'dog-office', version: '1.0.0' },
  { packId: 'craft-workshop', version: '1.0.0' },
] as const

export const BUILTIN_WORLD_PACK_IDS: ReadonlySet<string> = new Set(
  BUILTIN_WORLD_PACKS.map((pack) => pack.packId),
)

const WORLD_IMAGE_EXTENSIONS = new Set([
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
])

const WORLD_IMAGE_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
}

const DEFAULT_BACKGROUND_NAMES = ['background.webp', 'background.png']
const DEFAULT_ATLAS_NAMES = ['characters.webp', 'characters.png']

export interface WorldPackLook {
  readonly id: string
  readonly name: string
  readonly lookName: string
  readonly description: string
  readonly backgroundFile: string
  readonly atlasFile: string
  readonly atlasColumns: number
  readonly atlasRows: number
}

export interface WorldPackAsset {
  readonly contentType: string
  readonly body: Buffer
}

export function isBuiltinWorldPackId(packId: string): boolean {
  return BUILTIN_WORLD_PACK_IDS.has(packId)
}

export function worldPackDirectory(
  dataDirectory: string,
  packId: string,
): string {
  return join(dataDirectory, 'worlds', packId)
}

export function gardenWorldAssetUrl(
  packId: string,
  file: string,
  version?: string,
): string {
  const path = `/api/worlds/${encodeURIComponent(packId)}/assets/${encodeURIComponent(file)}`
  return version ? `${path}?v=${encodeURIComponent(version)}` : path
}

export function parseWorldYamlFields(root: string): Map<string, string> | null {
  const yamlPath = join(root, 'world.yaml')
  if (!existsSync(yamlPath)) {
    return null
  }
  const fields = new Map<string, string>()
  for (const line of readFileSync(yamlPath, 'utf8').split('\n')) {
    const match = line.match(/^([a-zA-Z]+):\s*(.+?)\s*$/)
    if (match?.[1] && match[2]) {
      fields.set(match[1], match[2].replace(/^['"]|['"]$/g, ''))
    }
  }
  return fields
}

export function assertSafeWorldPackImages(root: string): void {
  const fields = parseWorldYamlFields(root)
  if (!fields) {
    return
  }
  for (const key of ['background', 'characterAtlas'] as const) {
    const declared = fields.get(key)
    if (!declared) {
      continue
    }
    assertSafeWorldImageName(declared)
    if (!existsSync(join(root, declared))) {
      throw packError('庭の絵が見つかりません')
    }
  }
}

export function resolveWorldPackLook(root: string): WorldPackLook | null {
  const fields = parseWorldYamlFields(root)
  if (!fields) {
    return null
  }
  const id = fields.get('id')
  if (!id) {
    return null
  }
  const backgroundFile = resolveDeclaredOrDefaultImage(
    root,
    fields.get('background'),
    DEFAULT_BACKGROUND_NAMES,
  )
  const atlasFile = resolveDeclaredOrDefaultImage(
    root,
    fields.get('characterAtlas'),
    DEFAULT_ATLAS_NAMES,
  )
  if (!backgroundFile || !atlasFile) {
    return null
  }
  const name = fields.get('name') ?? id
  const lookName = fields.get('lookName') ?? name
  return {
    id,
    name,
    lookName,
    description: fields.get('description') ?? '',
    backgroundFile,
    atlasFile,
    atlasColumns: readAtlasSize(fields.get('atlasColumns'), 3),
    atlasRows: readAtlasSize(fields.get('atlasRows'), 4),
  }
}

export function listInstalledGardenWorlds(
  store: AppStore,
  dataDirectory: string,
): GardenWorld[] {
  const worlds: GardenWorld[] = []
  for (const pack of store.listPacks()) {
    if (
      pack.kind !== 'world' ||
      pack.builtin ||
      isBuiltinWorldPackId(pack.packId)
    ) {
      continue
    }
    const look = resolveWorldPackLook(
      worldPackDirectory(dataDirectory, pack.packId),
    )
    if (!look) {
      continue
    }
    worlds.push(toGardenWorld(look, pack.version))
  }
  return worlds
}

export function readWorldPackAsset(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly packId: string
  readonly file: string
}): WorldPackAsset {
  if (isBuiltinWorldPackId(input.packId)) {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  const pack = input.store.findPack('world', input.packId)
  if (!pack || pack.builtin) {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  assertSafeWorldImageName(input.file)
  const root = worldPackDirectory(input.dataDirectory, input.packId)
  const look = resolveWorldPackLook(root)
  if (
    !look ||
    (input.file !== look.backgroundFile && input.file !== look.atlasFile)
  ) {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  const fullPath = join(root, input.file)
  if (!existsSync(fullPath)) {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  let realFile: string
  let realRoot: string
  try {
    realFile = realpathSync(fullPath)
    realRoot = realpathSync(root)
  } catch {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  if (!isInsideRoot(realFile, realRoot)) {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  const contentType = WORLD_IMAGE_TYPES[extname(input.file).toLowerCase()]
  if (!contentType) {
    throw new AppError('NOT_FOUND', 'この庭の絵は見つかりません', 404)
  }
  return {
    contentType,
    body: readFileSync(fullPath),
  }
}

function toGardenWorld(look: WorldPackLook, version: string): GardenWorld {
  return {
    id: look.id,
    name: look.name,
    lookName: look.lookName,
    description: look.description,
    backgroundUrl: gardenWorldAssetUrl(
      look.id,
      look.backgroundFile,
      version,
    ),
    atlasUrl: gardenWorldAssetUrl(look.id, look.atlasFile, version),
    atlasColumns: look.atlasColumns,
    atlasRows: look.atlasRows,
  }
}

function resolveDeclaredOrDefaultImage(
  root: string,
  declared: string | undefined,
  defaults: readonly string[],
): string | null {
  if (declared) {
    assertSafeWorldImageName(declared)
    return existsSync(join(root, declared)) ? declared : null
  }
  return defaults.find((name) => existsSync(join(root, name))) ?? null
}

function assertSafeWorldImageName(name: string): void {
  if (
    name.includes('\0') ||
    name.includes('\\') ||
    name.includes('/') ||
    name === '.' ||
    name === '..' ||
    name.startsWith('.')
  ) {
    throw packError('庭の絵の場所が正しくありません')
  }
  if (basename(name) !== name) {
    throw packError('庭の絵の場所が正しくありません')
  }
  if (!WORLD_IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw packError('庭の絵の場所が正しくありません')
  }
}

function readAtlasSize(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    return fallback
  }
  return parsed
}
