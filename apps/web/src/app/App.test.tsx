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
    if (url.endsWith('/api/health')) {
      return jsonResponse(disconnectedHealth())
    }
    if (url.endsWith('/api/workspaces')) {
      return jsonResponse({ workspaces: [] })
    }
    if (url.endsWith('/api/providers')) {
      return jsonResponse({
        providers: catalogProviders(),
        executionConnected: false,
        fakeHarness: false,
      })
    }
    if (url.includes('/api/employees')) {
      return employeePayload()
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

  it('opens the four main screens and the employee drawer from the garden', async () => {
    render(<App />)

    expect(await screen.findByLabelText('担当')).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: 'AI社員' }))
    expect(await screen.findByRole('heading', { name: 'AI社員' })).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: '成果棚' }))
    expect(await screen.findByRole('heading', { name: '成果棚' })).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: '設定' }))
    expect(
      await screen.findByRole('heading', { name: '工房の整え方' }),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: '庭' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'サグルを確認する' }),
    )
    expect(await screen.findByTestId('employee-drawer')).toBeVisible()
    expect(screen.getByText('受けられる仕事', { exact: false })).toBeVisible()
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
    expect(
      screen.getByText(
        '道具を選び、ログイン済みの実行エンジンだけで仕事を始めます。自動切替はしません',
      ),
    ).toBeVisible()
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
        if (url.endsWith('/api/health')) {
          return jsonResponse(disconnectedHealth())
        }
        if (url.endsWith('/api/providers')) {
          return jsonResponse({
            providers: catalogProviders(),
            executionConnected: false,
            fakeHarness: false,
          })
        }
        if (url.includes('/api/employees')) {
          return employeePayload()
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
      if (String(input).endsWith('/api/health')) {
        return jsonResponse(disconnectedHealth())
      }
      if (String(input).endsWith('/api/providers')) {
        return jsonResponse({
          providers: catalogProviders(),
          executionConnected: false,
          fakeHarness: false,
        })
      }
      if (String(input).includes('/api/employees')) {
        return jsonResponse({ employees: [sampleEmployee()] })
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

  it('restores job history for a real provider without the fake harness', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/session')) {
        return jsonResponse({ token: 'test-session' })
      }
      if (url.endsWith('/api/health')) {
        return jsonResponse({
          ...disconnectedHealth(),
          liveProviderRuns: true,
        })
      }
      if (url.endsWith('/api/providers')) {
        return jsonResponse({
          providers: [
            { id: 'codex', displayName: 'Codex', executionConnected: true },
            {
              id: 'grok-build',
              displayName: 'Grok Build',
              executionConnected: false,
            },
            {
              id: 'claude-code',
              displayName: 'Claude Code',
              executionConnected: false,
            },
          ],
          executionConnected: true,
          fakeHarness: false,
        })
      }
      if (url.includes('/api/employees')) {
        return jsonResponse({
          employees: [sampleEmployee()],
          employee: sampleEmployee(),
          recentJobs: [],
          stateMap: { states: {}, eventBindings: {} },
        })
      }
      if (url.endsWith('/api/workspaces')) {
        return jsonResponse({ workspaces: [sampleWorkspace()] })
      }
      if (url.includes('/api/jobs/job_1/events')) {
        return jsonResponse({
          events: [
            {
              id: 'evt_1',
              jobId: 'job_1',
              runId: 'run_1',
              type: 'run.state_changed',
              payload: { summary: '公式情報を探しています' },
              occurredAt: 't',
            },
          ],
        })
      }
      if (url.endsWith('/api/jobs/job_1')) {
        return jsonResponse({
          job: { ...sampleJob('running'), selectedProvider: 'codex' },
        })
      }
      if (url.includes('/api/jobs?') || url.endsWith('/api/jobs')) {
        return jsonResponse({
          jobs: [{ ...sampleJob('running'), selectedProvider: 'codex' }],
        })
      }
      if (url.includes('/api/approvals')) {
        return jsonResponse({ approvals: [] })
      }
      if (url.includes('/api/artifacts')) {
        return jsonResponse({ artifacts: [] })
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'not found' } },
        404,
      )
    })

    render(<App />)

    expect(
      await screen.findByRole('button', { name: '仕事を中止' }),
    ).toBeVisible()
    expect(await screen.findByText('公式情報を探しています')).toBeVisible()
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/api/jobs?workspaceId=ws_1'),
      ),
    ).toBe(true)
    expect(
      screen.getByPlaceholderText('例：このRepositoryの構成と改善点を調べて'),
    ).toBeEnabled()
  })

  it('keeps the current job employee and station when another employee is selected to ask next', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/session')) {
        return jsonResponse({ token: 'test-session' })
      }
      if (url.endsWith('/api/health')) {
        return jsonResponse({ ...disconnectedHealth(), fakeHarness: true })
      }
      if (url.endsWith('/api/providers')) {
        return jsonResponse({
          providers: catalogProviders(),
          executionConnected: false,
          fakeHarness: true,
        })
      }
      if (url.endsWith('/api/employees/miru')) {
        return jsonResponse({
          employee: sampleMiru(),
          recentJobs: [],
          stateMap: miruStateMap(),
        })
      }
      if (url.includes('/api/employees')) {
        return jsonResponse({
          employees: [sampleEmployee(), sampleMiru()],
          employee: sampleEmployee(),
          recentJobs: [],
          stateMap: saguruStateMap(),
        })
      }
      if (url.endsWith('/api/workspaces')) {
        return jsonResponse({ workspaces: [sampleWorkspace()] })
      }
      if (url.includes('/api/jobs/job_1/events')) {
        return jsonResponse({
          events: [
            {
              id: 'evt_read',
              jobId: 'job_1',
              runId: 'run_1',
              type: 'repository.read',
              payload: { summary: 'この工房の資料を読んでいます' },
              occurredAt: 't',
            },
          ],
        })
      }
      if (url.includes('/api/jobs')) {
        return jsonResponse({
          jobs: [sampleJob('running')],
          job: sampleJob('running'),
        })
      }
      if (url.includes('/api/approvals')) {
        return jsonResponse({
          approvals: [
            {
              id: 'apr_1',
              jobId: 'job_1',
              runId: 'run_1',
              risk: 'medium',
              summary: '外部サイトへアクセスします',
              status: 'pending',
              createdAt: 't',
              resolvedAt: null,
            },
          ],
        })
      }
      if (url.includes('/api/artifacts')) {
        return jsonResponse({ artifacts: [] })
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'not found' } },
        404,
      )
    })

    render(<App />)

    expect(await screen.findByTestId('world-stage')).toHaveAttribute(
      'data-employee-id',
      'saguru',
    )
    await waitFor(() => {
      expect(screen.getByTestId('world-stage')).toHaveAttribute(
        'data-station',
        'archive',
      )
    })
    expect(screen.getByTestId('current-job')).toHaveTextContent('サグル')
    expect(screen.getByTestId('approval-panel')).toHaveTextContent('サグル')

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '担当' }),
      'miru',
    )

    expect(
      await screen.findByRole('heading', { name: 'ミルに何を頼みますか' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'ミルを確認する' })).toBeVisible()
    expect(screen.getByTestId('world-stage')).toHaveAttribute(
      'data-employee-id',
      'saguru',
    )
    expect(screen.getByTestId('world-stage')).toHaveAttribute(
      'data-station',
      'archive',
    )
    expect(screen.getByTestId('current-job')).toHaveTextContent('サグル')
    expect(screen.getByTestId('current-job')).not.toHaveTextContent('ミル')
    expect(screen.getByTestId('approval-panel')).toHaveTextContent('サグル')
    expect(screen.getByTestId('approval-panel')).not.toHaveTextContent('ミル')
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
        if (url.endsWith('/api/health')) {
          return jsonResponse(disconnectedHealth())
        }
        if (url.endsWith('/api/providers')) {
          return jsonResponse({
            providers: catalogProviders(),
            executionConnected: false,
            fakeHarness: false,
          })
        }
        if (url.includes('/api/employees')) {
          return employeePayload()
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

  it('runs a fake-harness job through approval to an artifact without naming a real engine', async () => {
    let pending = true
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'test-session' })
        }
        if (url.endsWith('/api/health')) {
          return jsonResponse({
            ...disconnectedHealth(),
            fakeHarness: true,
          })
        }
        if (url.endsWith('/api/providers')) {
          return jsonResponse({
            providers: catalogProviders(),
            executionConnected: false,
            fakeHarness: true,
          })
        }
        if (url.includes('/api/employees')) {
          return employeePayload()
        }
        if (url.endsWith('/api/workspaces') && method === 'GET') {
          return jsonResponse({
            workspaces: [sampleWorkspace()],
          })
        }
        if (url.endsWith('/api/jobs') && method === 'GET') {
          return jsonResponse({ jobs: [] })
        }
        if (url.endsWith('/api/jobs') && method === 'POST') {
          return jsonResponse({ job: sampleJob('waiting_for_user') }, 201)
        }
        if (url.endsWith('/api/jobs/job_1')) {
          return jsonResponse({
            job: sampleJob(pending ? 'waiting_for_user' : 'completed'),
          })
        }
        if (url.endsWith('/api/jobs/job_1/events')) {
          return jsonResponse({
            events: [
              {
                id: 'evt_1',
                jobId: 'job_1',
                runId: 'run_1',
                type: 'repository.read',
                payload: { summary: 'この工房の資料を読んでいます' },
                occurredAt: 't',
              },
            ],
          })
        }
        if (url.includes('/api/approvals') && method === 'GET') {
          return jsonResponse({
            approvals: pending
              ? [
                  {
                    id: 'apr_1',
                    jobId: 'job_1',
                    runId: 'run_1',
                    risk: 'medium',
                    summary: '外部サイトへアクセスします',
                    status: 'pending',
                    createdAt: 't',
                    resolvedAt: null,
                  },
                ]
              : [],
          })
        }
        if (url.endsWith('/api/approvals/apr_1/resolve') && method === 'POST') {
          pending = false
          return jsonResponse({
            approval: {
              id: 'apr_1',
              jobId: 'job_1',
              runId: 'run_1',
              risk: 'medium',
              summary: '外部サイトへアクセスします',
              status: 'approved',
              createdAt: 't',
              resolvedAt: 't',
            },
          })
        }
        if (url.includes('/api/artifacts')) {
          return jsonResponse({
            artifacts: pending
              ? []
              : [
                  {
                    id: 'art_1',
                    jobId: 'job_1',
                    type: 'report',
                    title: '調査メモ',
                    storagePath: null,
                    createdAt: 't',
                  },
                ],
          })
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        )
      },
    )

    render(<App />)

    expect(await screen.findByText('開発用ハーネス')).toBeVisible()
    expect(screen.getByText('テスト実行（実エンジン未接続）')).toBeVisible()
    expect(screen.getByLabelText('道具')).toBeVisible()

    await userEvent.type(
      screen.getByPlaceholderText('例：このRepositoryの構成と改善点を調べて'),
      '構成を調べて',
    )
    await userEvent.click(screen.getByRole('button', { name: '仕事を頼む' }))
    expect(await screen.findByText('外部サイトへアクセスします')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '今回だけ許可' }))
    expect(await screen.findByText('調査メモ')).toBeVisible()
    expect(screen.getByText('調査が完了しました')).toBeVisible()
  })

  it('asks before switching away from an unavailable provider', async () => {
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'test-session' })
        }
        if (url.endsWith('/api/health')) {
          return jsonResponse({ ...disconnectedHealth(), fakeHarness: true })
        }
        if (url.endsWith('/api/providers')) {
          return jsonResponse({
            providers: catalogProviders(),
            executionConnected: false,
            fakeHarness: true,
          })
        }
        if (url.includes('/api/employees')) {
          return employeePayload()
        }
        if (url.endsWith('/api/workspaces')) {
          return jsonResponse({ workspaces: [sampleWorkspace()] })
        }
        if (url.endsWith('/api/jobs') && method === 'GET') {
          return jsonResponse({ jobs: [] })
        }
        if (url.endsWith('/api/jobs') && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            confirmFallbackProvider?: string
          }
          if (body.confirmFallbackProvider === 'grok-build') {
            return jsonResponse({ job: sampleJob('completed') }, 201)
          }
          return jsonResponse(
            {
              error: {
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Codexを起動できませんでした。別の道具で始めますか？',
              },
              details: {
                alternatives: ['grok-build'],
                confirmationRequired: true,
              },
            },
            409,
          )
        }
        if (url.includes('/api/jobs/job_1')) {
          return jsonResponse({ job: sampleJob('completed') })
        }
        if (url.includes('/api/jobs/job_1/events')) {
          return jsonResponse({ events: [] })
        }
        if (url.includes('/api/approvals')) {
          return jsonResponse({ approvals: [] })
        }
        if (url.includes('/api/artifacts')) {
          return jsonResponse({ artifacts: [] })
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        )
      },
    )

    render(<App />)
    await userEvent.selectOptions(await screen.findByLabelText('道具'), 'codex')
    await userEvent.type(
      screen.getByPlaceholderText('例：このRepositoryの構成と改善点を調べて'),
      '調べて',
    )
    await userEvent.click(screen.getByRole('button', { name: '仕事を頼む' }))
    expect(
      await screen.findByText(
        'Codexを起動できませんでした。別の道具で始めますか？',
      ),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Grok Buildで始める' }),
    )
  })

  it('cancels a running harness job from the garden', async () => {
    let status: 'running' | 'cancelled' = 'running'
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'test-session' })
        }
        if (url.endsWith('/api/health')) {
          return jsonResponse({ ...disconnectedHealth(), fakeHarness: true })
        }
        if (url.endsWith('/api/providers')) {
          return jsonResponse({
            providers: catalogProviders(),
            executionConnected: false,
            fakeHarness: true,
          })
        }
        if (url.includes('/api/employees')) {
          return employeePayload()
        }
        if (url.endsWith('/api/workspaces')) {
          return jsonResponse({ workspaces: [sampleWorkspace()] })
        }
        if (
          (url.endsWith('/api/jobs') || url.includes('/api/jobs?')) &&
          method === 'GET'
        ) {
          return jsonResponse({ jobs: [sampleJob(status)] })
        }
        if (url.endsWith('/api/jobs/job_1') && method === 'GET') {
          return jsonResponse({ job: sampleJob(status) })
        }
        if (url.endsWith('/api/jobs/job_1/cancel')) {
          status = 'cancelled'
          return jsonResponse({ job: sampleJob('cancelled') })
        }
        if (url.endsWith('/api/jobs/job_1/events')) {
          return jsonResponse({ events: [] })
        }
        if (url.includes('/api/approvals')) {
          return jsonResponse({ approvals: [] })
        }
        if (url.includes('/api/artifacts')) {
          return jsonResponse({ artifacts: [] })
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        )
      },
    )

    render(<App />)
    expect(
      await screen.findByRole('button', { name: '仕事を中止' }),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '仕事を中止' }))
    expect(await screen.findByText('仕事を中止しました')).toBeVisible()
  })
})

