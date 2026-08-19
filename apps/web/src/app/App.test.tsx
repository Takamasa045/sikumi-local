import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionToken } from '../api/session'
import { App } from './App'

const fetchMock = vi.fn()

beforeEach(() => {
  window.location.hash = ''
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
    if (isObserverUrl(url)) {
      return observerResponse(url)
    }
    return jsonResponse(
      { error: { code: 'NOT_FOUND', message: 'not found' } },
      404,
    )
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  window.location.hash = ''
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('Shikumi Local garden', () => {
  it('opens the garden as the home screen', async () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Shikumi Local ホーム' })).toHaveAttribute(
      'href',
      '#garden',
    )
    const nav = screen.getByRole('navigation', { name: '主要画面' })
    expect(within(nav).getByRole('link', { name: '庭' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: '今日の作業場' })).toBeVisible()
    expect(within(nav).getByRole('link', { name: '設定' })).toBeVisible()
    expect(screen.queryByText('以前の実行画面')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Legacy Executionを開く' }),
    ).not.toBeInTheDocument()
    expect(await screen.findByText('Repository未登録')).toBeVisible()
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('world-stage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('form', { name: /仕事/ }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('connection-badge')).toHaveTextContent(
        'ローカル観測',
      )
    })
    expect(screen.getByTestId('connection-badge')).not.toHaveTextContent(
      '実行エンジン未接続',
    )
    expect(screen.getByTestId('connection-badge')).not.toHaveTextContent(
      '接続済み',
    )
    expect(screen.getByTestId('default-tool')).toHaveTextContent('ローカル観測')
    expect(
      await screen.findByText(
        '各AIアプリで作業を始めると、観測できたエージェントがここに現れます',
      ),
    ).toBeVisible()
  })

  it('treats the old labs hash as the garden', async () => {
    window.location.hash = '#labs'
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'garden')
    expect(
      within(screen.getByRole('navigation', { name: '主要画面' })).getByRole(
        'link',
        { name: '庭' },
      ),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('shows today\'s workshop without pretending work is running', async () => {
    render(<App />)
    await openTodayWorkshop()

    expect(
      screen.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeVisible()
    expect(screen.getByTestId('connection-badge')).toHaveAttribute(
      'data-status',
      'observing',
    )
    expect(screen.getByTestId('connection-badge')).toHaveTextContent(
      'ローカル観測',
    )
    expect(screen.getByTestId('connection-badge')).not.toHaveTextContent(
      '接続済み',
    )
    expect(screen.queryByText('作業中')).not.toBeInTheDocument()
    expect(await screen.findByText('Repository未登録')).toBeVisible()
    expect(await screen.findByTestId('connection-badge')).toHaveAttribute(
      'data-status',
      'observing',
    )
    expect(await screen.findByTestId('observer-stats')).toBeVisible()
  })

  it('navigates garden, today\'s workshop, and settings as first-class destinations', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('link', { name: '今日の作業場' }))
    expect(
      await screen.findByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeVisible()
    expect(await screen.findByTestId('connection-badge')).toHaveTextContent(
      'ローカル観測',
    )
    expect(screen.getByTestId('connection-badge')).not.toHaveTextContent(
      '実行エンジン未接続',
    )

    await openSettings()
    expect(
      await screen.findByRole('heading', { name: '工房の整え方' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: '以前の実行画面' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Legacy Executionを開く' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Labs')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: '庭' }))
    expect(
      await screen.findByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    await waitFor(() => {
      expect(screen.getByTestId('connection-badge')).toHaveTextContent(
        'ローカル観測',
      )
    })
    expect(screen.getByTestId('connection-badge')).not.toHaveTextContent(
      '実行エンジン未接続',
    )
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).not.toBeInTheDocument()
  })

  it('renders the mocked overview on the observation garden', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
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
      if (url.endsWith('/api/workspaces')) {
        return jsonResponse({ workspaces: [sampleWorkspace()] })
      }
      if (url.endsWith('/api/observer/today')) {
        return jsonResponse({
          overview: {
            generatedAt: '2026-08-18T00:00:00.000Z',
            repositoryCount: 1,
            activeRepositoryCount: 1,
            waitingCount: 0,
            conflictCount: 0,
            repositories: [
              {
                repositoryId: 'repo_1',
                workspaceId: 'ws_1',
                displayName: 'my-project',
                available: true,
                gitAvailable: true,
                summary: 'Codexが作業中',
                changedFileCount: 2,
                lastChangedLabel: '1分前',
                sessions: [
                  {
                    id: 'sess_codex',
                    source: 'codex',
                    displayName: 'Codex',
                    status: 'running',
                    activity: 'working',
                    attributionConfidence: 'observed',
                    title: 'APIを直している',
                    lastObservedAt: '2026-08-18T00:00:00.000Z',
                    lastObservedLabel: '1分前',
                  },
                  {
                    id: 'sess_git',
                    source: 'git',
                    displayName: '変更元不明',
                    status: 'detected',
                    activity: 'unknown',
                    attributionConfidence: 'inferred',
                    title: '変更元不明の作業',
                    lastObservedAt: '2026-08-18T00:00:00.000Z',
                    lastObservedLabel: '2分前',
                  },
                ],
                worktrees: [],
                conflicts: [],
                areas: [],
              },
            ],
          },
        })
      }
      if (isObserverUrl(url)) {
        return observerResponse(url, { displayName: 'my-project' })
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'not found' } },
        404,
      )
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: '観測の庭' })).toBeVisible()
    const agents = await screen.findByRole('list', { name: '観測中のエージェント' })
    expect(within(agents).getByText('APIを直している')).toBeVisible()
    expect(within(agents).getAllByText('Codex').length).toBeGreaterThan(0)
    const unverified = screen.getByRole('list', { name: '出どころ未確認の変更' })
    expect(within(unverified).getByText('my-project')).toBeVisible()
    expect(within(unverified).getByText('2 件')).toBeVisible()
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).not.toBeInTheDocument()
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
        if (isObserverUrl(url)) {
          return observerResponse(url)
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
                employeeName: 'ブログ番',
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

    await openTodayWorkshop()
    await userEvent.type(
      screen.getByLabelText('観測するRepositoryの場所'),
      '/Users/example/my-project',
    )
    await userEvent.click(
      screen.getByRole('button', { name: '観測するRepositoryを追加' }),
    )

    await waitFor(() => {
      expect(screen.getByTestId('workspace-line')).toHaveTextContent(
        'my-project',
      )
    })
    expect(
      screen.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeVisible()
    await openSettings()
    expect(screen.getByText('✓ Git Repository')).toBeVisible()
    expect(screen.getByText('✓ 現在のbranch: main')).toBeVisible()
    await openGarden()
    expect(
      await screen.findByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).not.toBeInTheDocument()
    expect(screen.getByTestId('connection-badge')).toHaveTextContent(
      'ローカル観測',
    )
  })

  it('lists registered repository activity without claiming an AI source', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
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
      if (url.endsWith('/api/workspaces')) {
        return jsonResponse({ workspaces: [sampleWorkspace()] })
      }
      if (isObserverUrl(url)) {
        return observerResponse(url, { displayName: 'my-project' })
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'not found' } },
        404,
      )
    })

    render(<App />)
    await openTodayWorkshop()

    expect(
      await screen.findByText((content) =>
        content.includes('変更元不明の作業があります'),
      ),
    ).toBeVisible()
    expect(screen.getAllByText('変更元不明').length).toBeGreaterThan(0)
    expect(screen.getByText('AIによる作業だと決めてはいません')).toBeVisible()
    expect(screen.queryByText('Codexが変更中')).not.toBeInTheDocument()
  })

  it('never renders job submission or legacy garden chrome even when providers report connected', async () => {
    mockGarden({
      providers: [
        connectedProvider('codex', 'Codex'),
        catalogProviders()[1]!,
        catalogProviders()[2]!,
      ],
      executionConnected: true,
      workspace: { ...sampleWorkspace(), defaultProviderId: 'codex' },
    })
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('form', { name: '仕事を頼む' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '仕事を頼む' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument()
    expect(screen.queryByTestId('world-stage')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: '成果を受け取る' }),
    ).not.toBeInTheDocument()
  })

  it('refreshes the garden from observer SSE after a canonical persisted event', async () => {
    const sources: FakeEventSource[] = []
    class FakeEventSource {
      readonly url: string
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      constructor(url: string) {
        this.url = url
        sources.push(this)
      }
      close() {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)

    let includeObservedSession = false
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
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
      if (url.endsWith('/api/workspaces')) {
        return jsonResponse({ workspaces: [sampleWorkspace()] })
      }
      if (url.endsWith('/api/observer/today')) {
        if (!includeObservedSession) {
          return jsonResponse({
            overview: {
              generatedAt: '2026-08-18T00:00:00.000Z',
              repositoryCount: 0,
              activeRepositoryCount: 0,
              waitingCount: 0,
              conflictCount: 0,
              repositories: [],
            },
          })
        }
        return jsonResponse({
          overview: {
            generatedAt: '2026-08-18T00:00:01.000Z',
            repositoryCount: 1,
            activeRepositoryCount: 1,
            waitingCount: 0,
            conflictCount: 0,
            repositories: [
              {
                repositoryId: 'repo_1',
                workspaceId: 'ws_1',
                displayName: 'my-project',
                available: true,
                gitAvailable: true,
                summary: 'Codexが作業中',
                changedFileCount: 1,
                lastChangedLabel: 'たった今',
                sessions: [
                  {
                    id: 'sess_codex',
                    source: 'codex',
                    displayName: 'Codex',
                    status: 'running',
                    activity: 'working',
                    attributionConfidence: 'observed',
                    title: 'SSEで届いた作業',
                    lastObservedAt: '2026-08-18T00:00:01.000Z',
                    lastObservedLabel: 'たった今',
                  },
                ],
                worktrees: [],
                conflicts: [],
                areas: [],
              },
            ],
          },
        })
      }
      if (isObserverUrl(url)) {
        return observerResponse(url, { displayName: 'my-project' })
      }
      return jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'not found' } },
        404,
      )
    })

    try {
      render(<App />)
      expect(
        await screen.findByText(
          '各AIアプリで作業を始めると、観測できたエージェントがここに現れます',
        ),
      ).toBeVisible()

      await waitFor(() => {
        expect(
          sources.some((source) =>
            source.url.includes('/api/observer/events/stream'),
          ),
        ).toBe(true)
      })
      const stream = sources.find((source) =>
        source.url.includes('/api/observer/events/stream'),
      )
      expect(stream).toBeDefined()

      includeObservedSession = true
      stream!.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            id: 'evt_obs_1',
            jobId: null,
            runId: null,
            type: 'file.changed',
            payload: { path: 'README.md' },
            occurredAt: '2026-08-18T00:00:01.000Z',
          }),
        }),
      )

      expect(await screen.findByText('SSEで届いた作業')).toBeVisible()
    } finally {
      vi.unstubAllGlobals()
    }
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
      if (isObserverUrl(String(input))) {
        return observerResponse(String(input), {
          displayName: 'kept-project',
        })
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
    expect(
      screen.getByRole('heading', { name: '観測の庭' }),
    ).toBeVisible()
    expect(
      await screen.findByRole('list', { name: '出どころ未確認の変更' }),
    ).toBeVisible()
    await openTodayWorkshop()
    expect(await screen.findByTestId('observer-repo-repo_1')).toBeVisible()
    expect(screen.getByText('変更元不明の作業')).toBeVisible()
    expect(
      screen.getByRole('button', { name: '観測するRepositoryを追加' }),
    ).toBeVisible()
  })

  it('keeps an add-repository path after the first workspace exists', async () => {
    const workspaces = [sampleWorkspace()]
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
          return jsonResponse({ workspaces })
        }
        if (url.endsWith('/api/workspaces') && method === 'POST') {
          const created = {
            id: 'ws_2',
            name: 'second-project',
            defaultProviderId: null,
            worldPackId: 'dog-office',
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:00.000Z',
            repository: {
              id: 'repo_2',
              absolutePath: '/Users/example/second-project',
              displayName: 'second-project',
              currentBranch: 'main',
              remoteName: 'origin',
              remoteUrl: 'https://github.com/example/second-project.git',
              readable: true,
            },
          }
          workspaces.push(created)
          return jsonResponse({ workspace: created }, 201)
        }
        if (url.endsWith('/api/observer/today')) {
          return jsonResponse({
            overview: {
              generatedAt: '2026-08-18T00:00:00.000Z',
              repositoryCount: workspaces.length,
              activeRepositoryCount: workspaces.length,
              waitingCount: 0,
              conflictCount: 0,
              repositories: workspaces.map((workspace) => ({
                repositoryId: workspace.repository.id,
                workspaceId: workspace.id,
                displayName: workspace.repository.displayName,
                available: true,
                gitAvailable: true,
                summary: '現在観測中の作業はありません',
                changedFileCount: 0,
                lastChangedLabel: null,
                sessions: [],
                worktrees: [],
                conflicts: [],
                areas: [],
              })),
            },
          })
        }
        if (isObserverUrl(url)) {
          return observerResponse(url)
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        )
      },
    )

    render(<App />)
    await openTodayWorkshop()
    expect(await screen.findByTestId('observer-repo-repo_1')).toBeVisible()
    expect(
      screen.getByRole('button', { name: '観測するRepositoryを追加' }),
    ).toBeVisible()
    await userEvent.type(
      screen.getByLabelText('観測するRepositoryの場所'),
      '/Users/example/second-project',
    )
    await userEvent.click(
      screen.getByRole('button', { name: '観測するRepositoryを追加' }),
    )
    expect(await screen.findByTestId('observer-repo-repo_2')).toBeVisible()
    expect(screen.getByTestId('observer-repo-repo_1')).toBeVisible()
    expect(screen.getByTestId('workspace-line')).toHaveTextContent('my-project')
    expect(screen.getByTestId('workspace-line')).not.toHaveTextContent(
      'second-project',
    )
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

    expect(await screen.findByRole('heading', { name: '観測の庭' })).toBeVisible()
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes('/api/jobs?workspaceId=ws_1'),
        ),
      ).toBe(true)
    })
    expect(screen.queryByRole('button', { name: '仕事を頼む' })).not.toBeInTheDocument()
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

    expect(await screen.findByTestId('approval-panel')).toHaveTextContent(
      'サグル',
    )
    expect(screen.queryByTestId('world-stage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('current-job')).not.toBeInTheDocument()

    window.location.hash = '#employees'
    await userEvent.click(await screen.findByRole('button', { name: /ミル/ }))

    expect(await screen.findByTestId('employee-drawer')).toBeVisible()
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
      screen.getByRole('heading', { name: '観測の庭' }),
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

    await openTodayWorkshop()
    await userEvent.type(
      screen.getByLabelText('観測するRepositoryの場所'),
      '/tmp/not-git',
    )
    await userEvent.click(
      screen.getByRole('button', { name: '観測するRepositoryを追加' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Git Repositoryではありません',
    )
    expect(screen.getByText('Repository未登録')).toBeVisible()
  })










  it('rechecks a provider and refreshes the catalog', async () => {
    let listed = 0
    let probed = 0
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
        if (url.endsWith('/api/providers') && method !== 'POST') {
          listed += 1
          return jsonResponse({
            providers: catalogProviders().map((provider) => ({
              ...provider,
              installed: false,
              authenticated: false,
              status: 'not_installed',
              capabilities: [],
            })),
            executionConnected: false,
            fakeHarness: false,
          })
        }
        if (url.endsWith('/api/providers/codex/probe') && method === 'POST') {
          probed += 1
          return jsonResponse({
            id: 'codex',
            probe: {
              installed: false,
              authenticated: false,
              transport: 'disconnected',
              warnings: [],
              errors: ['codex コマンドが見つかりません'],
            },
          })
        }
        if (url.includes('/api/employees')) {
          return employeePayload()
        }
        if (url.endsWith('/api/workspaces')) {
          return jsonResponse({ workspaces: [] })
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'not found' } },
          404,
        )
      },
    )
    render(<App />)
    await userEvent.click(
      within(
        await screen.findByRole('navigation', { name: '主要画面' }),
      ).getByRole('link', { name: '設定' }),
    )
    expect(await screen.findByTestId('provider-status-panel')).toBeVisible()
    await userEvent.click(screen.getAllByRole('button', { name: '再確認' })[0]!)
    await waitFor(() => {
      expect(probed).toBe(1)
      expect(listed).toBeGreaterThan(1)
    })
  })
})

