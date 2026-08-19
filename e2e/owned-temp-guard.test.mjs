import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  isSafeOwnedTempDirectory,
  OWNED_E2E_TEMP_PREFIXES,
} from './owned-temp-guard.mjs'

describe('owned e2e temp teardown guard', () => {
  it('accepts only tmpdir paths with owned Sikumi prefixes', () => {
    const owned = mkdtempSync(join(tmpdir(), 'sikumi-e2e-guard-'))
    const data = mkdtempSync(join(tmpdir(), 'sikumi-local-e2e-guard-'))
    try {
      assert.equal(isSafeOwnedTempDirectory(owned), true)
      assert.equal(isSafeOwnedTempDirectory(data), true)
      assert.ok(OWNED_E2E_TEMP_PREFIXES.includes('sikumi-e2e-'))
    } finally {
      rmSync(owned, { recursive: true, force: true })
      rmSync(data, { recursive: true, force: true })
    }
  })

  it('rejects corrupted or out-of-tmp tracking entries', () => {
    const foreign = mkdtempSync(join(tmpdir(), 'not-sikumi-'))
    try {
      assert.equal(isSafeOwnedTempDirectory('/etc/passwd'), false)
      assert.equal(isSafeOwnedTempDirectory(resolve(tmpdir(), '..', 'etc')), false)
      assert.equal(isSafeOwnedTempDirectory(tmpdir()), false)
      assert.equal(isSafeOwnedTempDirectory('sikumi-e2e-relative'), false)
      assert.equal(isSafeOwnedTempDirectory(''), false)
      assert.equal(isSafeOwnedTempDirectory(foreign), false)
      assert.equal(
        isSafeOwnedTempDirectory(join(tmpdir(), 'sikumi-e2e-missing-dir')),
        true,
      )
    } finally {
      rmSync(foreign, { recursive: true, force: true })
    }
  })

  it('does not treat a nested escape as owned', () => {
    const owned = mkdtempSync(join(tmpdir(), 'sikumi-e2e-nested-'))
    try {
      mkdirSync(join(owned, 'child'), { recursive: true })
      assert.equal(
        isSafeOwnedTempDirectory(join(owned, 'child', '..', '..', 'passwd')),
        false,
      )
    } finally {
      rmSync(owned, { recursive: true, force: true })
    }
  })
})
