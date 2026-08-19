import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createTemporaryGitRepository } from './owned-temp'

test('the garden is the default home screen', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByRole('region', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByTestId('connection-badge')).toContainText(
    'ローカル観測',
  )

  const nav = page.getByRole('navigation', { name: '主要画面' })
  await expect(nav.getByRole('link', { name: '庭' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(nav.getByRole('link', { name: '今日の作業場' })).toBeVisible()
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
  expect(
    Number(await resident.getAttribute('data-ground-x')),
  ).toBeGreaterThanOrEqual(36)
  await resident.getByRole('button').click()
  const inspect = page.getByTestId('garden-inspect')
  await expect(inspect).toContainText('しくみローカル番')
  await expect(inspect).toContainText('どこまでやったか')
  await expect(inspect).toContainText('記録する前の、途中の仕事です')
  await expect(inspect).toContainText('途中の仕事')
  await expect(inspect).not.toContainText('しまっていない変更')
  await expect(inspect).not.toContainText('まだ分かっていません')
  await expect(inspect).not.toContainText('次に動かすまで待つ')
  await expect(inspect).not.toContainText('次はこんな感じか')
  await expect(inspect).not.toContainText('変更元不明の作業')
})

test("a user can move between garden, today's workshop, and settings", async ({
  page,
}) => {
  await page.goto('/#garden')

  await page.getByRole('link', { name: '今日の作業場' }).click()
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

  await page.getByRole('button', { name: '資料棚' }).click()
  await expect(page.getByTestId('garden-inspect')).toContainText('資料棚')
  await expect(page.getByTestId('garden-inspect')).toContainText(
    'この工房の資料を読む場所',
  )
})

test('the garden remains usable on a phone viewport', async ({ page }) => {
  await page.goto('/#garden')

  await expect(page.getByRole('region', { name: '観測の庭' })).toBeInViewport()
  await expect(page.getByRole('navigation', { name: '主要画面' })).toBeVisible()
  await expect(page.getByRole('button', { name: '仕事を頼む' })).toHaveCount(0)

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
})
