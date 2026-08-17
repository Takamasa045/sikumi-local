import craftBackground from '../assets/worlds/craft-workshop/background.webp'
import craftCharacters from '../assets/worlds/craft-workshop/characters.webp'
import dogBackground from '../assets/worlds/dog-office/background.webp'
import dogCharacters from '../assets/worlds/dog-office/characters.webp'

export type WorldPackId = 'dog-office' | 'craft-workshop'

export interface WorldPack {
  readonly id: WorldPackId
  readonly name: string
  readonly shortName: string
  readonly description: string
  readonly backgroundUrl: string
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
