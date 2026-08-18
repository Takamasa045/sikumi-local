import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCommandOnPath } from './command-path.js'
import { filterProcessEnvironment } from './environment.js'
import { resolveFakeCliPath } from './fixtures.js'
import {
  assertNoPathTraversal,
  assertSafeArgs,
  assertSafeCwd,
  assertSafeExecutable,
} from './path-guard.js'
import { spawnManagedProcess } from './spawn.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('encoded path traversal', () => {
  it('rejects %252e%252e, encoded NUL, and backslash parent segments', () => {
    expect(() => assertNoPathTraversal(`/tmp/${'%252e%252e'}/secret`)).toThrow(
      AppError,
    )
    expect(() => assertNoPathTraversal(`/tmp/${'%2e%2e'}/secret`)).toThrow(
      AppError,
    )
    expect(() => assertNoPathTraversal(`/tmp/repo${'%00'}hidden`)).toThrow(
      AppError,
    )
    expect(() => assertNoPathTraversal('/tmp/safe\\..\\secret')).toThrow(
      AppError,
    )
    expect(() => assertSafeCwd(`/tmp/${'%252e%252e'}`, [trackTemp()])).toThrow(
      AppError,
    )
  })
})

describe('command argv boundary', () => {
  it('echoes metacharacters and a leading dash without invoking a shell', async () => {
    const cwd = trackTemp()
    const fakeCli = resolveFakeCliPath()
    const values = ['a;b', '$(id)', '`uname`', 'one\ntwo', '-n']
    for (const value of values) {
      const child = spawnManagedProcess({
        executable: process.execPath,
        args: [fakeCli, '--scenario', 'echo-arg', '--value', value],
        cwd,
        allowedCwdRoots: [cwd],
      })
      const eventsPromise = collectJsonl(child.jsonl)
      const [events] = await Promise.all([eventsPromise, child.wait()])
      expect(events).toEqual([{ type: 'arg.echo', value }])
    }
    expect(assertSafeArgs(values)).toEqual(values)
  })

  it('rejects arbitrary shells and a leading-dash executable name', () => {
    if (process.platform !== 'win32') {
      expect(() => assertSafeExecutable('/bin/sh')).toThrow(AppError)
      expect(resolveCommandOnPath('sh')).toBeUndefined()
    }
    const root = trackTemp()
    const dashed = join(root, '-c')
    writeFileSync(dashed, '#!/bin/sh\n')
    chmodSync(dashed, 0o755)
    expect(() => assertSafeExecutable(dashed)).toThrow(AppError)
  })
})

describe('environment allowlist', () => {
  it('drops parent secrets and rejects extras such as LD_PRELOAD', () => {
    const filtered = filterProcessEnvironment({
      PATH: '/usr/bin',
      NODE_OPTIONS: '--require ./evil.js',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
    })
    expect(filtered.NODE_OPTIONS).toBeUndefined()
    expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(() =>
      filterProcessEnvironment({ PATH: '/bin' }, { LD_PRELOAD: '/tmp/x.so' }),
    ).toThrow(AppError)
  })
})

async function collectJsonl(
  events: AsyncIterable<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const collected: Record<string, unknown>[] = []
  for await (const event of events) {
    collected.push(event)
  }
  return collected
}

function trackTemp(): string {
  const directory = join(
    tmpdir(),
    `sikumi-hardening-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(directory, { recursive: true })
  tempDirectories.push(directory)
  return directory
}
