import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { persistJobArtifactFile } from './persist.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('persistJobArtifactFile', () => {
  it('atomically writes validated reports and markdown under the data directory', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const reportPath = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-1',
      artifactId: 'art-report',
      artifactType: 'report',
      title: '調査メモ',
      content: JSON.stringify({ title: '調査メモ', summary: '完了' }),
    })
    const markdownPath = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-1',
      artifactId: 'art-notes',
      artifactType: 'markdown',
      title: 'notes',
      content: '# 調査メモ\n',
    })

    expect(reportPath.startsWith(join(dataDirectory, 'reports', 'job-1'))).toBe(
      true,
    )
    expect(
      markdownPath.startsWith(join(dataDirectory, 'reports', 'job-1')),
    ).toBe(true)
    expect(statSync(reportPath).mode & 0o777).toBe(0o600)
    expect(statSync(markdownPath).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual({
      title: '調査メモ',
      summary: '完了',
    })
    expect(existsSync(reportPath)).toBe(true)
    expect(
      existsSync(join(dataDirectory, 'reports', 'job-1', '.artifact.json.tmp')),
    ).toBe(false)
  })

  it('keeps invalid raw results after a simulated restart', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const rawPath = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-raw',
      artifactId: 'art-raw',
      artifactType: 'file',
      title: 'raw result',
      content: 'not-json SECRET_SHOULD_STAY_IN_FILE',
    })

    expect(rawPath).toBe(
      join(dataDirectory, 'artifacts', 'job-raw', 'raw-result-art-raw.txt'),
    )
    expect(readFileSync(rawPath, 'utf8')).toContain('not-json')
    expect(existsSync(rawPath)).toBe(true)
    expect(statSync(rawPath).mode & 0o777).toBe(0o600)
  })

  it('rejects path traversal in jobId and title without mixing secrets into the error', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const secret = 'sk-live-secret-value'

    expect(() =>
      persistJobArtifactFile({
        dataDirectory,
        jobId: '../etc',
        artifactId: 'art-1',
        artifactType: 'file',
        title: 'ok',
        content: secret,
      }),
    ).toThrow(AppError)
    expect(() =>
      persistJobArtifactFile({
        dataDirectory,
        jobId: 'job-1',
        artifactId: 'art-1',
        artifactType: 'file',
        title: '../../passwd',
        content: secret,
      }),
    ).toThrow(AppError)
    expect(() =>
      persistJobArtifactFile({
        dataDirectory,
        jobId: 'job-1',
        artifactId: 'art-1',
        artifactType: 'file',
        title: 'abs/path',
        content: secret,
      }),
    ).toThrow(AppError)

    try {
      persistJobArtifactFile({
        dataDirectory,
        jobId: '..',
        artifactId: 'art-1',
        artifactType: 'report',
        title: 'ok',
        content: secret,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(JSON.stringify(error)).not.toContain(secret)
      expect((error as AppError).message).not.toContain(secret)
    }

    expect(existsSync(join(dataDirectory, 'etc'))).toBe(false)
    expect(existsSync(join(tmpdir(), 'passwd'))).toBe(false)
  })

  it('keeps unique storage paths when the same job writes the same title twice', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const first = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-1',
      artifactId: '11111111-1111-4111-8111-111111111111',
      artifactType: 'report',
      title: '調査メモ',
      content: '{"n":1}',
    })
    const second = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-1',
      artifactId: '22222222-2222-4222-8222-222222222222',
      artifactType: 'report',
      title: '調査メモ',
      content: '{"n":2}',
    })

    expect(first).not.toBe(second)
    expect(first).toContain('11111111-1111-4111-8111-111111111111')
    expect(second).toContain('22222222-2222-4222-8222-222222222222')
    expect(readFileSync(first, 'utf8')).toBe('{"n":1}')
    expect(readFileSync(second, 'utf8')).toBe('{"n":2}')
  })
})

function track(directory: string): string {
  directories.push(directory)
  return directory
}
