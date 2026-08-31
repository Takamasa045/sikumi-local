import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { createSolidPng } from '../test/tiny-png.js'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  assertSafeWorldPackImages,
  listInstalledGardenWorlds,
  readWorldPackAsset,
  resolveWorldPackLook,
} from './world-pack.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('world pack look', () => {
  it('resolves the example garden pack checked into the repo', () => {
    const example = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../examples/packs/example-garden',
    )
    expect(resolveWorldPackLook(example)).toMatchObject({
      id: 'example-garden',
      lookName: '見本',
      backgroundFile: 'background.png',
      atlasFile: 'characters.png',
      atlasColumns: 3,
      atlasRows: 4,
    })
  })

  it('resolves background and character atlas from world.yaml', () => {
    const root = writeWorldPack()
    const look = resolveWorldPackLook(root)
    expect(look).toMatchObject({
      id: 'night-garden',
      name: '夜の庭',
      lookName: '夜',
      backgroundFile: 'background.png',
      atlasFile: 'characters.png',
      atlasColumns: 3,
      atlasRows: 4,
    })
    assertSafeWorldPackImages(root)
  })

  it('falls back to conventional image names when yaml omits them', () => {
    const root = track(createTemporaryDirectory())
    writeFileSync(
      join(root, 'world.yaml'),
      'id: meadow\nversion: 1.0.0\nname: 草地\n',
    )
    writeFileSync(
      join(root, 'background.webp'),
      createSolidPng(4, 3, [10, 20, 30]),
    )
    writeFileSync(
      join(root, 'characters.webp'),
      createSolidPng(6, 8, [40, 50, 60]),
    )
    expect(resolveWorldPackLook(root)).toMatchObject({
      id: 'meadow',
      lookName: '草地',
      backgroundFile: 'background.webp',
      atlasFile: 'characters.webp',
    })
  })

  it('rejects unsafe or missing declared images', () => {
    const root = track(createTemporaryDirectory())
    writeFileSync(
      join(root, 'world.yaml'),
      'id: bad\nversion: 1.0.0\nbackground: ../escape.png\n',
    )
    expect(() => assertSafeWorldPackImages(root)).toThrow(/正しくありません/)

    const missing = track(createTemporaryDirectory())
    writeFileSync(
      join(missing, 'world.yaml'),
      'id: missing-art\nversion: 1.0.0\nbackground: background.png\n',
    )
    expect(() => assertSafeWorldPackImages(missing)).toThrow(/見つかりません/)
  })

  it('lists installed world looks and serves only their declared images', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const opened = openDatabase(dataDirectory)
    databases.push(opened)
    const store = createStore(opened.db)
    const packRoot = join(dataDirectory, 'worlds', 'night-garden')
    mkdirSync(join(dataDirectory, 'worlds'), { recursive: true, mode: 0o700 })
    copyDir(writeWorldPack(), packRoot)
    store.insertPack({
      id: 'pack_night',
      kind: 'world',
      packId: 'night-garden',
      version: '1.0.0',
      sourcePath: null,
      sourceKind: 'zip',
      sourceDisplay: 'night-garden.zip',
      commitHash: null,
      builtin: false,
      installedAt: 't',
    })
    store.insertPack({
      id: 'pack_builtin',
      kind: 'world',
      packId: 'dog-office',
      version: '1.0.0',
      sourcePath: null,
      sourceKind: 'builtin',
      sourceDisplay: 'builtin',
      commitHash: null,
      builtin: true,
      installedAt: 't',
    })

    const worlds = listInstalledGardenWorlds(store, dataDirectory)
    expect(worlds).toHaveLength(1)
    expect(worlds[0]).toMatchObject({
      id: 'night-garden',
      lookName: '夜',
      backgroundUrl: '/api/worlds/night-garden/assets/background.png',
      atlasUrl: '/api/worlds/night-garden/assets/characters.png',
    })

    const background = readWorldPackAsset({
      store,
      dataDirectory,
      packId: 'night-garden',
      file: 'background.png',
    })
    expect(background.contentType).toBe('image/png')
    expect(background.body.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )

    expect(() =>
      readWorldPackAsset({
        store,
        dataDirectory,
        packId: 'night-garden',
        file: 'world.yaml',
      }),
    ).toThrow(AppError)
    expect(() =>
      readWorldPackAsset({
        store,
        dataDirectory,
        packId: 'dog-office',
        file: 'background.png',
      }),
    ).toThrow(/見つかりません/)
    expect(() =>
      readWorldPackAsset({
        store,
        dataDirectory,
        packId: 'night-garden',
        file: '../background.png',
      }),
    ).toThrow(/正しくありません|見つかりません/)
  })
})

function writeWorldPack(): string {
  const root = track(createTemporaryDirectory())
  writeFileSync(
    join(root, 'world.yaml'),
    [
      'schemaVersion: 1',
      'id: night-garden',
      'name: 夜の庭',
      'lookName: 夜',
      'version: 1.0.0',
      'kind: world',
      'description: 夜の庭の見本',
      'background: background.png',
      'characterAtlas: characters.png',
      'atlasColumns: 3',
      'atlasRows: 4',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'background.png'),
    createSolidPng(8, 5, [20, 40, 80]),
  )
  writeFileSync(
    join(root, 'characters.png'),
    createSolidPng(12, 16, [200, 160, 80]),
  )
  return root
}

function copyDir(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  for (const name of ['world.yaml', 'background.png', 'characters.png']) {
    writeFileSync(join(destination, name), readFileSync(join(source, name)))
  }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
