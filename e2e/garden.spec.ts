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
  await expect(nav.getByRole('link', { name: '設定' })).toBeVisible()
  await expect(page.getByRole('form', { name: '仕事を頼む' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '仕事を頼む' })).toHaveCount(0)
  await expect(page.getByTestId('world-stage')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '○○番の一覧' })).toBeVisible()
  await expect(page.getByTestId('garden-employee')).toHaveCount(0)
})

test('the garden shows real current Git-only data', async ({ page }) => {
  const repositoryPath = createTemporaryGitRepository('sikumi-e2e-garden-')
  writeFileSync(join(repositoryPath, 'uncommitted.txt'), 'uncommitted change\n')

  await page.goto('/#observer')
  await page.getByLabel('観測するRepositoryの場所').fill(repositoryPath)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()
  await expect(
    page.getByText(basename(repositoryPath), { exact: false }).first(),
  ).toBeVisible()

  await page.getByRole('link', { name: '庭' }).click()

  await expect(page.getByRole('region', { name: '○○番の一覧' })).toBeVisible()
  await expect(
    page.getByText(`${basename(repositoryPath)}番`, { exact: false }).first(),
  ).toBeVisible()
  await expect(page.getByTestId('garden-employee')).toHaveCount(0)

  await expect(
    page.getByRole('heading', { name: '出どころ未確認の変更' }),
  ).toBeVisible()
  const unattributed = page.getByRole('list', {
    name: '出どころ未確認の変更',
  })
  await expect(unattributed).toBeVisible()
  await expect(unattributed).toContainText(basename(repositoryPath))
  const observedAgents = page.getByRole('list', {
    name: '観測中のエージェント',
  })
  if ((await observedAgents.count()) > 0) {
    await expect(observedAgents).not.toContainText(basename(repositoryPath))
  }
})

test("a user can move between garden, today's workshop, and settings", async ({
  page,
}) => {
  await page.goto('/#garden')

  await page.getByRole('link', { name: '今日の作業場' }).click()
  await expect(
    page.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
  ).toBeVisible()

  await page.getByRole('link', { name: '設定' }).click()
  await expect(
    page.getByRole('heading', { name: '工房の整え方' }),
  ).toBeVisible()

  await page.getByRole('link', { name: '庭' }).click()
  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
})

test('a user can click a garden station to see what is happening', async ({
  page,
}) => {
  await page.goto('/#garden')

  await expect(page.getByRole('region', { name: '○○番の一覧' })).toBeVisible()
  await expect(page.getByTestId('garden-employee')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
  ).toHaveCount(0)

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