function disconnectedHealth() {
  return {
    ok: true,
    product: 'Shikumi Local',
    phase: 'employee-garden',
    bind: '127.0.0.1',
    persistence: 'sqlite',
    providerExecution: 'disconnected',
    fakeHarness: false,
    liveProviderRuns: false,
  }
}

function employeePayload() {
  return jsonResponse({
    employees: [sampleEmployee()],
    employee: sampleEmployee(),
    recentJobs: [],
    stateMap: { states: {}, eventBindings: {} },
  })
}

function sampleMiru() {
  return {
    id: 'miru',
    packId: 'miru',
    name: 'ミル',
    role: '見守り担当',
    defaultProviderId: null,
    createdAt: 't',
    updatedAt: 't',
    description: '変化を見守る',
    version: '1.0.0',
    permissionProfile: 'observe',
    supportedJobTypes: ['watch'],
    defaultProviderOrder: ['codex', 'grok-build', 'claude-code'],
    requiredProviderCapabilities: ['streaming'],
    character: 'miru-default',
    source: 'installed',
  }
}

function saguruStateMap() {
  return {
    states: {
      idle: {
        station: 'rest',
        pose: 'idle',
        summary: 'まだ仕事は始まっていません',
      },
      reading_repository: {
        station: 'archive',
        pose: 'reading',
        summary: 'この工房の資料を読んでいます',
      },
    },
    eventBindings: { 'repository.read': 'reading_repository' },
  }
}

