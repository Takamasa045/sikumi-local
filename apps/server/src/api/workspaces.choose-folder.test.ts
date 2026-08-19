import { afterEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerWorkspaceRoutes } from './workspaces.js'
import type { AppStore } from '../storage/store.js'

const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('POST /api/workspaces/choose-folder', () => {
  it('returns the chosen absolute path', async () => {
    const app = createRouteApp(async () => ({
      cancelled: false,
      path: '/Users/example/blog',
    }))

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces/choose-folder',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      cancelled: false,
      path: '/Users/example/blog',
    })
  })

  it('returns cancelled when the user closes the dialog', async () => {
    const app = createRouteApp(async () => ({ cancelled: true }))

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces/choose-folder',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ cancelled: true })
  })
})

function createRouteApp(chooseFolder: () => Promise<{ cancelled: boolean; path?: string }>) {
  const app = Fastify()
  apps.push(app)
  registerWorkspaceRoutes(app, {} as AppStore, {
    chooseFolder: chooseFolder as never,
  })
  return app
}