function mockGarden(input: {
  readonly providers: unknown[]
  readonly executionConnected: boolean
  readonly workspace: {
    readonly id: string
    readonly name: string
    readonly defaultProviderId: 'codex' | 'grok-build' | 'claude-code' | null
    readonly worldPackId: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly repository: ReturnType<typeof sampleWorkspace>['repository']
  }
}) {
  fetchMock.mockImplementation(async (inputUrl: RequestInfo | URL) => {
    const url = String(inputUrl)
    if (url.endsWith('/api/session')) {
      return jsonResponse({ token: 'test-session' })
    }
    if (url.endsWith('/api/health')) {
      return jsonResponse({ ...disconnectedHealth(), liveProviderRuns: true })
    }
    if (url.endsWith('/api/providers')) {
      return jsonResponse({
        providers: input.providers,
        executionConnected: input.executionConnected,
        fakeHarness: false,
      })
    }
    if (url.includes('/api/employees')) {
      return employeePayload()
    }
    if (url.endsWith('/api/workspaces')) {
      return jsonResponse({ workspaces: [input.workspace] })
    }
    if (isObserverUrl(url)) {
      return observerResponse(url, {
        displayName: input.workspace.repository.displayName,
      })
    }
    if (url.includes('/api/jobs')) {
      return jsonResponse({ jobs: [] })
    }
    return jsonResponse(
      { error: { code: 'NOT_FOUND', message: 'not found' } },
      404,
    )
  })
}

