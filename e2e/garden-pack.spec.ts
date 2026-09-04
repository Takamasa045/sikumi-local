import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { trackOwnedDirectory } from './owned-temp'

test('a zip world pack becomes a selectable garden look', async ({ page }) => {
  const zipDir = trackOwnedDirectory(
    mkdtempSync(join(tmpdir(), 'sikumi-e2e-pack-')),
  )
  const zipPath = join(zipDir, 'example-garden.zip')
  execFileSync('node', [
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../examples/packs/build-example-garden-zip.mjs',
    ),
    zipPath,
  ])

  await page.goto('/#settings')
  await expect(page.getByTestId('pack-import')).toBeVisible()
  await page.getByLabel('Packの入手元').selectOption('zip')
  await page.getByLabel('Packの場所').fill(zipPath)
  await page.getByRole('button', { name: '確認画面を開く' }).click()
  await expect(page.getByTestId('pack-trust')).toBeVisible()
  await expect(page.getByTestId('pack-trust')).toContainText('example-garden')
  await expect(page.getByTestId('pack-trust')).not.toContainText(
    'まだ分かっていません',
  )
  await page.getByRole('button', { name: 'このPackを導入する' }).click()
  await expect(page.getByTestId('pack-list')).toContainText('example-garden')

  await page.getByRole('link', { name: '庭' }).click()
  const lookToggle = page.getByRole('button', { name: '庭の見た目：里山' })
  await expect(lookToggle).toBeVisible()
  await lookToggle.click()
  const look = page.getByRole('group', { name: '庭を選ぶ' })
  await expect(look.getByRole('button', { name: '里山' })).toBeVisible()
  await expect(look.getByRole('button', { name: '工房' })).toBeVisible()
  await expect(look.getByRole('button', { name: '見本' })).toBeVisible()
  await look.getByRole('button', { name: '見本' }).click()

  const garden = page.getByRole('region', { name: '観測の庭' })
  await expect(garden).toHaveAttribute('data-world-pack', 'example-garden')
  await expect(page.getByText('見本の庭')).toBeVisible()
  await expect(page.getByText('example-garden')).toHaveCount(0)
  await expect(page.getByText('world.yaml')).toHaveCount(0)
  const background = await garden.evaluate((node) => {
    return (node as HTMLElement).style.backgroundImage
  })
  expect(background).toContain(
    '/api/worlds/example-garden/assets/background.png',
  )
})
