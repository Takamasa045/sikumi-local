import { expect, test } from '@playwright/test'

test('a user can inspect both starter gardens', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: '犬たちの里山アトリエ' }),
  ).toBeVisible()
  await expect(page.getByText('まだ仕事は始まっていません')).toBeVisible()

  await page.getByRole('button', { name: '職人工房を表示' }).click()

  await expect(page.getByRole('heading', { name: '職人工房' })).toBeVisible()
  await expect(page.getByTestId('world-stage')).toHaveAttribute(
    'data-world-pack',
    'craft-workshop',
  )
})

test('the garden remains usable on a phone viewport', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: '仕事を頼む' })).toBeDisabled()
  await expect(page.getByRole('navigation', { name: '主要画面' })).toBeVisible()
  await expect(page.getByTestId('world-stage')).toBeInViewport()
})
