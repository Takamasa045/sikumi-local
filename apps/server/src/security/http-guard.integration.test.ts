import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import {
  injectAuthed,
  injectPublic,
  obtainSession,
  TEST_HOST,
  TEST_ORIGIN,
} from '../test/http.js'
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from './http-guard.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('local server security contract', () => {
  it('issues a per-boot session token with an HttpOnly Strict cookie', async () => {
    const app = createApp()
    const session = await obtainSession(app)

    expect(session.token.length).toBeGreaterThan(16)
    expect(session.setCookie).toContain(
      `${SESSION_COOKIE_NAME}=${session.token}`,
    )
    expect(session.setCookie).toMatch(/HttpOnly/i)
    expect(session.setCookie).toMatch(/SameSite=Strict/i)
    expect(session.setCookie).toMatch(/Path=\//i)
  })

  it('rejects an invalid Host on every request', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: 'evil.example' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN_HOST')
  })

  it('rejects a cross-origin write even with a valid session', async () => {
    const app = createApp()
    const session = await obtainSession(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: {
        ...session.headers,
        origin: 'http://evil.example',
      },
      payload: { path: '/tmp/repo' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('rejects a write with a missing session token', async () => {
    const app = createApp()
    const response = await injectPublic(app, {
      method: 'POST',
      url: '/api/workspaces',
      headers: { origin: TEST_ORIGIN },
      payload: { path: '/tmp/repo' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CSRF_REJECTED')
    expect(TEST_HOST).toBe('127.0.0.1:4321')
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token')
  })

  it('rejects an oversized write body', async () => {
    const app = createApp({ bodyLimitBytes: 64 })
    const response = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: 'x'.repeat(200) },
    })

    expect(response.statusCode).toBe(413)
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('rejects a percent-encoded Host that would collapse to the allowlist', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1%3A4321' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN_HOST')
  })

  it('rejects a write whose Origin includes a path or credentials', async () => {
    const app = createApp()
    const session = await obtainSession(app)
    const encoded = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: {
        ...session.headers,
        origin: 'http://127.0.0.1:5184/admin',
      },
      payload: { path: '/tmp/repo' },
    })
    const credentialed = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: {
        ...session.headers,
        origin: 'http://evil@127.0.0.1:5184',
      },
      payload: { path: '/tmp/repo' },
    })

    expect(encoded.statusCode).toBe(403)
    expect(encoded.json().error.code).toBe('FORBIDDEN_ORIGIN')
    expect(credentialed.statusCode).toBe(403)
    expect(credentialed.json().error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('rejects a write that has a session cookie but no CSRF header', async () => {
    const app = createApp()
    const session = await obtainSession(app)
    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: {
        host: TEST_HOST,
        origin: TEST_ORIGIN,
        cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
      },
      payload: { path: '/tmp/repo' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CSRF_REJECTED')
  })

  it('rejects writes that exceed the rate limit', async () => {
    const app = createApp({ writeRateLimit: { max: 2, windowMs: 60_000 } })

    const first = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: '/tmp/one' },
    })
    const second = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: '/tmp/two' },
    })
    const third = await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: '/tmp/three' },
    })

    expect(first.statusCode).not.toBe(429)
    expect(second.statusCode).not.toBe(429)
    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMITED')
  })
})

function createApp(security?: Parameters<typeof buildApp>[0]['security']) {
  const directory = createTemporaryDirectory()
  tempDirectories.push(directory)
  const app = buildApp({
    dataDirectory: directory,
    ...(security ? { security } : {}),
  })
  apps.push(app)
  return app
}
