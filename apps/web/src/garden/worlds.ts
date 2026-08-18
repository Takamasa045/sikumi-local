import type { GardenStationId } from '@sikumi-local/core'
import craftBackground from '../assets/worlds/craft-workshop/background.webp'
import craftCharacters from '../assets/worlds/craft-workshop/characters.webp'
import dogBackground from '../assets/worlds/dog-office/background.webp'
import dogCharacters from '../assets/worlds/dog-office/characters.webp'

export type WorldPackId = 'dog-office' | 'craft-workshop'

export const gardenStationLabels: Record<GardenStationId, string> = {
  archive: '資料棚',
  observatory: '望遠鏡',
  workbench: '作業台',
  waiting: '確認札',
  delivery: '納品台',
  rest: '縁側',
}

export interface WorldPack {
  readonly id: WorldPackId
  readonly name: string
  readonly shortName: string
  readonly description: string
  readonly backgroundUrl: string
  readonly stations: Readonly<
    Record<GardenStationId, { readonly x: number; readonly y: number }>
  >
  readonly character: {
    readonly name: string
    readonly role: string
    readonly atlasUrl: string
    readonly atlasColumns: number
    readonly atlasRows: number
    readonly atlasColumn: number
    readonly atlasRow: number
    readonly position: { readonly x: number; readonly y: number }
  }
}

export const worldPacks: readonly WorldPack[] = [
  {
    id: 'dog-office',
    name: '犬たちの里山アトリエ',
    shortName: '里山の庭',
    description: '竹林と縁側に囲まれた、犬たちの静かな仕事場。',
    backgroundUrl: dogBackground,
    stations: {
      archive: { x: 13, y: 22 },
      observatory: { x: 15, y: 68 },
      workbench: { x: 49, y: 38 },
      waiting: { x: 78, y: 44 },
      delivery: { x: 69, y: 27 },
      rest: { x: 53, y: 49 },
    },
    character: {
      name: 'サグル',
      role: '調査担当',
      atlasUrl: dogCharacters,
      atlasColumns: 3,
      atlasRows: 4,
      atlasColumn: 1,
      atlasRow: 0,
      position: { x: 53, y: 49 },
    },
  },
  {
    id: 'craft-workshop',
    name: '職人工房',
    shortName: '和の工房',
    description: '木工・金工・和紙・漆の机が並ぶ、灯りの工房。',
    backgroundUrl: craftBackground,
    stations: {
      archive: { x: 18, y: 28 },
      observatory: { x: 22, y: 70 },
      workbench: { x: 56, y: 53 },
      waiting: { x: 76, y: 42 },
      delivery: { x: 72, y: 24 },
      rest: { x: 56, y: 53 },
    },
    character: {
      name: 'サグル',
      role: '調査担当',
      atlasUrl: craftCharacters,
      atlasColumns: 3,
      atlasRows: 4,
      atlasColumn: 1,
      atlasRow: 0,
      position: { x: 56, y: 53 },
    },
  },
]

export function getWorldPack(id: string): WorldPack {
  return worldPacks.find((pack) => pack.id === id) ?? worldPacks[0]!
}
