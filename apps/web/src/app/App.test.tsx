import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionToken } from '../api/session'
import { App } from './App'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/session')) {
      return jsonResponse({ token: 'test-session' })
    }
    if (url.endsWith('/api/workspaces')) {
      return jsonResponse({ workspaces: [] })
    }
    return jsonResponse(
      { error: { code: 'NOT_FOUND', message: 'not found' } },
      404,
    )
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('Shikumi Local garden', () => {
  it('shows the initial dog atelier without pretending work is running', async () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '犬たちの里山アトリエ' }),
    ).toBeVisible()
    expect(screen.getByText('サグル')).toBeVisible()
    expect(screen.getByText('まだ仕事は始まっていません')).toBeVisible()
    expect(screen.queryByText('作業中')).not.toBeInTheDocument()
    expect(await screen.findByText('Repository未登録')).toBeVisible()
  })

  it('switches to the craft workshop', async () => {
    render(<App />)

    await userEvent.click(
      screen.getByRole('button', { name: '職人工房を表示' }),
    )

    expect(screen.getByRole('heading', { name: '職人工房' })).toBeVisible()
    expect(screen.getByTestId('world-stage')).toHaveAttribute(
      'data-world-pack',
      'craft-workshop',
    )
  })

  it('keeps job submission disabled while provider execution is disconnected', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '仕事を頼む' })).toBeDisabled()
    expect(screen.getByText('実行機能は次のPhaseで接続します')).toBeVisible()
    expect(screen.getAllByText('実行エンジン未接続').length).toBeGreaterThan(0)
  })

  it('registers a repository through the local server without leaving the garden', async () => {
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'test-session' })
        }
        if (url.endsWith('/api/workspaces') && method === 'GET') {
          return jsonResponse({ workspaces: [] })
        }
        if (url.endsWith('/api/workspaces') && method === 'POST') {
          return jsonResponse(
            {
              workspace: {
                id: 'ws_1',
                name: 'my-project',
                defaultProviderId: null,
                worldPackId: 'dog-office',
                createdAt: '2026-08-18T00:00:00.000Z',
                updatedAt: '2026-08-18T00:00:00.000Z',
                repository: {
                  id: 'repo_1',
                  absolutePath: '/Users/example/my-project',
                  displayName: 'my-project',
                  currentBranch: 'main',
                  remoteName: 'origin',
                  remoteUrl: 'https://github.com/example/my-project.git',
                  readable: true,
                },
              },
            },
            201,
          )
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        )
      },
    )

    render(<App />)

    await userEvent.type(
      screen.getByLabelText('Repositoryの場所'),
      '/Users/example/my-project',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'この工房に登録する' }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('workspace-line')).toHaveTextContent(
        'my-project',
      )
    })
    expect(screen.getByText('✓ Git Repository')).toBeVisible()
    expect(screen.getByText('✓ 現在のbranch: main')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: '犬たちの里山アトリエ' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '仕事を頼む' })).toBeDisabled()
  })

  it('restores a persisted workspace on load', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/session')) {
        return jsonResponse({ token: 'test-session' })
      }
      if (String(input).endsWith('/api/workspaces')) {
        return jsonResponse({
          workspaces: [
            {
              id: 'ws_1',
              name: 'kept-project',
              defaultProviderId: null,
              worldPackId: 'dog-office',
              createdAt: '2026-08-18T00:00:00.000Z',
              updatedAt: '2026-08-18T00:00:00.000Z',
              repository: {
                id: 'repo_1',
                absolutePath: '/Users/example/kept-project',
                displayName: 'kept-project',
                currentBranch: 'main',
                remoteName: 'origin',
                remoteUrl: 'https://github.com/example/kept-project.git',
                readable: true,
              },
            },
          ],
        })
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'not found' } },
        404,
      )
    })

    render(<App />)

    expect(await screen.findByTestId('workspace-line')).toHaveTextContent(
      'kept-project',
    )
    expect(screen.getByText('✓ Git Repository')).toBeVisible()
  })

  it('keeps the garden usable when workspace listing fails', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })

    render(<App />)

    expect(await screen.findByText('Repository未登録')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: '犬たちの里山アトリエ' }),
    ).toBeVisible()
  })

  it('shows a registration error from the local server', async () => {
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'test-session' })
        }
        if (url.endsWith('/api/workspaces') && method === 'GET') {
          return jsonResponse({ workspaces: [] })
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
      },
    )

    render(<App />)

    await userEvent.type(
      screen.getByLabelText('Repositoryの場所'),
      '/tmp/not-git',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'この工房に登録する' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Git Repositoryではありません',
    )
    expect(screen.getByText('Repository未登録')).toBeVisible()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
