import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  environmentContainsSecretValue,
  filterProcessEnvironment,
} from './environment.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

describe('filterProcessEnvironment', () => {
  it('copies only allowlisted keys and never inherits API keys from the parent', () => {
    const filtered = filterProcessEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/example',
      LANG: 'ja_JP.UTF-8',
      OPENAI_API_KEY: 'sk-parent-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-parent-secret',
      GITHUB_TOKEN: 'ghp-parent-secret',
      NODE_OPTIONS: '--require ./evil.js',
    })

    expect(filtered).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/example',
      LANG: 'ja_JP.UTF-8',
    })
    expect(filtered.OPENAI_API_KEY).toBeUndefined()
    expect(environmentContainsSecretValue(filtered, 'aws-parent-secret')).toBe(
      false,
    )
  })

  it('passes an explicit provider API key only when requested', () => {
    const filtered = filterProcessEnvironment(
      { PATH: '/usr/bin', OPENAI_API_KEY: 'sk-parent-secret' },
      { OPENAI_API_KEY: 'sk-explicit' },
    )

    expect(filtered.OPENAI_API_KEY).toBe('sk-explicit')
    expect(environmentContainsSecretValue(filtered, 'sk-parent-secret')).toBe(
      false,
    )
  })

  it('rejects extras that are not on the allowlist', () => {
    expect(() =>
      filterProcessEnvironment({ PATH: '/usr/bin' }, { AWS_SECRET: 'nope' }),
    ).toThrow(AppError)
  })

  it('ignores empty secret lookups', () => {
    expect(environmentContainsSecretValue({ PATH: '/bin' }, '')).toBe(false)
  })

  it('does not inherit process-injection environment from the parent', () => {
    const filtered = filterProcessEnvironment({
      PATH: '/usr/bin',
      NODE_OPTIONS: '--require ./evil.js',
      BASH_ENV: '/tmp/evil.sh',
      ENV: '/tmp/evil.sh',
      SHELLOPTS: 'xtrace',
      PS4: '$(id)',
      LD_PRELOAD: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      GITHUB_TOKEN: 'ghp-parent',
    })

    expect(filtered).toEqual({ PATH: '/usr/bin' })
    expect(filtered.NODE_OPTIONS).toBeUndefined()
    expect(filtered.BASH_ENV).toBeUndefined()
    expect(filtered.LD_PRELOAD).toBeUndefined()
    expect(() =>
      filterProcessEnvironment({ PATH: '/usr/bin' }, { NODE_OPTIONS: '--x' }),
    ).toThrow(AppError)
  })
})
