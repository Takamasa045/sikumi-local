export const errorCodes = [
  'PATH_TRAVERSAL',
  'REPOSITORY_NOT_FOUND',
  'REPOSITORY_NOT_GIT',
  'REPOSITORY_PERMISSION_DENIED',
  'REPOSITORY_DUPLICATE',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'PROVIDER_EXECUTION_DISCONNECTED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_CAPABILITY_MISMATCH',
  'PROVIDER_SWITCH_FORBIDDEN',
  'EMPLOYEE_PACK_INVALID',
  'EMPLOYEE_INCOMPATIBLE',
  'UNSUPPORTED_JOB_TYPE',
  'UNREGISTERED_CWD',
  'PROCESS_SPAWN_REJECTED',
  'PROCESS_TIMEOUT',
  'APPROVAL_NOT_PENDING',
  'FORBIDDEN_HOST',
  'FORBIDDEN_ORIGIN',
  'CSRF_REJECTED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
] as const

export type ErrorCode = (typeof errorCodes)[number]

export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details?: Record<string, unknown>

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    if (details !== undefined) {
      this.details = details
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function isErrorCode(value: string): value is ErrorCode {
  return (errorCodes as readonly string[]).includes(value)
}
