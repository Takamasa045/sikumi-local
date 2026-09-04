import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createTemporaryGitRepository } from './owned-temp'

test('the garden is the default home screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByRole('region', { name: '観測の庭' })).toBeVisible()
  const look = page.getByRole('group', { name: '庭の様子' })
  await expect(look.getByRole('button', { name: '里山' })).toBeVisible()
  await expect(look.getByRole('button', { name: '工房' })).toBeVisible()
  await expect(page.getByText('dog-office')).toHaveCount(0)
  await expect(page.getByTestId('connection-badge')).toContainText(
    'ローカル観測',
  )

  const nav = page.getByRole('navigation', { name: '主要画面' })
  await expect(nav.getByRole('link', { name: '庭' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(nav.getByRole('link', { name: '管制所' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '場所' })).toBeVisible()
  await expect(nav.getByRole('link', { name: '今日の作業場' })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: '設定' })).toHaveCount(0)
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: '設定' }),
  ).toBeVisible()
  await expect(page.getByRole('form', { name: '仕事を頼む' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '仕事を頼む' })).toHaveCount(0)
  await expect(page.getByTestId('world-stage')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '○○番の一覧' })).toHaveCount(0)
  await expect(page.getByTestId('garden-employee')).toHaveCount(0)
  await expect(
    page.getByText(
      '登録した場所がまだありません。今日の作業場からフォルダを追加してください。',
    ),
  ).toBeVisible()
})

test('the garden shows registered places as characters, not a list', async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository('sikumi-e2e-garden-')
  writeFileSync(
    join(repositoryPath, 'README.md'),
    ['# しくみローカル', '', '庭と作業場を見守るための場所です。', ''].join(
      '\n',
    ),
  )
  execFileSync('git', ['add', 'README.md'], { cwd: repositoryPath })
  execFileSync('git', ['commit', '-m', '庭のクリック詳細を厚くする'], {
    cwd: repositoryPath,
  })
  writeFileSync(join(repositoryPath, 'uncommitted.txt'), 'uncommitted change\n')

  await page.goto('/#observer')
  await page.getByLabel('場所のパス').fill(repositoryPath)
  await page.getByRole('button', { name: 'この場所を追加' }).click()
  await expect(
    page.getByText(basename(repositoryPath), { exact: false }).first(),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: '○○番の一覧' })).toBeVisible()
  await expect(page.getByText('しくみローカル番').first()).toBeVisible()

  await page.getByRole('link', { name: '庭' }).click()

  await expect(page.getByRole('region', { name: '○○番の一覧' })).toHaveCount(0)
  await expect(page.getByRole('list', { name: '庭の住人' })).toBeVisible()
  await expect(page.getByText('しくみローカル番').first()).toBeVisible()
  await expect(page.getByText('まだ分かっていません')).toHaveCount(0)
  await expect(page.getByTestId('garden-employee')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: '出どころ未確認の変更' }),
  ).toHaveCount(0)
  await expect(page.getByText('変更元不明の作業')).toHaveCount(0)
  await expect(page.getByRole('form', { name: '仕事を頼む' })).toHaveCount(0)

  const resident = page
    .getByRole('list', { name: '庭の住人' })
    .getByRole('listitem')
  await expect(resident).not.toHaveAttribute('data-station', 'observatory')
  await expect(resident).not.toHaveAttribute('data-station', 'archive')
  await expect(resident).toHaveAttribute('data-station', 'rest')
  expect(
    Number(await resident.getAttribute('data-ground-x')),
  ).toBeLessThanOrEqual(28)
  await resident.getByRole('button').click()
  const inspect = page.getByTestId('garden-inspect')
  await expect(inspect).toContainText('しくみローカル番')
  await expect(inspect).toContainText('いま何をしているか')
  await expect(inspect).toContainText('次はどうするか')
  await expect(inspect).toContainText('この場所は何の仕事か')
  await expect(inspect).toContainText('これまでの仕事')
  await expect(inspect).toContainText('庭と作業場を見守るための場所です。')
  await expect(inspect).toContainText('庭のクリック詳細を厚くする')
  await expect(inspect).toContainText('途中の仕事を続ける')
  await expect(inspect).not.toContainText('どこまでやったか')
  await expect(inspect).not.toContainText('縁側')
  await expect(inspect).toContainText(/途中の仕事が残って|の途中が残っています/)
  await expect(inspect).not.toContainText('記録する前の、途中の仕事です')
  await expect(inspect).not.toContainText('uncommitted.txt')
  await expect(inspect).not.toContainText('しまっていない変更')
  await expect(inspect).not.toContainText('まだ分かっていません')
  await expect(inspect).not.toContainText('次に動かすまで待つ')
  await expect(inspect).not.toContainText('次はこんな感じか')
  await expect(inspect).not.toContainText('変更元不明の作業')
  await expect(inspect).not.toContainText('README.md')
  await expect(inspect.getByRole('link', { name: 'Codexで開く' })).toHaveCount(
    0,
  )
})

