import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('growth and pack trust screens are available after a local session starts', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'AI社員' }).click()
  await page.getByRole('button', { name: /サグル/ }).click()
  await expect(page.getByTestId('employee-drawer')).toBeVisible()
  await expect(page.getByTestId('employee-growth')).toBeVisible()
  await page.getByRole('button', { name: '閉じる' }).click()

  await page.goto('/#settings')
  await expect(page.getByTestId('pack-import')).toBeVisible()
  await page
    .getByLabel('Packの場所')
    .fill(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../packages/employee-sdk/fixtures/miru',
      ),
    )
  await page.getByRole('button', { name: '確認画面を開く' }).click()
  await expect(page.getByTestId('pack-trust')).toBeVisible()
  await expect(page.getByTestId('pack-trust')).toContainText('miru')
  await page.getByRole('button', { name: 'このPackを導入する' }).click()
  await expect(page.getByTestId('pack-list')).toContainText('miru')
})
