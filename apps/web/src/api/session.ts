import {
  AppError,
  apiErrorSchema,
  isErrorCode,
  sessionResponseSchema,
} from '@sikumi-local/core'

export const CSRF_HEADER_NAME = 'X-CSRF-Token'

let cachedToken: string | null = null

export function resetSessionToken(): void {
  cachedToken = null
}

export async function getSessionToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken
  }

  const response = await fetch('/api/session', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }

  cachedToken = sessionResponseSchema.parse(body).token
  return cachedToken
}

export function authorizedHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    [CSRF_HEADER_NAME]: token,
  }
}

export async function writeWithCsrfRetry(
  perform: (token: string) => Promise<Response>,
): Promise<Response> {
  const firstResponse = await perform(await getSessionToken())
  if (!(await responseIsCsrfRejected(firstResponse))) {
    return firstResponse
  }

  resetSessionToken()
  return perform(await getSessionToken())
}

async function responseIsCsrfRejected(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false
  }

  try {
    const body: unknown = await response.clone().json()
    const parsed = apiErrorSchema.safeParse(body)
    return parsed.success && parsed.data.error.code === 'CSRF_REJECTED'
  } catch {
    return false
  }
}

export function toApiError(body: unknown, status: number): AppError {
  const parsed = apiErrorSchema.safeParse(body)
  if (!parsed.success) {
    return new AppError('VALIDATION_FAILED', '登録に失敗しました', status)
  }
  const code = isErrorCode(parsed.data.error.code)
    ? parsed.data.error.code
    : 'VALIDATION_FAILED'
  return parsed.data.details
    ? new AppError(code, parsed.data.error.message, status, parsed.data.details)
    : new AppError(code, parsed.data.error.message, status)
}