test('a Codex garden character can open the installed app for that task', async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository('sikumi-e2e-codex-open-')
  const threadId = '0193c0de-5a11-7abc-9def-0123456789ab'
  await page.goto('/#observer')
  await page.getByLabel('場所のパス').fill(repositoryPath)
  await page.getByRole('button', { name: 'この場所を追加' }).click()
  await expect(
    page.getByText(basename(repositoryPath), { exact: false }).first(),
  ).toBeVisible()

  const token = await page.evaluate(async () => {
    const response = await fetch('/api/session', { credentials: 'include' })
    const body = (await response.json()) as { token: string }
    return body.token
  })
  const origin = new URL(page.url()).origin
  const started = await page.request.post('/api/observer/events', {
    headers: {
      'content-type': 'application/json',
      origin,
      'x-csrf-token': token,
    },
    data: {
      source: 'codex',
      nativeEventType: 'SessionStart',
      session_id: threadId,
      cwd: repositoryPath,
      worktreePath: repositoryPath,
      occurredAt: new Date().toISOString(),
    },
  })
  expect(started.ok(), await started.text()).toBeTruthy()

  await page.getByRole('link', { name: '庭' }).click()
  const resident = page
    .getByRole('list', { name: '庭の住人' })
    .getByRole('listitem')
  await resident.getByRole('button').click()
  await expect(page).toHaveURL(/#garden|#observer|^[^#]*\/?$/)
  const inspect = page.getByTestId('garden-inspect')
  await expect(inspect).toBeVisible()
  const launch = inspect.getByRole('link', { name: 'Codexで開く' })
  await expect(launch).toHaveAttribute('href', `codex://threads/${threadId}`)
  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
})

test("a user can move between garden, today's workshop, and settings", async ({
  page,
}) => {
  await page.goto('/#garden')

  await page.getByRole('link', { name: '管制所' }).click()
  await expect(page.getByRole('heading', { name: 'いまの様子' })).toBeVisible()

  await page.getByRole('link', { name: '場所' }).click()
  await expect(
    page.getByRole('heading', { name: '登録した場所' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: '○○番の一覧' })).toBeVisible()

  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: '設定' })
    .click()
  await expect(
    page.getByRole('heading', { name: '工房の整え方' }),
  ).toBeVisible()

  await page.getByRole('link', { name: '庭' }).click()
  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByRole('region', { name: '○○番の一覧' })).toHaveCount(0)
})

test('a user can click a garden station to see what is happening', async ({
  page,
}) => {
  await page.goto('/#garden')

  await expect(page.getByRole('region', { name: '○○番の一覧' })).toHaveCount(0)
  await expect(page.getByTestId('garden-employee')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '登録した場所' })).toHaveCount(
    0,
  )

  await page.getByRole('button', { name: '仕事' }).click()
  await expect(page.getByTestId('garden-inspect')).toContainText('仕事')
  await expect(page.getByTestId('garden-inspect')).toContainText(
    '動いている仕事がいる場所',
  )
  await expect(page.getByTestId('garden-inspect')).not.toContainText('資料棚')
  await expect(page.getByTestId('garden-inspect')).not.toContainText('作業台')
  await expect(page.getByTestId('garden-inspect')).not.toContainText('縁側')
})

test('the garden remains usable on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#garden')

  await expect(page.getByRole('region', { name: '観測の庭' })).toBeInViewport()
  await expect(page.getByRole('navigation', { name: '主要画面' })).toBeVisible()
  await expect(page.getByRole('button', { name: '仕事を頼む' })).toHaveCount(0)
  const look = page.getByRole('group', { name: '庭の様子' })
  await expect(look.getByRole('button', { name: '里山' })).toBeVisible()
  await expect(look.getByRole('button', { name: '工房' })).toBeVisible()
  await expect(look.getByRole('button', { name: '里山' })).toBeEnabled()
  await expect(look.getByRole('button', { name: '工房' })).toBeEnabled()
  await expect(page.getByText('dog-office')).toHaveCount(0)
  await expect(page.getByText('worldPackId')).toHaveCount(0)

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
})
