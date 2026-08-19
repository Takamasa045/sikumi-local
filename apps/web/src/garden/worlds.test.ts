import { describe, expect, it } from 'vitest'
import {
  describeStationOccupants,
  gardenStationLabels,
  gardenStationMeanings,
  getWorldPack,
  resolveWorldPackId,
  worldPacks,
} from './worlds'

describe('world packs', () => {
  it('starts with the two approved packs from sikumi', () => {
    expect(worldPacks.map((pack) => pack.id)).toEqual([
      'dog-office',
      'craft-workshop',
    ])
    expect(worldPacks.map((pack) => pack.lookName)).toEqual(['里山', '工房'])
  })

  it('keeps the workshop look on the existing craft assets', () => {
    const workshop = getWorldPack('craft-workshop')
    expect(workshop.backgroundUrl).toContain('craft-workshop')
    expect(workshop.character.atlasUrl).toContain('craft-workshop')
    expect(resolveWorldPackId('craft-workshop')).toBe('craft-workshop')
    expect(resolveWorldPackId('missing')).toBe('dog-office')
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

  it('explains who is at a station or heading there', () => {
    expect(gardenStationMeanings.archive).toContain('資料')
    expect(describeStationOccupants('archive', [])).toBe(
      '資料棚に、いまは誰もいません',
    )
    expect(
      describeStationOccupants('workbench', [
        { name: 'サグル', traveling: false },
      ]),
    ).toBe('サグルが作業台にいます')
    expect(
      describeStationOccupants('waiting', [
        { name: 'サグル', traveling: true },
      ]),
    ).toBe('サグルが確認の場所へ向かっています')
  })

  it('keeps the dog-office observatory on the pictured ground', () => {
    const dogOffice = getWorldPack('dog-office')
    expect(dogOffice.stations.observatory.y).toBeGreaterThanOrEqual(75)
    expect(dogOffice.stations.observatory.y).toBeLessThanOrEqual(90)
    expect(dogOffice.stations.observatory.x).toBeLessThan(40)
    expect(gardenStationLabels.observatory).toBe('縁側')
    expect(gardenStationLabels.waiting).toBe('確認の場所')
    expect(gardenStationLabels.workbench).toBe('作業台')
  })
})
