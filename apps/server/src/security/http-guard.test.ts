import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import {
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  assertAllowedHost,
  assertAllowedOrigin,
  assertCsrfToken,
  assertSseAllowed,
  createSessionCookie,
  createSessionToken,
  defaultAllowedHosts,
  defaultAllowedOrigins,
  isWriteMethod,
  resolveSecurityConfig,
} from './http-guard.js'

describe('http guard primitives', () => {
  it('accepts only the local host allowlist', () => {
    const { allowedHosts } = resolveSecurityConfig()
    expect(() =>
      assertAllowedHost('127.0.0.1:4321', allowedHosts),
    ).not.toThrow()
    expect(() => assertAllowedHost('evil.example', allowedHosts)).toThrow(
      AppError,
    )
    expect(() => assertAllowedHost('127.0.0.1%3A4321', allowedHosts)).toThrow(
      AppError,
    )
    expect(() =>
      assertAllowedHost('127.0.0.1.attacker.test', allowedHosts),
    ).toThrow(AppError)
    try {
      assertAllowedHost('localhost:4321', allowedHosts)
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN_HOST')
    }
  })

  it('accepts only the local origin allowlist', () => {
    const { allowedOrigins } = resolveSecurityConfig()
    expect(() =>
      assertAllowedOrigin('http://127.0.0.1:5184', allowedOrigins),
    ).not.toThrow()
    try {
      assertAllowedOrigin('http://evil.example', allowedOrigins)
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN_ORIGIN')
    }
    try {
      assertAllowedOrigin(undefined, allowedOrigins)
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN_ORIGIN')
    }
  })

  it('requires matching HttpOnly session cookie and CSRF header', () => {
    const token = createSessionToken()
    expect(() =>
      assertCsrfToken(`${SESSION_COOKIE_NAME}=${token}`, token, token),
    ).not.toThrow()

    try {
      assertCsrfToken(undefined, token, token)
    } catch (error) {
      expect((error as AppError).code).toBe('CSRF_REJECTED')
    }
    try {
      assertCsrfToken(`${SESSION_COOKIE_NAME}=${token}`, undefined, token)
    } catch (error) {
      expect((error as AppError).code).toBe('CSRF_REJECTED')
    }
    try {
      assertCsrfToken(`${SESSION_COOKIE_NAME}=wrong`, token, token)
    } catch (error) {
      expect((error as AppError).code).toBe('CSRF_REJECTED')
    }

    expect(() =>
      assertCsrfToken(
        `other=1; ${SESSION_COOKIE_NAME}=${token}`,
        [token],
        token,
      ),
    ).not.toThrow()
  })

  it('includes the configured local ports in the default allowlists', () => {
    expect(defaultAllowedHosts({ SIKUMI_LOCAL_PORT: '4398' })).toContain(
      '127.0.0.1:4398',
    )
    expect(defaultAllowedOrigins({ SIKUMI_WEB_PORT: '5184' })).toContain(
      'http://127.0.0.1:5184',
    )
  })

  it('emits a strict session cookie and classifies write methods', () => {
    const cookie = createSessionCookie('abc')
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=abc`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(isWriteMethod('POST')).toBe(true)
    expect(isWriteMethod('GET')).toBe(false)
    expect(CSRF_HEADER_NAME).toBe('x-csrf-token')
  })

  it('requires a session cookie for SSE and rejects a foreign Origin', () => {
    const token = createSessionToken()
    const config = resolveSecurityConfig({ sessionToken: token })
    expect(() =>
      assertSseAllowed(
        {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            origin: 'http://127.0.0.1:5184',
          },
        } as never,
        config,
      ),
    ).not.toThrow()
    expect(() => assertSseAllowed({ headers: {} } as never, config)).toThrow(
      AppError,
    )
    expect(() =>
      assertSseAllowed(
        {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            origin: 'http://evil.example',
          },
        } as never,
        config,
      ),
    ).toThrow(AppError)
  })

  it('rejects percent-encoded, injected, and lookalike Host headers', () => {
    const { allowedHosts } = resolveSecurityConfig()
    const rejected = [
      '127.0.0.1%3A4321',
      '127.0.0.1%0d%0aX-Injected: 1',
      '127.0.0.1%00.evil.example',
      '127.0.0.1:4321@evil.example',
      '[::1]:4321',
      'localhost:4321',
      '127.0.0.1.evil.example',
    ]
    for (const host of rejected) {
      expect(() => assertAllowedHost(host, allowedHosts)).toThrow(AppError)
    }
    expect(() => assertAllowedHost(undefined, allowedHosts)).toThrow(AppError)
  })

  it('rejects Origin values with credentials, paths, or encoding', () => {
    const { allowedOrigins } = resolveSecurityConfig()
    const rejected = [
      'http://evil@127.0.0.1:5184',
      'http://127.0.0.1:5184/admin',
      'http://127.0.0.1:5184%2fadmin',
      'http://127.0.0.1.evil.example',
      'null',
    ]
    for (const origin of rejected) {
      expect(() => assertAllowedOrigin(origin, allowedOrigins)).toThrow(
        AppError,
      )
    }
  })

  it('rejects a CSRF header that only prefixes the session token', () => {
    const token = createSessionToken()
    expect(() =>
      assertCsrfToken(
        `${SESSION_COOKIE_NAME}=${token}`,
        token.slice(0, 8),
        token,
      ),
    ).toThrow(AppError)
  })
})
