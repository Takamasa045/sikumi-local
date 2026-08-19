import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createTemporaryGitRepository,
  trackOwnedDirectory,
} from './owned-temp'

test.describe.configure({ mode: 'serial' })

test('observer e2e covers adapters, git-only unknown, conflicts, persistence, and garden', async ({
  page,
}) => {
  const first = createTemporaryGitRepository('sikumi-e2e-observer-alpha-')
  const second = createTemporaryGitRepository('sikumi-e2e-observer-beta-')
  mkdirSync(join(first, 'src'), { recursive: true })
  writeFileSync(join(first, 'src/users.ts'), 'export const users = 1\n')
  execFileSync('git', ['add', 'src/users.ts'], { cwd: first })
  execFileSync('git', ['commit', '-m', 'users'], { cwd: first })
  const worktree = join(
    trackOwnedDirectory(mkdtempSync(join(tmpdir(), 'sikumi-e2e-wt-'))),
    'wt',
  )
  execFileSync('git', ['worktree', 'add', '-b', 'feature', worktree], {
    cwd: first,
  })
  writeFileSync(join(first, 'src/users.ts'), 'export const users = 2\n')
  writeFileSync(join(worktree, 'src/users.ts'), 'export const users = 3\n')
  mkdirSync(join(first, 'src/db/schema'), { recursive: true })
  mkdirSync(join(worktree, 'src/api'), { recursive: true })
  writeFileSync(join(first, 'src/db/schema/users.ts'), 'export const schema = 1\n')
  writeFileSync(join(worktree, 'src/api/users.ts'), 'export const api = 1\n')

  await page.goto('/#observer')
  await page.getByLabel('観測するRepositoryの場所').fill(first)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()
  await expect(page.getByText(basename(first), { exact: false }).first()).toBeVisible()

  await page.getByLabel('観測するRepositoryの場所').fill(second)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()
  await expect(page.getByText(basename(second), { exact: false }).first()).toBeVisible()
  await expect(page.getByTestId('observer-stats')).toBeVisible()
  await expect(page.getByText('変更元不明', { exact: false }).first()).toBeVisible()

  await page.getByRole('link', { name: '設定' }).click()
  await expect(page.getByTestId('observer-adapters')).toBeVisible()
  for (const source of ['codex', 'cursor', 'grok-build', 'claude-code', 'claude-desktop']) {
    await expect(page.getByTestId(`observer-adapter-${source}`)).toBeVisible()
  }
  await expect(
    page.getByRole('link', { name: 'Legacy Executionを開く' }),
  ).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '主要画面' }).getByRole('link', { name: '庭' })).toBeVisible()

  const repositoryId = await registerThenIngest(page, first, worktree)

  await page.goto('/#observer')
  await expect(page.getByTestId('observer-conflict-warning')).toBeVisible()
  await page.getByRole('button', { name: '衝突の一覧を見る' }).click()
  await expect(page.getByTestId('conflict-counts')).toBeVisible()
  await page.getByLabel('AIアプリ').selectOption('codex')
  await page.getByLabel('危険度').selectOption('high')
  await page.getByText('未確認のみ').click()
  await page.getByLabel('危険度').selectOption('')
  await expect(page.getByRole('button', { name: '詳しく見る' }).first()).toBeVisible()
  await page.getByRole('button', { name: '詳しく見る' }).first().click()
  await expect(page.getByRole('button', { name: '確認した' })).toBeVisible()
  await page.getByRole('button', { name: '確認した' }).click()
  await page.getByRole('button', { name: 'いまの状態を確認' }).click()

  await page.reload()
  await page.goto('/#conflicts')
  await expect(page.getByTestId('conflict-counts')).toBeVisible()

  await page.goto('/#settings')
  await expect(page.getByTestId('observer-adapters')).toBeVisible()
  await page.getByRole('link', { name: '庭' }).click()
  await expect(page.locator('#garden')).toBeVisible()

  expect(repositoryId).toBeTruthy()
})

async function registerThenIngest(
  page: import('@playwright/test').Page,
  repo: string,
  worktree: string,
): Promise<string> {
  const token = await page.evaluate(async () => {
    const response = await fetch('/api/session', { credentials: 'include' })
    const body = (await response.json()) as { token: string }
    return body.token
  })
  const workspaces = await page.request.get('/api/workspaces')
  const listed = (await workspaces.json()) as {
    workspaces: Array<{ repository: { id: string; absolutePath: string; displayName: string } }>
  }
  const repositoryId =
    listed.workspaces.find((item) => item.repository.absolutePath.includes(basename(repo)))
      ?.repository.id ?? listed.workspaces[0]?.repository.id
  if (!repositoryId) {
    throw new Error('registered repository was not found')
  }

  const runId = randomBytes(8).toString('hex')
  const stamp = Date.now()
  const invalid = await page.request.post('/api/observer/events', {
    headers: {
      'content-type': 'application/json',
      origin: new URL(page.url()).origin,
      'x-csrf-token': token,
    },
    data: { source: 'not-a-source' },
  })
  expect(invalid.ok()).toBeFalsy()

  await postEvent(page, token, {
    source: 'codex',
    nativeEventType: 'SessionStart',
    session_id: `e2e-codex-${runId}`,
    cwd: repo,
    worktreePath: repo,
    file_path: 'src/users.ts',
    occurredAt: new Date(stamp).toISOString(),
  })
  await postEvent(page, token, {
    source: 'cursor',
    nativeEventType: 'sessionStart',
    session_id: `e2e-cursor-${runId}`,
    cwd: worktree,
    worktreePath: worktree,
    file_path: 'src/users.ts',
    occurredAt: new Date(stamp + 1_000).toISOString(),
  })
  await postEvent(page, token, {
    source: 'claude-code',
    nativeEventType: 'SessionStart',
    session_id: `e2e-claude-${runId}`,
    cwd: repo,
    occurredAt: new Date(stamp + 2_000).toISOString(),
  })
  await postEvent(page, token, {
    source: 'grok-build',
    nativeEventType: 'SessionStart',
    session_id: `e2e-grok-${runId}`,
    cwd: repo,
    occurredAt: new Date(stamp + 3_000).toISOString(),
  })
  const desktopSessionId = `cd_${runId}${runId}`
  await postEvent(page, token, {
    source: 'claude-desktop',
    type: 'sikumi.begin_work',
    sessionId: desktopSessionId,
    cwd: repo,
    occurredAt: new Date(stamp + 4_000).toISOString(),
  })
  await postEvent(page, token, {
    source: 'claude-desktop',
    type: 'sikumi.complete_work',
    sessionId: desktopSessionId,
    cwd: repo,
    occurredAt: new Date(stamp + 5_000).toISOString(),
  })
  writeFileSync(join(repo, 'src/recovered.ts'), 'export const recovered = 1\n')
  const rescan = await page.request.post(`/api/repositories/${repositoryId}/rescan`, {
    headers: {
      origin: new URL(page.url()).origin,
      'x-csrf-token': token,
    },
  })
  expect(rescan.ok(), await rescan.text()).toBeTruthy()
  const activity = (await rescan.json()) as {
    activity?: { changedFileCount?: number }
  }
  expect(activity.activity?.changedFileCount ?? 0).toBeGreaterThan(0)
  return repositoryId
}

async function postEvent(
  page: import('@playwright/test').Page,
  token: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await page.request.post('/api/observer/events', {
    headers: {
      'content-type': 'application/json',
      origin: new URL(page.url()).origin,
      'x-csrf-token': token,
    },
    data: payload,
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}
