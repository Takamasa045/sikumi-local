import { timingSafeEqual, randomBytes } from 'node:crypto'
import { AppError } from '@sikumi-local/core'
import type { FastifyRequest } from 'fastify'

export const SESSION_COOKIE_NAME = 'sikumi_session'
export const CSRF_HEADER_NAME = 'x-csrf-token'

export function defaultAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const serverPort = env.SIKUMI_LOCAL_PORT ?? '4321'
  const webPort = env.SIKUMI_WEB_PORT ?? '5184'
  return [
    '127.0.0.1',
    '127.0.0.1:4321',
    '127.0.0.1:5184',
    `127.0.0.1:${serverPort}`,
    `127.0.0.1:${webPort}`,
  ]
}

export function defaultAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const serverPort = env.SIKUMI_LOCAL_PORT ?? '4321'
  const webPort = env.SIKUMI_WEB_PORT ?? '5184'
  return [
    'http://127.0.0.1:5184',
    'http://127.0.0.1:4321',
    `http://127.0.0.1:${webPort}`,
    `http://127.0.0.1:${serverPort}`,
  ]
}

export const DEFAULT_ALLOWED_HOSTS = defaultAllowedHosts()
export const DEFAULT_ALLOWED_ORIGINS = defaultAllowedOrigins()

export const DEFAULT_BODY_LIMIT_BYTES = 16 * 1024
export const DEFAULT_WRITE_RATE_LIMIT = { max: 60, windowMs: 60_000 } as const

export interface WriteRateLimit {
  readonly max: number
  readonly windowMs: number
}

export interface SecurityConfig {
  readonly sessionToken: string
  readonly allowedHosts: ReadonlySet<string>
  readonly allowedOrigins: ReadonlySet<string>
  readonly writeRateLimit: WriteRateLimit
}

export interface SecurityOptions {
  readonly sessionToken?: string
  readonly allowedHosts?: readonly string[]
  readonly allowedOrigins?: readonly string[]
  readonly writeRateLimit?: WriteRateLimit
  readonly bodyLimitBytes?: number
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function resolveSecurityConfig(
  options: SecurityOptions = {},
): SecurityConfig {
  return {
    sessionToken: options.sessionToken ?? createSessionToken(),
    allowedHosts: new Set(options.allowedHosts ?? defaultAllowedHosts()),
    allowedOrigins: new Set(options.allowedOrigins ?? defaultAllowedOrigins()),
    writeRateLimit: options.writeRateLimit ?? DEFAULT_WRITE_RATE_LIMIT,
  }
}

export function createSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`
}

export function createRequestGuard(config: SecurityConfig) {
  const windows = new Map<string, { windowStart: number; count: number }>()

  return function assertRequestAllowed(request: FastifyRequest): void {
    assertAllowedHost(request.headers.host, config.allowedHosts)

    if (!isWriteMethod(request.method)) {
      return
    }

    assertAllowedOrigin(request.headers.origin, config.allowedOrigins)
    assertCsrfToken(
      request.headers.cookie,
      request.headers[CSRF_HEADER_NAME],
      config.sessionToken,
    )
    consumeWriteRateLimit(windows, request.ip, config.writeRateLimit)
  }
}

export function assertAllowedHost(
  hostHeader: string | undefined,
  allowedHosts: ReadonlySet<string>,
): void {
  const host = normalizeHost(hostHeader)
  if (!host || !allowedHosts.has(host)) {
    throw new AppError('FORBIDDEN_HOST', 'Host is not allowed', 403)
  }
}

export function assertAllowedOrigin(
  originHeader: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): void {
  if (!originHeader || !allowedOrigins.has(originHeader)) {
    throw new AppError('FORBIDDEN_ORIGIN', 'Origin is not allowed', 403)
  }
}

export function assertCsrfToken(
  cookieHeader: string | undefined,
  headerValue: string | string[] | undefined,
  sessionToken: string,
): void {
  const cookieToken = readCookie(cookieHeader, SESSION_COOKIE_NAME)
  const headerToken = firstHeader(headerValue)
  if (
    !cookieToken ||
    !headerToken ||
    !sameToken(cookieToken, sessionToken) ||
    !sameToken(headerToken, sessionToken)
  ) {
    throw new AppError(
      'CSRF_REJECTED',
      'Session token is missing or invalid',
      403,
    )
  }
}

export function isWriteMethod(method: string): boolean {
  return (
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  )
}

function consumeWriteRateLimit(
  windows: Map<string, { windowStart: number; count: number }>,
  ip: string,
  limit: WriteRateLimit,
): void {
  const now = Date.now()
  const current = windows.get(ip)
  if (!current || now - current.windowStart >= limit.windowMs) {
    windows.set(ip, { windowStart: now, count: 1 })
    return
  }

  current.count += 1
  if (current.count > limit.max) {
    throw new AppError('RATE_LIMITED', 'Too many write requests', 429)
  }
}

function normalizeHost(hostHeader: string | undefined): string | undefined {
  return hostHeader?.trim().toLowerCase().split('%')[0]
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')
    if (rawName === name) {
      return rawValue.join('=')
    }
  }

  return undefined
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function sameToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }
  return timingSafeEqual(leftBuffer, rightBuffer)
}
