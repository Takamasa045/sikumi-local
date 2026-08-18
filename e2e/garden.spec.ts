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

test('narrow gardens keep 資料棚 and 納品台 plaques off the heading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '犬たちの里山アトリエ' }),
  ).toBeVisible()
  await expect(page.getByTestId('garden-where')).toBeVisible()
  await expect(
    page.locator('.garden-station[data-station="archive"]'),
  ).toHaveCSS('position', 'static')
  const headingBox = await page
    .getByRole('heading', { name: '犬たちの里山アトリエ' })
    .boundingBox()
  const descriptionBox = await page
    .locator('.world-stage__heading > span')
    .boundingBox()
  expect(headingBox).not.toBeNull()
  expect(descriptionBox).not.toBeNull()
  for (const station of ['archive', 'delivery'] as const) {
    const plaque = page.locator(`.garden-station[data-station="${station}"]`)
    const box = await plaque.boundingBox()
    expect(box, `${station} plaque should stay visible`).not.toBeNull()
    expect(
      boxesOverlap(box, headingBox),
      `${station} plaque should not overlap the World heading`,
    ).toBe(false)
    expect(
      boxesOverlap(box, descriptionBox),
      `${station} plaque should not overlap the World description`,
    ).toBe(false)
    expect(
      box && headingBox && box.y >= headingBox.y + headingBox.height,
      `${station} plaque should sit below the World heading`,
    ).toBe(true)
  }
  await expect(page.getByTestId('garden-where')).toContainText('縁側')
  await expect(
    page.locator('.garden-station[data-station="archive"]'),
  ).toContainText('資料棚')
  await expect(
    page.locator('.garden-station[data-station="delivery"]'),
  ).toContainText('納品台')

  const noteBox = await page.locator('.employee__note').boundingBox()
  expect(noteBox, 'employee note should stay visible').not.toBeNull()
  expect(headingBox?.height ?? 99).toBeLessThan(40)
  expect(
    boxesOverlap(noteBox, headingBox),
    'employee note should not overlap the World heading',
  ).toBe(false)
  expect(
    boxesOverlap(noteBox, descriptionBox),
    'employee note should not overlap the World description',
  ).toBe(false)
})

function boxesOverlap(
  left: { x: number; y: number; width: number; height: number } | null,
  right: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!left || !right) {
    return false
  }
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}
