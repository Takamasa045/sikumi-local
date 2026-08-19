import { mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistJobArtifactFile } from '../artifacts/persist.js'
import { MAX_ARTIFACT_CONTENT_BYTES } from '../artifacts/read-content.js'
import { buildApp } from '../app.js'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { injectPublic } from '../test/http.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const databases: Array<ReturnType<typeof openDatabase>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('artifact content API', () => {
  it('serves report, markdown, and patch bodies without listing content or paths', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = startApp(dataDirectory)
    const reportId = seedArtifact({
      dataDirectory,
      id: 'art-report',
      type: 'report',
      title: '調査メモ',
      content: JSON.stringify({ summary: '完了しました' }),
    })
    const markdownId = seedArtifact({
      dataDirectory,
      id: 'art-md',
      type: 'markdown',
      title: 'メモ',
      content: '# 日本語\n',
    })
    const patchId = seedArtifact({
      dataDirectory,
      id: 'art-patch',
      type: 'patch',
      title: '差分',
      content: 'diff --git a/a.txt b/a.txt\n',
    })

    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts',
    })
    expect(listed.statusCode).toBe(200)
    expect(JSON.stringify(listed.json())).not.toContain('完了しました')
    expect(JSON.stringify(listed.json())).not.toContain('# 日本語')

    const report = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts/${reportId}/content`,
    })
    expect(report.statusCode).toBe(200)
    expect(report.json()).toMatchObject({
      artifactId: reportId,
      format: 'json',
      truncated: false,
    })
    expect(report.json().content).toContain('完了しました')
    expect(JSON.stringify(report.json())).not.toContain(dataDirectory)

    const markdown = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts/${markdownId}/content`,
    })
    expect(markdown.json().format).toBe('markdown')
    expect(markdown.json().content).toContain('日本語')

    const patch = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts/${patchId}/content`,
    })
    expect(patch.json().format).toBe('patch')
    expect(JSON.stringify(patch.json())).not.toContain(dataDirectory)
  })

  it('returns 404 when the artifact is missing or has no storage path', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = startApp(dataDirectory)
    seedBareArtifact({ dataDirectory, id: 'art-empty', storagePath: null })

    const missing = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts/missing/content',
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(missing.json())).not.toContain(dataDirectory)

    const empty = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts/art-empty/content',
    })
    expect(empty.statusCode).toBe(404)
    expect(empty.json().error.code).toBe('NOT_FOUND')
    expect(JSON.stringify(empty.json())).not.toContain(dataDirectory)
  })

  it('rejects outside paths, directories, and symlinks without leaking paths', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = startApp(dataDirectory)
    const outside = join(track(createTemporaryDirectory()), 'outside.txt')
    writeFileSync(outside, 'secret')
    seedBareArtifact({
      dataDirectory,
      id: 'art-out',
      storagePath: outside,
    })
    const directory = join(dataDirectory, 'as-dir')
    mkdirSync(directory)
    seedBareArtifact({
      dataDirectory,
      id: 'art-dir',
      storagePath: directory,
    })
    const realPath = persistJobArtifactFile({
      dataDirectory,
      jobId: 'job-1',
      artifactId: 'art-real',
      artifactType: 'markdown',
      title: 'real',
      content: 'ok',
    })
    const link = join(dataDirectory, 'link.md')
    symlinkSync(realPath, link)
    seedBareArtifact({
      dataDirectory,
      id: 'art-link',
      storagePath: link,
    })

    const outsideResponse = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts/art-out/content',
    })
    expect([400, 403]).toContain(outsideResponse.statusCode)
    expect(outsideResponse.json().error.code).toBe('PATH_TRAVERSAL')
    expect(JSON.stringify(outsideResponse.json())).not.toContain(dataDirectory)
    expect(JSON.stringify(outsideResponse.json())).not.toContain(outside)

    const directoryResponse = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts/art-dir/content',
    })
    expect(directoryResponse.statusCode).toBe(400)
    expect(directoryResponse.json().error.code).toBe('VALIDATION_FAILED')
    expect(JSON.stringify(directoryResponse.json())).not.toContain(
      dataDirectory,
    )

    const linkResponse = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts/art-link/content',
    })
    expect([400, 403]).toContain(linkResponse.statusCode)
    expect(JSON.stringify(linkResponse.json())).not.toContain(dataDirectory)
  })

  it('truncates bodies larger than 1 MiB', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = startApp(dataDirectory)
    const id = seedArtifact({
      dataDirectory,
      id: 'art-huge',
      type: 'file',
      title: 'huge',
      content: 'Z'.repeat(MAX_ARTIFACT_CONTENT_BYTES + 64),
    })
    const response = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts/${id}/content`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().truncated).toBe(true)
    expect(response.json().content.length).toBe(MAX_ARTIFACT_CONTENT_BYTES)
    expect(JSON.stringify(response.json())).not.toContain(dataDirectory)
  })

  it('hides storagePath and canary absolute paths from list and detail JSON', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const app = startApp(dataDirectory)
    const canary = join(dataDirectory, 'CANARY_ABS_PATH_MUST_NOT_LEAK.txt')
    writeFileSync(canary, 'secret-body')
    const id = 'art-canary'
    seedBareArtifact({
      dataDirectory,
      id,
      type: 'report',
      title: '公開してもよい題名',
      storagePath: canary,
    })

    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/artifacts',
    })
    expect(listed.statusCode).toBe(200)
    const listedBody = JSON.stringify(listed.json())
    expect(listedBody).not.toContain('storagePath')
    expect(listedBody).not.toContain(canary)
    expect(listedBody).not.toContain(dataDirectory)
    expect(listedBody).not.toContain('CANARY_ABS_PATH_MUST_NOT_LEAK')
    const listedArtifact = listed
      .json()
      .artifacts.find((artifact: { id: string }) => artifact.id === id)
    expect(listedArtifact).toMatchObject({
      id,
      jobId: 'job-1',
      type: 'report',
      title: '公開してもよい題名',
      createdAt: 't',
    })
    expect(listedArtifact).not.toHaveProperty('storagePath')
    expect(Object.keys(listedArtifact as object).sort()).toEqual(
      ['createdAt', 'id', 'jobId', 'title', 'type'].sort(),
    )

    const detail = await injectPublic(app, {
      method: 'GET',
      url: `/api/artifacts/${id}`,
    })
    expect(detail.statusCode).toBe(200)
    const detailBody = JSON.stringify(detail.json())
    expect(detailBody).not.toContain('storagePath')
    expect(detailBody).not.toContain(canary)
    expect(detailBody).not.toContain(dataDirectory)
    expect(detailBody).not.toContain('CANARY_ABS_PATH_MUST_NOT_LEAK')
    expect(detail.json().artifact).toMatchObject({
      id,
      jobId: 'job-1',
      type: 'report',
      title: '公開してもよい題名',
      createdAt: 't',
    })
    expect(detail.json().artifact).not.toHaveProperty('storagePath')
    expect(Object.keys(detail.json().artifact as object).sort()).toEqual(
      ['createdAt', 'id', 'jobId', 'title', 'type'].sort(),
    )
  })
})

