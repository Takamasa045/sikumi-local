import { AppError } from '@sikumi-local/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER_NAME, resetSessionToken } from './session.js'
import {
  chooseWorkspaceFolder,
  listWorkspaces,
  registerWorkspace,
  unregisterWorkspace,
  updateWorkspace,
  updateWorkspaceEmployeeName,
} from './workspaces.js'

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('workspace API client', () => {
  it('lists persisted workspaces from the local server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          workspaces: [sampleWorkspace('/Users/example/project')],
        }),
      ),
    )

    await expect(listWorkspaces()).resolves.toEqual([
      sampleWorkspace('/Users/example/project'),
    ])
  })

  it('registers a repository through the local server with the session token', async () => {
    const workspace = sampleWorkspace('/Users/example/project')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        expect(init?.method).toBe('POST')
        expect(init?.credentials).toBe('include')
        expect(headerValue(init?.headers, CSRF_HEADER_NAME)).toBe(
          'boot-session-token',
        )
        expect(init?.body).toBe(
          JSON.stringify({ path: '/Users/example/project' }),
        )
        return jsonResponse({ workspace }, 201)
      }),
    )

    await expect(registerWorkspace('/Users/example/project')).resolves.toEqual(
      workspace,
    )
  })

  it('担当名を指定してRepositoryを登録する', async () => {
    const workspace = {
      ...sampleWorkspace('/Users/example/project'),
      employeeName: 'イトパン',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        expect(init?.body).toBe(
          JSON.stringify({
            path: '/Users/example/project',
            employeeName: 'イトパン',
          }),
        )
        return jsonResponse({ workspace }, 201)
      }),
    )

    await expect(
      registerWorkspace('/Users/example/project', 'イトパン'),
    ).resolves.toEqual(workspace)
  })

  it('surfaces domain errors from the local server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        return jsonResponse(
          {
            error: {
              code: 'REPOSITORY_NOT_GIT',
              message: 'Git Repositoryではありません',
            },
          },
          400,
        )
      }),
    )

    await expect(registerWorkspace('/tmp/not-git')).rejects.toMatchObject({
      name: 'AppError',
      code: 'REPOSITORY_NOT_GIT',
    } satisfies Partial<AppError>)
  })

  it('maps a failed list response to a domain error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'NOT_FOUND', message: 'missing' } }, 404),
      ),
    )

    await expect(listWorkspaces()).rejects.toBeInstanceOf(AppError)
  })

  it('falls back when the error body is not a domain error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        return jsonResponse({ broken: true }, 500)
      }),
    )

    await expect(registerWorkspace('/tmp/repo')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '登録に失敗しました',
    })
  })

  it('falls back when the error code is unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        return jsonResponse(
          { error: { code: 'SECRET_LEAK', message: 'nope' } },
          500,
        )
      }),
    )

    await expect(registerWorkspace('/tmp/repo')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'nope',
    })
  })

  it('asks the local server to open a native folder picker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        expect(String(input)).toMatch(/\/api\/workspaces\/choose-folder$/)
        expect(init?.method).toBe('POST')
        return jsonResponse({
          cancelled: false,
          path: '/Users/example/blog',
        })
      }),
    )

    await expect(chooseWorkspaceFolder()).resolves.toBe('/Users/example/blog')
  })

  it('returns null when folder picking is cancelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        return jsonResponse({ cancelled: true })
      }),
    )

    await expect(chooseWorkspaceFolder()).resolves.toBeNull()
  })

  it('unregisters a workspace without deleting the folder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        expect(String(input)).toMatch(/\/api\/workspaces\/ws_1$/)
        expect(init?.method).toBe('DELETE')
        return jsonResponse({ ok: true })
      }),
    )

    await expect(unregisterWorkspace('ws_1')).resolves.toBeUndefined()
  })

  it('updates the workspace default tool', async () => {
    const workspace = {
      ...sampleWorkspace('/Users/example/project'),
      defaultProviderId: 'codex' as const,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        expect(init?.method).toBe('PATCH')
        return jsonResponse({ workspace })
      }),
    )
    await expect(updateWorkspace('ws_1', 'codex')).resolves.toEqual(workspace)
  })

  it('工房の担当名を更新する', async () => {
    const workspace = {
      ...sampleWorkspace('/Users/example/project'),
      employeeName: 'イトパン',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        expect(init?.method).toBe('PATCH')
        expect(init?.body).toBe(JSON.stringify({ employeeName: 'イトパン' }))
        return jsonResponse({ workspace })
      }),
    )
    await expect(
      updateWorkspaceEmployeeName('ws_1', 'イトパン'),
    ).resolves.toEqual(workspace)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function headerValue(
  headers: HeadersInit | undefined,
  name: string,
): string | undefined {
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return undefined
  }
  return headers[name]
}

function sampleWorkspace(absolutePath: string) {
  return {
    id: 'ws_1',
    name: 'project',
    defaultProviderId: null,
    worldPackId: 'dog-office',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    repository: {
      id: 'repo_1',
      absolutePath,
      displayName: 'project',
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/example/project.git',
      readable: true,
    },
  }
}