function connectedProvider(
  id: 'codex' | 'grok-build' | 'claude-code',
  displayName: string,
) {
  return {
    id,
    displayName,
    executionConnected: true,
    installed: true,
    authenticated: true,
    status: 'ready',
    capabilities: [],
  }
}

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

async function openTodayWorkshop() {
  await userEvent.click(
    within(screen.getByRole('navigation', { name: '主要画面' })).getByRole(
      'link',
      { name: '今日の作業場' },
    ),
  )
}

async function openGarden() {
  await userEvent.click(
    within(screen.getByRole('navigation', { name: '主要画面' })).getByRole(
      'link',
      { name: '庭' },
    ),
  )
}

async function openSettings() {
  await userEvent.click(
    within(screen.getByRole('navigation', { name: '主要画面' })).getByRole(
      'link',
      { name: '設定' },
    ),
  )
}

function isObserverUrl(url: string): boolean {
  return (
    url.includes('/api/observer/') ||
    url.includes('/api/external-sessions') ||
    url.includes('/api/conflicts') ||
    /\/api\/repositories\/[^/]+\/(activity|worktrees|snapshots|rescan)/.test(
      url,
    )
  )
}

function observerResponse(
  url: string,
  options?: { readonly displayName?: string },
) {
  const displayName = options?.displayName ?? 'my-project'
  if (url.endsWith('/api/observer/today')) {
    return jsonResponse({
      overview: {
        generatedAt: '2026-08-18T00:00:00.000Z',
        repositoryCount: options?.displayName ? 1 : 0,
        activeRepositoryCount: options?.displayName ? 1 : 0,
        waitingCount: 0,
        conflictCount: 0,
        repositories: options?.displayName
          ? [
              {
                repositoryId: 'repo_1',
                workspaceId: 'ws_1',
                displayName,
                available: true,
                gitAvailable: true,
                summary: '変更元不明の作業があります。ログイン状態',
                changedFileCount: 1,
                lastChangedLabel: '2分前',
                sessions: [
                  {
                    id: 'sess_git',
                    source: 'git',
                    displayName: '変更元不明',
                    status: 'detected',
                    activity: 'unknown',
                    attributionConfidence: 'inferred',
                    title: '変更元不明の作業',
                    lastObservedAt: '2026-08-18T00:00:00.000Z',
                    lastObservedLabel: '2分前',
                  },
                ],
                worktrees: [],
                conflicts: [],
                areas: ['ログイン状態'],
              },
            ]
          : [],
      },
    })
  }
  if (url.endsWith('/api/observer/adapters')) {
    return jsonResponse({ adapters: [] })
  }
  if (url.includes('/activity') || url.includes('/rescan')) {
    return jsonResponse({
      activity: {
        repositoryId: 'repo_1',
        workspaceId: 'ws_1',
        displayName,
        available: true,
        gitAvailable: true,
        summary: '変更元不明の作業があります。ログイン状態',
        changedFileCount: 1,
        lastChangedLabel: '2分前',
        sessions: [],
        worktrees: [],
        conflicts: [],
        areas: ['ログイン状態'],
      },
    })
  }
  if (url.includes('/api/conflicts')) {
    return jsonResponse({
      conflicts: [],
      counts: { red: 0, orange: 0, yellow: 0 },
    })
  }
  return jsonResponse({ sessions: [], adapters: [], conflicts: [] })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
