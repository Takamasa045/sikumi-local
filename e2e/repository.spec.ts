import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createTemporaryGitRepository,
  trackOwnedDirectory,
} from './owned-temp'

test.describe.configure({ mode: 'serial' })

test('a non-git path is rejected from the garden form', async ({ page }) => {
  const directory = trackOwnedDirectory(
    mkdtempSync(join(tmpdir(), 'sikumi-e2e-not-git-')),
  )

  await page.goto('/#observer')
  await page.getByLabel('場所のパス').fill(directory)
  await page.getByRole('button', { name: 'この場所を追加' }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Git Repositoryではありません',
  )
  await expect(
    page.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
  ).toBeVisible()
})

test("a user can register a local git repository from today's workshop", async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository('sikumi-e2e-git-')

  await page.goto('/#observer')
  await expect(page.getByRole('button', { name: 'フォルダを選ぶ' })).toBeVisible()
  await page.getByLabel('場所のパス').fill(repositoryPath)
  await page.getByRole('button', { name: 'この場所を追加' }).click()

  await expect(
    page.getByText(basename(repositoryPath), { exact: false }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
  ).toBeVisible()
  await expect(page.getByTestId('observer-stats')).toBeVisible()
})

test("a user can register a second repository from today's workshop", async ({
  page,
}) => {
  const first = createTemporaryGitRepository('sikumi-e2e-git-')
  const second = createTemporaryGitRepository('sikumi-e2e-git-')

  await page.goto('/#observer')
  await page.getByLabel('場所のパス').fill(first)
  await page.getByRole('button', { name: 'この場所を追加' }).click()
  await expect(
    page.getByText(basename(first), { exact: false }).first(),
  ).toBeVisible()

  await page.getByLabel('場所のパス').fill(second)
  await page.getByRole('button', { name: 'この場所を追加' }).click()

  await expect(page.getByTestId('observer-stats')).toContainText('件の場所')
  await expect(
    page.getByText(basename(first), { exact: false }).first(),
  ).toBeVisible()
  await expect(
    page.getByText(basename(second), { exact: false }).first(),
  ).toBeVisible()
  await expect(page.getByTestId('workspace-line')).not.toContainText(
    basename(second),
  )
})

test('a user can unregister a place without deleting the folder', async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository('sikumi-e2e-unreg-')

  await page.goto('/#observer')
  await page.getByLabel('場所のパス').fill(repositoryPath)
  await page.getByRole('button', { name: 'この場所を追加' }).click()
  await expect(
    page.getByText(basename(repositoryPath), { exact: false }).first(),
  ).toBeVisible()

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('フォルダ自体は残ります')
    void dialog.accept()
  })
  await page.getByRole('button', { name: 'この場所を外す' }).click()

  await expect(
    page.getByText(basename(repositoryPath), { exact: false }),
  ).toHaveCount(0)
  await expect(page.getByText('場所はまだありません')).toBeVisible()
  expect(existsSync(repositoryPath)).toBe(true)
  expect(existsSync(join(repositoryPath, '.git'))).toBe(true)

  await page.getByRole('link', { name: '庭' }).click()
  await expect(page.getByRole('list', { name: '庭の住人' })).toHaveCount(0)
})
