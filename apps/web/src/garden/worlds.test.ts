import { describe, expect, it } from 'vitest'
import { getWorldPack, worldPacks } from './worlds'

describe('world packs', () => {
  it('starts with the two approved packs from sikumi', () => {
    expect(worldPacks.map((pack) => pack.id)).toEqual([
      'dog-office',
      'craft-workshop',
    ])
  })

  it('describes the dog atlas used by Saguru', () => {
    expect(getWorldPack('dog-office').character).toMatchObject({
      name: 'サグル',
      atlasColumns: 3,
      atlasRows: 4,
      atlasColumn: 1,
      atlasRow: 0,
    })
  })

  it('falls back to the dog atelier for an unknown pack', () => {
    expect(getWorldPack('missing').id).toBe('dog-office')
  })
})
