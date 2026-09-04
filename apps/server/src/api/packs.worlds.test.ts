import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { createSolidPng } from '../test/tiny-png.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { injectAuthed, injectPublic } from '../test/http.js'
import { buildZip } from '../packs/zip-fixture.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('garden world pack assets', () => {
  it('installs a zip world pack and serves its images to the garden', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = createApp(dataDirectory)
    const zipPath = join(track(createTemporaryDirectory()), 'night-garden.zip')
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'world.yaml',
          content: [
            'id: night-garden',
            'version: 1.0.0',
            'kind: world',
            'name: 夜の庭',
            'lookName: 夜',
            'background: background.png',
            'characterAtlas: characters.png',
            '',
          ].join('\n'),
        },
        {
          name: 'background.png',
          content: '',
          payload: createSolidPng(8, 5, [16, 48, 96]),
        },
        {
          name: 'characters.png',
          content: '',
          payload: createSolidPng(12, 16, [210, 170, 70]),
        },
      ]),
    )

    const preview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/packs/preview',
      payload: { sourceType: 'zip', path: zipPath },
    })
    expect(preview.statusCode).toBe(201)
    expect(preview.json().preview.packId).toBe('night-garden')

    const installed = await injectAuthed(app, {
      method: 'POST',
      url: '/api/packs/install',
      payload: { previewId: preview.json().preview.id, confirm: true },
    })
    expect(installed.statusCode).toBe(201)

    const worlds = await injectPublic(app, {
      method: 'GET',
      url: '/api/worlds',
    })
    expect(worlds.statusCode).toBe(200)
    expect(worlds.json().worlds).toEqual([
      {
        id: 'night-garden',
        name: '夜の庭',
        lookName: '夜',
        description: '',
        backgroundUrl: '/api/worlds/night-garden/assets/background.png?v=1.0.0',
        atlasUrl: '/api/worlds/night-garden/assets/characters.png?v=1.0.0',
        atlasColumns: 3,
        atlasRows: 4,
      },
    ])

    const image = await injectPublic(app, {
      method: 'GET',
      url: '/api/worlds/night-garden/assets/background.png?v=1.0.0',
    })
    expect(image.statusCode).toBe(200)
    expect(image.headers['content-type']).toMatch(/image\/png/)
    expect(image.headers['cache-control']).toBe(
      'private, max-age=31536000, immutable',
    )
    expect(Buffer.from(image.rawPayload).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )

    const unversionedImage = await injectPublic(app, {
      method: 'GET',
      url: '/api/worlds/night-garden/assets/background.png',
    })
    expect(unversionedImage.statusCode).toBe(200)
    expect(unversionedImage.headers['cache-control']).toBe('private, no-cache')

    const builtin = await injectPublic(app, {
      method: 'GET',
      url: '/api/worlds/dog-office/assets/background.png',
    })
    expect(builtin.statusCode).toBe(404)

    const escaped = await injectPublic(app, {
      method: 'GET',
      url: '/api/worlds/night-garden/assets/..%2Fworld.yaml',
    })
    expect(escaped.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('still rejects an executable zip at preview', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = createApp(dataDirectory)
    const zipPath = join(track(createTemporaryDirectory()), 'trap.zip')
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'world.yaml',
          content: 'id: trap\nversion: 1.0.0\nkind: world\nname: 罠\n',
        },
        { name: 'run.sh', content: '#!/bin/sh\n' },
      ]),
    )
    const preview = await injectAuthed(app, {
      method: 'POST',
      url: '/api/packs/preview',
      payload: { sourceType: 'zip', path: zipPath },
    })
    expect(preview.statusCode).toBe(400)
    expect(JSON.stringify(preview.json())).toMatch(/data-only/)
  })
})

function createApp(dataDirectory: string) {
  mkdirSync(dataDirectory, { recursive: true })
  const app = buildApp({ dataDirectory })
  apps.push(app)
  return app
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
