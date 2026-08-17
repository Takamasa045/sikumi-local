import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CSRF_HEADER_NAME,
  authorizedHeaders,
  getSessionToken,
  resetSessionToken,
  writeWithCsrfRetry,
} from './session.js'

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('session API client', () => {
  it('fetches and caches the boot session token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ token: 'boot-session-token' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSessionToken()).resolves.toBe('boot-session-token')
    await expect(getSessionToken()).resolves.toBe('boot-session-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/session', {
      credentials: 'include',
    })
    expect(authorizedHeaders('boot-session-token')).toEqual({
      'Content-Type': 'application/json',
      [CSRF_HEADER_NAME]: 'boot-session-token',
    })
  })

  it('maps a failed session response to a domain error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'FORBIDDEN_HOST', message: 'Host is not allowed' } },
          403,
        ),
      ),
    )

    await expect(getSessionToken()).rejects.toMatchObject({
      code: 'FORBIDDEN_HOST',
    })
  })

  it('refreshes the session once after CSRF_REJECTED and retries the write', async () => {
    await seedCachedToken('stale-token')
    const tokens: string[] = []
    const fetchMock = vi.fn(async () => jsonResponse({ token: 'fresh-token' }))
    vi.stubGlobal('fetch', fetchMock)

    const perform = vi.fn(async (token: string) => {
      tokens.push(token)
      if (token === 'stale-token') {
        return jsonResponse(
          {
            error: {
              code: 'CSRF_REJECTED',
              message: 'Session token is missing or invalid',
            },
          },
          403,
        )
      }
      return jsonResponse({ ok: true }, 201)
    })

    const response = await writeWithCsrfRetry(perform)

    expect(response.status).toBe(201)
    expect(tokens).toEqual(['stale-token', 'fresh-token'])
    expect(perform).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/session', {
      credentials: 'include',
    })
  })

  it('stops after a single CSRF retry when the second write is also rejected', async () => {
    await seedCachedToken('stale-token')
    const fetchMock = vi.fn(async () => jsonResponse({ token: 'fresh-token' }))
    vi.stubGlobal('fetch', fetchMock)

    const perform = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'CSRF_REJECTED',
            message: 'Session token is missing or invalid',
          },
        },
        403,
      ),
    )

    const response = await writeWithCsrfRetry(perform)
    const body = (await response.json()) as {
      error: { code: string }
    }

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('CSRF_REJECTED')
    expect(perform).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a non-CSRF 403', async () => {
    await seedCachedToken('stale-token')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const perform = vi.fn(async () =>
      jsonResponse(
        {
          error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin is not allowed' },
        },
        403,
      ),
    )

    const response = await writeWithCsrfRetry(perform)

    expect(response.status).toBe(403)
    expect(perform).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

async function seedCachedToken(token: string): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ token })),
  )
  await getSessionToken()
  vi.unstubAllGlobals()
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
