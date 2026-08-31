import { describe, expect, it } from 'vitest'
import {
  describeStationOccupants,
  findWorldPack,
  gardenStationLabels,
  gardenStationMeanings,
  getWorldPack,
  mergeGardenWorldPacks,
  resolveWorldPackId,
  worldPackFromInstalled,
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

  it('turns an installed garden world into a selectable look', () => {
    const installed = worldPackFromInstalled({
      id: 'night-garden',
      name: '夜の庭',
      lookName: '夜',
      description: 'Zipで足した庭',
      backgroundUrl: '/api/worlds/night-garden/assets/background.png',
      atlasUrl: '/api/worlds/night-garden/assets/characters.png',
      atlasColumns: 3,
      atlasRows: 4,
    })
    expect(installed.backgroundUrl).toBe(
      '/api/worlds/night-garden/assets/background.png',
    )
    expect(installed.character.atlasUrl).toBe(
      '/api/worlds/night-garden/assets/characters.png',
    )
    const merged = mergeGardenWorldPacks([
      {
        id: 'night-garden',
        name: '夜の庭',
        lookName: '夜',
        description: '',
        backgroundUrl: installed.backgroundUrl,
        atlasUrl: installed.character.atlasUrl,
        atlasColumns: 3,
        atlasRows: 4,
      },
      {
        id: 'dog-office',
        name: '偽の里山',
        lookName: '偽',
        description: '',
        backgroundUrl: '/api/worlds/dog-office/assets/background.png',
        atlasUrl: '/api/worlds/dog-office/assets/characters.png',
        atlasColumns: 3,
        atlasRows: 4,
      },
    ])
    expect(merged.map((pack) => pack.id)).toEqual([
      'dog-office',
      'craft-workshop',
      'night-garden',
    ])
    expect(findWorldPack('night-garden', merged).lookName).toBe('夜')
    expect(getWorldPack('dog-office').backgroundUrl).not.toContain(
      '/api/worlds/',
    )
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