function miruStateMap() {
  return {
    states: {
      idle: {
        station: 'rest',
        pose: 'idle',
        summary: 'ミルは待っています',
      },
      reading_repository: {
        station: 'observatory',
        pose: 'searching',
        summary: 'ミルが見ています',
      },
    },
    eventBindings: { 'repository.read': 'reading_repository' },
  }
}

function sampleEmployee() {
  return {
    id: 'saguru',
    packId: 'saguru',
    name: 'サグル',
    role: '調査担当',
    defaultProviderId: null,
    createdAt: 't',
    updatedAt: 't',
    description: 'Repositoryを理解し、根拠付きのレポートを届けるAI社員。',
    version: '1.0.0',
    permissionProfile: 'research',
    supportedJobTypes: ['research'],
    defaultProviderOrder: ['grok-build', 'codex', 'claude-code'],
    requiredProviderCapabilities: ['streaming', 'sessionResume'],
    character: 'saguru-default',
    source: 'builtin',
  }
}

function catalogProviders() {
  return [
    { id: 'codex', displayName: 'Codex', executionConnected: false },
    { id: 'grok-build', displayName: 'Grok Build', executionConnected: false },
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      executionConnected: false,
    },
  ]
}

function sampleWorkspace() {
  return {
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
  }
}

function sampleJob(
  status: 'waiting_for_user' | 'completed' | 'running' | 'cancelled',
) {
  return {
    id: 'job_1',
    workspaceId: 'ws_1',
    employeeId: 'saguru',
    request: '構成を調べて',
    jobType: 'research',
    selectedProvider: 'fake',
    selectedModel: null,
    permissionProfile: 'research',
    status,
    providerSessionId: null,
    createdAt: 't',
    startedAt: 't',
    completedAt: status === 'completed' ? 't' : null,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