function startApp(dataDirectory: string) {
  const app = buildApp({
    dataDirectory,
    enableFakeProvider: true,
    liveProviderRuns: false,
  })
  apps.push(app)
  return app
}

function seedArtifact(input: {
  readonly dataDirectory: string
  readonly id: string
  readonly type: 'report' | 'markdown' | 'patch' | 'file'
  readonly title: string
  readonly content: string
}): string {
  const storagePath = persistJobArtifactFile({
    dataDirectory: input.dataDirectory,
    jobId: 'job-1',
    artifactId: input.id,
    artifactType: input.type,
    title: input.title,
    content: input.content,
  })
  seedBareArtifact({
    dataDirectory: input.dataDirectory,
    id: input.id,
    type: input.type,
    title: input.title,
    storagePath,
  })
  return input.id
}

function seedBareArtifact(input: {
  readonly dataDirectory: string
  readonly id: string
  readonly type?: 'report' | 'markdown' | 'patch' | 'file'
  readonly title?: string
  readonly storagePath: string | null
}): void {
  const opened = openDatabase(input.dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  store.insertArtifact({
    id: input.id,
    jobId: 'job-1',
    type: input.type ?? 'report',
    title: input.title ?? '成果',
    storagePath: input.storagePath,
    createdAt: 't',
  })
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
