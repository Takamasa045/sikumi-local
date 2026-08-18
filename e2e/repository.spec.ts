import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from '@playwright/test'

const temporaryDirectories: string[] = []

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a non-git path is rejected from the garden form', async ({ page }) => {
  const directory = track(mkdtempSync(join(tmpdir(), 'sikumi-e2e-not-git-')))

  await page.goto('/')
  await page.getByLabel('Repositoryの場所').fill(directory)
  await page.getByRole('button', { name: 'この工房に登録する' }).click()

  await expect(page.getByRole('alert')).toContainText(
    'Git Repositoryではありません',
  )
  await expect(
    page.getByRole('heading', { name: '犬たちの里山アトリエ' }),
  ).toBeVisible()
})

test('a user can register a local git repository without leaving the garden', async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository()

  await page.goto('/')
  await page.getByLabel('Repositoryの場所').fill(repositoryPath)
  await page.getByRole('button', { name: 'この工房に登録する' }).click()

  await expect(page.getByTestId('workspace-line')).toContainText(
    basename(repositoryPath),
  )
  await expect(page.getByText('✓ Git Repository')).toBeVisible()
  await expect(page.getByText(/現在のbranch:/)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '犬たちの里山アトリエ' }),
  ).toBeVisible()
  await expect(
    page.getByPlaceholder('例：このRepositoryの構成と改善点を調べて'),
  ).toBeEnabled()
})

function createTemporaryGitRepository(): string {
  const directory = track(mkdtempSync(join(tmpdir(), 'sikumi-e2e-git-')))
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'e2e'], { cwd: directory })
  writeFileSync(join(directory, 'README.md'), '# e2e\n')
  execFileSync('git', ['add', 'README.md'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory })
  return directory
}

function track(directory: string): string {
  temporaryDirectories.push(directory)
  return directory
}
