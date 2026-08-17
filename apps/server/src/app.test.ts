import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app'

describe('local server', () => {
  const apps: Array<ReturnType<typeof buildApp>> = []

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
  })

  it('reports a local-only health contract', async () => {
    const app = buildApp()
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      product: 'Shikumi Local',
      phase: 'repository-foundation',
      bind: '127.0.0.1',
    })
  })

  it('does not expose a generic root API response', async () => {
    const app = buildApp()
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(404)
  })
})
