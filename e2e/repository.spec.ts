import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createTemporaryGitRepository, trackOwnedDirectory } from './owned-temp'

test.describe.configure({ mode: 'serial' })

test('a non-git path is rejected from the garden form', async ({ page }) => {
  const directory = trackOwnedDirectory(
    mkdtempSync(join(tmpdir(), 'sikumi-e2e-not-git-')),
  )

  await page.goto('/#observer')
  await page.getByLabel('観測するRepositoryの場所').fill(directory)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()

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
  await page.getByLabel('観測するRepositoryの場所').fill(repositoryPath)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()

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
  await page.getByLabel('観測するRepositoryの場所').fill(first)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()
  await expect(
    page.getByText(basename(first), { exact: false }).first(),
  ).toBeVisible()

  await page.getByLabel('観測するRepositoryの場所').fill(second)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()

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
