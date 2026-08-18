import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@sikumi-local/core'
import { resetSessionToken } from './session.js'
import { getArtifactContent } from './artifacts.js'

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('artifact content client', () => {
  it('validates a content payload without a storage path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          artifactId: 'art_1',
          title: '調査メモ',
          type: 'report',
          format: 'json',
          content: '{"ok":true}',
          sizeBytes: 11,
          truncated: false,
        }),
      ),
    )
    await expect(getArtifactContent('art_1')).resolves.toMatchObject({
      artifactId: 'art_1',
      format: 'json',
    })
  })

  it('rejects an invalid payload and surfaces API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: { code: 'NOT_FOUND', message: '成果が見つかりません' } },
          404,
        ),
      ),
    )
    await expect(getArtifactContent('missing')).rejects.toBeInstanceOf(AppError)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          artifactId: 'art_1',
          title: 'bad',
          type: 'report',
          format: 'html',
          content: '<b>no</b>',
          sizeBytes: 1,
          truncated: false,
        }),
      ),
    )
    await expect(getArtifactContent('art_1')).rejects.toThrow()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
