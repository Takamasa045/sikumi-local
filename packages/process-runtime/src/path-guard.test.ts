import {
  chmodSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertSafeArgs,
  assertSafeCwd,
  assertSafeExecutable,
  isInsideRoot,
} from './path-guard.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('assertSafeExecutable', () => {
  it('rejects relative paths, missing files, directories, and metacharacters', () => {
    expect(() => assertSafeExecutable('')).toThrow(AppError)
    expect(() => assertSafeExecutable('node')).toThrow(AppError)
    expect(() => assertSafeExecutable('/tmp/does-not-exist-sikumi')).toThrow(
      AppError,
    )
    expect(() => assertSafeExecutable(`${process.execPath};rm`)).toThrow(
      AppError,
    )
    expect(() => assertSafeExecutable('/tmp/safe/../secret')).toThrow(AppError)
    expect(() => assertSafeExecutable(tmpdir())).toThrow(AppError)
  })

  it('accepts the current Node executable', () => {
    expect(assertSafeExecutable(process.execPath)).toBeTruthy()
  })

  it('rejects a regular file that is not executable', () => {
    const root = trackTemp()
    const file = join(root, 'not-exec.txt')
    writeFileSync(file, 'not executable\n')
    chmodSync(file, 0o644)
    expect(() => assertSafeExecutable(file)).toThrow(AppError)
  })
})

describe('assertSafeCwd', () => {
  it('rejects traversal, missing paths, files, and unregistered roots', () => {
    const root = trackTemp()
    writeFileSync(join(root, 'file.txt'), 'x')

    expect(() => assertSafeCwd('')).toThrow(AppError)
    expect(() => assertSafeCwd('relative')).toThrow(AppError)
    expect(() => assertSafeCwd(`/${'a'.repeat(5000)}`)).toThrow(AppError)
    expect(() => assertSafeCwd(`${root}\0`)).toThrow(AppError)
    expect(() => assertSafeCwd('/tmp/safe/../secret')).toThrow(AppError)
    expect(() => assertSafeCwd('/tmp/sikumi-cwd-missing')).toThrow(AppError)
    expect(() => assertSafeCwd(join(root, 'file.txt'))).toThrow(AppError)
    expect(() => assertSafeCwd(root, ['/tmp/other-registered-root'])).toThrow(
      AppError,
    )
    expect(assertSafeCwd(root, [root])).toBe(realpathSync(root))

    const metacharacterDirectory = `${root};evil`
    mkdirSync(metacharacterDirectory)
    expect(() => assertSafeCwd(metacharacterDirectory)).toThrow(AppError)
  })
})

describe('assertSafeArgs', () => {
  it('accepts literal metacharacters and rejects NUL bytes', () => {
    expect(assertSafeArgs(['hello; rm -rf /', '--value'])).toEqual([
      'hello; rm -rf /',
      '--value',
    ])
    expect(() => assertSafeArgs(['ok\0bad'])).toThrow(AppError)
    expect(() => assertSafeArgs('not-an-array' as unknown as string[])).toThrow(
      AppError,
    )
    expect(() => assertSafeArgs([1 as unknown as string])).toThrow(AppError)
  })
})

describe('isInsideRoot', () => {
  it('requires a path boundary so sibling directories do not match', () => {
    const parent = trackTemp()
    const repo = join(parent, 'repo')
    const nested = join(repo, 'src')
    const sibling = join(parent, 'repo-evil')
    mkdirSync(nested, { recursive: true })
    mkdirSync(sibling, { recursive: true })

    expect(isInsideRoot(repo, repo)).toBe(true)
    expect(isInsideRoot(nested, repo)).toBe(true)
    expect(isInsideRoot(sibling, repo)).toBe(false)
  })

  it('rejects a symlink that escapes the allowed repository', () => {
    const repo = trackTemp()
    const outside = trackTemp()
    const escape = join(repo, 'escape')
    mkdirSync(join(repo, 'inside'), { recursive: true })
    symlinkSync(outside, escape)

    expect(isInsideRoot(escape, repo)).toBe(false)
    expect(() => assertSafeCwd(escape, [repo])).toThrow(AppError)
    expect(assertSafeCwd(join(repo, 'inside'), [repo])).toBe(
      realpathSync(join(repo, 'inside')),
    )
  })

  it('treats missing paths as outside the root', () => {
    expect(isInsideRoot('/tmp/sikumi-missing-a', '/tmp/sikumi-missing-b')).toBe(
      false,
    )
  })
})

function trackTemp(): string {
  const directory = join(
    tmpdir(),
    `sikumi-path-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(directory, { recursive: true })
  const real = realpathSync(directory)
  tempDirectories.push(real)
  return real
}
