import { describe, expect, it } from 'vitest'
import { AppError, isAppError, isErrorCode } from './errors.js'

describe('AppError', () => {
  it('preserves the domain error code and HTTP status', () => {
    const error = new AppError(
      'REPOSITORY_NOT_GIT',
      'Git Repositoryではありません',
      400,
    )

    expect(isAppError(error)).toBe(true)
    expect(error.code).toBe('REPOSITORY_NOT_GIT')
    expect(error.statusCode).toBe(400)
    expect(error.name).toBe('AppError')
  })

  it('rejects unknown error codes', () => {
    expect(isErrorCode('REPOSITORY_NOT_GIT')).toBe(true)
    expect(isErrorCode('PERMISSION_ESCALATION')).toBe(true)
    expect(isErrorCode('SECRET_LEAK')).toBe(false)
    expect(isAppError(new Error('nope'))).toBe(false)
  })
})
