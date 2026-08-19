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
    expect(resolveRegisteredPath('~\\Projects\\demo')).toBe(
      join(homedir(), 'Projects', 'demo'),
    )
  })

  it('accepts Windows drive paths without treating them as relative', () => {
    expect(resolveRegisteredPath('C:\\Users\\example\\project')).toBe(
      'C:\\Users\\example\\project',
    )
    expect(resolveRegisteredPath('C:/Users/example/project')).toBe(
      'C:\\Users\\example\\project',
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

  it('rejects double-encoded and backslash traversal', () => {
    expect(() => resolveRegisteredPath(`/tmp/${'%252e%252e'}/passwd`)).toThrow(
      AppError,
    )
    expect(() => resolveRegisteredPath('/tmp/foo\\..\\secret')).toThrow(
      AppError,
    )
    expect(() => resolveRegisteredPath(`/tmp/repo${'%00'}x`)).toThrow(AppError)
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

  it('rejects percent-encoded, double-encoded, and unicode traversal', () => {
    const rejected = [
      '/tmp/%2e%2e/%2e%2e/etc/passwd',
      '/tmp/%2e%2e%2fetc%2fpasswd',
      '/tmp/%252e%252e/etc/passwd',
      '/tmp/foo%00/bar',
      `/tmp/${'\uFF0E'.repeat(2)}/secret`,
      '/tmp/..%2fsecret',
    ]
    for (const input of rejected) {
      try {
        resolveRegisteredPath(input)
        throw new Error(`expected PATH_TRAVERSAL for ${input}`)
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('PATH_TRAVERSAL')
      }
    }
  })
})
