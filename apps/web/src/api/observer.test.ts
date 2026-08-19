import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSessionToken } from './session.js'
import {
  acknowledgeConflict,
  applyObserverAdapterAction,
  checkObserverAdapter,
  getConflict,
  getRepositoryActivity,
  getTodayOverview,
  listConflicts,
  listObserverAdapters,
  previewObserverAdapterAction,
  recheckConflict,
  rescanRepository,
  resolveConflict,
} from './observer.js'

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('observer API clients', () => {
  it('reads today, repository activity, adapters, and conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/session')) {
          return json({ token: 'boot-session-token' })
        }
        if (url.endsWith('/api/observer/today')) {
          return json({ overview: sampleOverview() })
        }
        if (url.endsWith('/api/repositories/repo_1/activity')) {
          return json({ activity: sampleActivity() })
        }
        if (
          url.endsWith('/api/repositories/repo_1/rescan') &&
          method === 'POST'
        ) {
          return json({ activity: { ...sampleActivity(), truncated: true } })
        }
        if (url.endsWith('/api/observer/adapters')) {
          return json({ adapters: [sampleAdapter()] })
        }
        if (
          url.endsWith('/api/observer/adapters/codex/check') &&
          method === 'POST'
        ) {
          return json({ adapter: { ...sampleAdapter(), enabled: true } })
        }
        if (
          url.endsWith('/api/observer/adapters/codex/install') &&
          method === 'POST'
        ) {
          const body = String(init?.body ?? '')
          if (body.includes('"confirm":false')) {
            return json({
              result: {
                ok: true,
                changed: false,
                message: 'preview',
                requiresConfirm: true,
                confirmationToken: 'tok',
                planDigest: 'dig',
              },
            })
          }
          return json({
            result: {
              ok: true,
              changed: true,
              message: 'applied',
              applied: true,
            },
          })
        }
        if (url.includes('/api/conflicts?') || url.endsWith('/api/conflicts')) {
          return json({
            conflicts: [sampleConflict()],
            counts: { red: 1, orange: 0, yellow: 0 },
          })
        }
        if (url.includes('/api/conflicts/cnf_1?mode=')) {
          return json({ conflict: sampleConflict() })
        }
        if (url.endsWith('/api/conflicts/cnf_1/acknowledge')) {
          return json({ conflict: { ...sampleConflict(), status: 'acked' } })
        }
        if (url.endsWith('/api/conflicts/cnf_1/resolve')) {
          return json({
            conflict: { ...sampleConflict(), status: 'resolved' },
          })
        }
        if (url.endsWith('/api/conflicts/cnf_1/recheck')) {
          return json({ conflict: sampleConflict() })
        }
        return json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404)
      }),
    )

    await expect(getTodayOverview()).resolves.toMatchObject({
      repositoryCount: 1,
    })
    await expect(getRepositoryActivity('repo_1')).resolves.toMatchObject({
      displayName: 'demo',
    })
    await expect(rescanRepository('repo_1')).resolves.toMatchObject({
      truncated: true,
    })
    await expect(listObserverAdapters()).resolves.toMatchObject([
      { source: 'codex' },
    ])
    await expect(checkObserverAdapter('codex')).resolves.toMatchObject({
      enabled: true,
    })
    await expect(
      previewObserverAdapterAction('codex', 'install', { scope: 'user' }),
    ).resolves.toMatchObject({ requiresConfirm: true })
    await expect(
      applyObserverAdapterAction('codex', 'install', {
        confirmationToken: 'tok',
        planDigest: 'dig',
        scope: 'repo',
        repositoryId: 'repo_1',
      }),
    ).resolves.toMatchObject({ applied: true })
    await expect(
      listConflicts({
        repositoryId: 'repo_1',
        source: 'codex',
        level: 'high',
        unconfirmed: true,
        mode: 'detail',
      }),
    ).resolves.toMatchObject({ counts: { red: 1 } })
    await expect(getConflict('cnf_1', 'detail')).resolves.toMatchObject({
      id: 'cnf_1',
    })
    await expect(acknowledgeConflict('cnf_1')).resolves.toMatchObject({
      status: 'acked',
    })
    await expect(resolveConflict('cnf_1')).resolves.toMatchObject({
      status: 'resolved',
    })
    await expect(recheckConflict('cnf_1')).resolves.toMatchObject({
      id: 'cnf_1',
    })
  })

  it('surfaces observer API failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/session')) {
          return json({ token: 'boot-session-token' })
        }
        return json({ error: { code: 'NOT_FOUND', message: 'missing' } }, 404)
      }),
    )

    await expect(getTodayOverview()).rejects.toBeInstanceOf(Error)
    await expect(getRepositoryActivity('x')).rejects.toBeInstanceOf(Error)
    await expect(rescanRepository('x')).rejects.toBeInstanceOf(Error)
    await expect(listObserverAdapters()).rejects.toBeInstanceOf(Error)
    await expect(checkObserverAdapter('x')).rejects.toBeInstanceOf(Error)
    await expect(
      previewObserverAdapterAction('x', 'uninstall'),
    ).rejects.toBeInstanceOf(Error)
    await expect(
      applyObserverAdapterAction('x', 'uninstall', {}),
    ).rejects.toBeInstanceOf(Error)
    await expect(listConflicts()).rejects.toBeInstanceOf(Error)
    await expect(getConflict('x')).rejects.toBeInstanceOf(Error)
    await expect(acknowledgeConflict('x')).rejects.toBeInstanceOf(Error)
  })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sampleOverview() {
  return {
    generatedAt: '2026-08-19T00:00:00.000Z',
    repositoryCount: 1,
    activeRepositoryCount: 1,
    waitingCount: 0,
    conflictCount: 1,
    repositories: [sampleActivity()],
  }
}

function sampleActivity() {
  return {
    repositoryId: 'repo_1',
    workspaceId: 'ws_1',
    displayName: 'demo',
    available: true,
    gitAvailable: true,
    summary: '作業があります',
    changedFileCount: 1,
    lastChangedLabel: '1分前',
    sessions: [],
    worktrees: [],
    conflicts: [],
    areas: [],
  }
}

function sampleAdapter() {
  return {
    id: 'codex',
    source: 'codex',
    displayName: 'Codex',
    enabled: false,
    installationStatus: 'not_installed',
    lastEventAt: null,
    health: {
      ok: false,
      status: 'not_installed',
      warnings: [],
      errors: ['未導入'],
    },
  }
}

function sampleConflict() {
  return {
    id: 'cnf_1',
    repositoryId: 'repo_1',
    repositoryDisplayName: 'demo',
    leftSource: 'codex',
    rightSource: 'cursor',
    level: 'high',
    score: 80,
    summary: '同じファイルを変更しています',
    status: 'open',
  }
}
