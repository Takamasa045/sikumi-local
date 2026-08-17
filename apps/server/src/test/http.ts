import type { buildApp } from '../app.js'
import {
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
} from '../security/http-guard.js'

export const TEST_HOST = '127.0.0.1:4321'
export const TEST_ORIGIN = 'http://127.0.0.1:5184'

type App = ReturnType<typeof buildApp>

interface InjectRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly url: string
  readonly payload?: string | object | Buffer
  readonly headers?: Record<string, string>
}

export function injectPublic(app: App, options: InjectRequest) {
  return app.inject({
    method: options.method,
    url: options.url,
    headers: {
      host: TEST_HOST,
      ...options.headers,
    },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  })
}

export async function obtainSession(app: App) {
  const response = await injectPublic(app, {
    method: 'GET',
    url: '/api/session',
  })
  const token = (response.json() as { token: string }).token
  const setCookie = String(response.headers['set-cookie'] ?? '')
  return {
    token,
    setCookie,
    headers: {
      host: TEST_HOST,
      origin: TEST_ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: token,
    },
  }
}

export async function injectAuthed(app: App, options: InjectRequest) {
  const session = await obtainSession(app)
  return app.inject({
    method: options.method,
    url: options.url,
    headers: {
      ...session.headers,
      ...options.headers,
    },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  })
}
