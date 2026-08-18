import {
  mkdirSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, type Artifact } from '@sikumi-local/core'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { persistJobArtifactFile } from './persist.js'
import {
  MAX_ARTIFACT_CONTENT_BYTES,
  readArtifactContent,
  resolveArtifactContentFormat,
} from './read-content.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('resolveArtifactContentFormat', () => {
  it('maps artifact type rather than a file extension', () => {
    expect(resolveArtifactContentFormat('report')).toBe('json')
    expect(resolveArtifactContentFormat('markdown')).toBe('markdown')
    expect(resolveArtifactContentFormat('patch')).toBe('patch')
    expect(resolveArtifactContentFormat('code_diff')).toBe('patch')
    expect(resolveArtifactContentFormat('test_result')).toBe('text')
  })
})

describe('readArtifactContent', () => {
  it('reads report, markdown, and patch files including Japanese UTF-8', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const report = persistAndRead({
      dataDirectory,
      artifactId: 'art-report',
      artifactType: 'report',
      title: '調査メモ',
      content: JSON.stringify({ summary: '完了しました', note: '日本語' }),
    })
    const markdown = persistAndRead({
      dataDirectory,
      artifactId: 'art-md',
      artifactType: 'markdown',
      title: 'notes',
      content: '# 見出し\n本文です\n',
    })
    const patch = persistAndRead({
      dataDirectory,
      artifactId: 'art-patch',
      artifactType: 'patch',
      title: '変更',
      content: 'diff --git a/日本語.txt b/日本語.txt\n',
    })

    expect(report.format).toBe('json')
    expect(report.content).toContain('完了しました')
    expect(report.truncated).toBe(false)
    expect(markdown.format).toBe('markdown')
    expect(markdown.content).toContain('見出し')
    expect(patch.format).toBe('patch')
    expect(patch.content).toContain('日本語.txt')
    expect(serialized(report)).not.toContain(dataDirectory)
    expect(serialized(markdown)).not.toContain(dataDirectory)
    expect(serialized(patch)).not.toContain(dataDirectory)
  })

  it('returns NOT_FOUND when the artifact is missing or has no storage path', () => {
    const dataDirectory = track(createTemporaryDirectory())
    expect(() =>
      readArtifactContent({
        artifact: sample({ storagePath: null }),
        dataDirectory,
      }),
    ).toThrow(AppError)
    try {
      readArtifactContent({
        artifact: sample({ storagePath: null }),
        dataDirectory,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('NOT_FOUND')
      expect((error as AppError).statusCode).toBe(404)
      expect(JSON.stringify(error)).not.toContain(dataDirectory)
    }

    try {
      readArtifactContent({
        artifact: sample({
          storagePath: join(dataDirectory, 'reports', 'missing.json'),
        }),
        dataDirectory,
      })
    } catch (error) {
      expect((error as AppError).code).toBe('NOT_FOUND')
      expect(JSON.stringify(error)).not.toContain(dataDirectory)
    }
  })

  it('rejects an outside path without disclosing the data directory', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const outside = join(track(createTemporaryDirectory()), 'secret.txt')
    writeFileSync(outside, 'outside-secret')
    try {
      readArtifactContent({
        artifact: sample({ storagePath: outside }),
        dataDirectory,
      })
      throw new Error('expected PATH_TRAVERSAL')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('PATH_TRAVERSAL')
      expect([400, 403]).toContain((error as AppError).statusCode)
      expect(JSON.stringify(error)).not.toContain(dataDirectory)
      expect(JSON.stringify(error)).not.toContain(outside)
      expect((error as AppError).message).not.toContain(dataDirectory)
    }
  })

  it('rejects a symlink even when the target is inside the data directory', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const realPath = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-1',
      artifactId: 'art-real',
      artifactType: 'markdown',
      title: 'real',
      content: 'real-body',
    })
    const linkPath = join(dataDirectory, 'linked.md')
    symlinkSync(realPath, linkPath)
    try {
      readArtifactContent({
        artifact: sample({ storagePath: linkPath }),
        dataDirectory,
      })
      throw new Error('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect(['PATH_TRAVERSAL', 'VALIDATION_FAILED']).toContain(
        (error as AppError).code,
      )
      expect(JSON.stringify(error)).not.toContain(dataDirectory)
      expect(JSON.stringify(error)).not.toContain(linkPath)
    }
  })

  it('rejects a directory as a non-file', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const directory = join(dataDirectory, 'reports', 'job-dir')
    mkdirSync(directory, { recursive: true })
    try {
      readArtifactContent({
        artifact: sample({ storagePath: directory }),
        dataDirectory,
      })
      throw new Error('expected VALIDATION_FAILED')
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION_FAILED')
      expect((error as AppError).statusCode).toBe(400)
      expect(JSON.stringify(error)).not.toContain(dataDirectory)
    }
  })

  it('reads only the first 1 MiB and marks larger files as truncated', () => {
    const dataDirectory = track(createTemporaryDirectory())
    const payload = `${'あ'.repeat(200_000)}${'B'.repeat(MAX_ARTIFACT_CONTENT_BYTES)}`
    const result = persistAndRead({
      dataDirectory,
      artifactId: 'art-huge',
      artifactType: 'file',
      title: 'huge',
      content: payload,
    })
    expect(result.truncated).toBe(true)
    expect(result.sizeBytes).toBeGreaterThan(MAX_ARTIFACT_CONTENT_BYTES)
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(
      MAX_ARTIFACT_CONTENT_BYTES,
    )
    expect(result.content.includes('\uFFFD')).toBe(false)
    expect(serialized(result)).not.toContain(dataDirectory)
  })
})

function persistAndRead(input: {
  readonly dataDirectory: string
  readonly artifactId: string
  readonly artifactType: Artifact['type']
  readonly title: string
  readonly content: string
}) {
  const storagePath = persistJobArtifactFile({
    dataDirectory: input.dataDirectory,
    jobId: 'job-1',
    artifactId: input.artifactId,
    artifactType: input.artifactType,
    title: input.title,
    content: input.content,
  })
  chmodSync(storagePath, 0o600)
  return readArtifactContent({
    artifact: sample({
      id: input.artifactId,
      type: input.artifactType,
      title: input.title,
      storagePath,
    }),
    dataDirectory: input.dataDirectory,
  })
}

function sample(
  patch: Partial<Artifact> & { readonly storagePath: string | null },
): Artifact {
  return {
    id: patch.id ?? 'art_1',
    jobId: 'job_1',
    type: patch.type ?? 'report',
    title: patch.title ?? '調査メモ',
    storagePath: patch.storagePath,
    createdAt: 't',
  }
}

function serialized(value: unknown): string {
  return JSON.stringify(value)
}

function track(directory: string): string {
  directories.push(directory)
  return directory
}
