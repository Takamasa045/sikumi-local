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
  'PERMISSION_ESCALATION',
  'UNREGISTERED_CWD',
  'PROCESS_SPAWN_REJECTED',
  'PROCESS_TIMEOUT',
  'APPROVAL_NOT_PENDING',
  'FORBIDDEN_HOST',
  'FORBIDDEN_ORIGIN',
  'CSRF_REJECTED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'WORKTREE_CREATE_FAILED',
  'WORKTREE_CONFLICT',
  'WORKTREE_DIRTY_REPO',
  'WORKTREE_CANCELLED',
  'WORKTREE_APPLY_FAILED',
  'WORKTREE_TARGET_DIRTY',
  'WORKTREE_NOT_FOUND',
  'WORKTREE_DISCARD_FAILED',
  'WORKTREE_UNSAFE_DIFF',
  'PACK_INVALID',
  'PACK_UNTRUSTED',
  'PACK_DOWNGRADE',
  'PACK_DUPLICATE',
  'PACK_BUILTIN_PROTECTED',
  'PACK_CREDENTIALS_FORBIDDEN',
  'DATA_DIRECTORY_UNSAFE',
  'RESET_REFUSED',
  'PORTABLE_INVALID',
  'BACKUP_FAILED',
  'IMPORT_CONFLICT',
  'OUTPUT_TOO_LARGE',
  'OBSERVER_EVENT_INVALID',
  'OBSERVER_ADAPTER_UNAVAILABLE',
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
