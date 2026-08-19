import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const outputDir = 'tmp/visual-qa'

test.describe('garden visual QA', () => {
  test('captures desktop, mobile, and reduced-motion garden frames', async ({
    page,
  }, testInfo) => {
    mkdirSync(outputDir, { recursive: true })
    const suffix = testInfo.project.name
    await page.goto('/#garden')
    await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
    await expect(page.getByRole('button', { name: '仕事を頼む' })).toHaveCount(
      0,
    )
    await expect(page.getByTestId('world-stage')).toHaveCount(0)
    await page.screenshot({
      path: `${outputDir}/${suffix}-garden.png`,
      fullPage: true,
    })

    await page.getByRole('link', { name: '今日の作業場' }).click()
    await expect(
      page.getByRole('heading', { name: 'いま何が、どこで起きているか' }),
    ).toBeVisible()
    await page.screenshot({
      path: `${outputDir}/${suffix}-today.png`,
      fullPage: true,
    })

    await page.goto('/#settings')
    await expect(
      page.getByRole('heading', { name: '工房の整え方' }),
    ).toBeVisible()
    await expect(page.getByTestId('provider-status-panel')).toBeVisible()
    await page.screenshot({
      path: `${outputDir}/${suffix}-settings.png`,
      fullPage: true,
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/#garden')
    await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
    await expect(page.getByRole('region', { name: '観測の庭' })).toBeVisible()
    await page.screenshot({
      path: `${outputDir}/${suffix}-reduced-motion.png`,
      fullPage: true,
    })
  })
})
