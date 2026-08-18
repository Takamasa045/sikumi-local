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

test('a garden job can be approved through the fake harness to an artifact', async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository()

  await page.goto('/')
  await page.getByLabel('Repositoryの場所').fill(repositoryPath)
  await page.getByRole('button', { name: 'この工房に登録する' }).click()
  await expect(page.getByTestId('workspace-line')).toContainText(
    basename(repositoryPath),
  )

  await expect(page.getByTestId('workspace-line')).toContainText('テスト実行')
  await expect(page.getByTestId('connection-badge')).toContainText(
    '開発用ハーネス',
  )
  await expect(page.getByTestId('first-run-guide')).toBeVisible()

  const request = page.getByPlaceholder(
    '例：このRepositoryの構成と改善点を調べて',
  )
  await expect(request).toBeEnabled()
  await request.fill('このRepositoryの構成を調べて')
  await expect(page.getByRole('button', { name: '仕事を頼む' })).toBeEnabled()
  await page.getByRole('button', { name: '仕事を頼む' }).click()

  await expect(page.getByTestId('approval-panel')).toContainText(
    '外部サイトへアクセスします',
  )
  await page.getByRole('button', { name: '許可' }).click()

  await expect(page.getByTestId('artifact-shelf')).toContainText('調査メモ', {
    timeout: 15_000,
  })
  await expect(
    page.getByTestId('world-stage').getByText('調査が完了しました'),
  ).toBeVisible({ timeout: 15_000 })

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: '内容を見る' }).click()
  await expect(page.getByTestId('artifact-viewer')).toBeVisible()
  await expect(page.getByTestId('artifact-viewer-body')).toContainText(
    'このRepositoryの構成を整理しました',
  )
  await page.getByRole('button', { name: 'コピー' }).click()
  await expect(page.getByText('コピーしました')).toBeAttached()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('artifact-viewer')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '現在のbranchへ適用' }),
  ).toHaveCount(0)
})

function createTemporaryGitRepository(): string {
  const directory = track(mkdtempSync(join(tmpdir(), 'sikumi-e2e-job-')))
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
