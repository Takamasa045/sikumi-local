import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { databaseFilePath, resolveDataDirectory } from './data-directory.js'

describe('resolveDataDirectory', () => {
  it('prefers the explicit environment override', () => {
    expect(
      resolveDataDirectory({ SIKUMI_LOCAL_DATA_DIR: '/tmp/sikumi-test' }),
    ).toBe('/tmp/sikumi-test')
  })

  it('falls back to the local application data directory', () => {
    expect(resolveDataDirectory({})).toBe(join(homedir(), '.shikumi-local'))
  })

  it('places the sqlite file inside the data directory', () => {
    expect(databaseFilePath('/tmp/sikumi-test')).toBe(
      '/tmp/sikumi-test/database.sqlite',
    )
  })
})
