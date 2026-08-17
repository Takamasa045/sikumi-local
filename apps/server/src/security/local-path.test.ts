import { homedir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import { resolveRegisteredPath } from './local-path.js'

describe('resolveRegisteredPath', () => {
  it('accepts an absolute path', () => {
    expect(resolveRegisteredPath(' /Users/example/project ')).toBe(
      '/Users/example/project',
    )
  })

  it('expands a home-relative path', () => {
    expect(resolveRegisteredPath('~/Projects/demo')).toBe(
      join(homedir(), 'Projects/demo'),
    )
  })

  it('rejects path traversal segments', () => {
    expect(() => resolveRegisteredPath('/Users/example/../secret')).toThrow(
      AppError,
    )
    expect(() => resolveRegisteredPath('../etc/passwd')).toThrow(AppError)
    try {
      resolveRegisteredPath('/tmp/foo/../../etc/passwd')
      throw new Error('expected PATH_TRAVERSAL')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('PATH_TRAVERSAL')
    }
  })

  it('rejects a null byte', () => {
    try {
      resolveRegisteredPath('/tmp/repo\0hidden')
      throw new Error('expected PATH_TRAVERSAL')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('PATH_TRAVERSAL')
    }
  })

  it('rejects a relative path', () => {
    try {
      resolveRegisteredPath('relative/repo')
      throw new Error('expected REPOSITORY_NOT_FOUND')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('REPOSITORY_NOT_FOUND')
    }
  })

  it('rejects an empty path', () => {
    expect(() => resolveRegisteredPath('   ')).toThrow(AppError)
  })
})
