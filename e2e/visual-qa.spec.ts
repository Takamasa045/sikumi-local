import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const outputDir = 'tmp/visual-qa'

test.describe('garden visual QA', () => {
  test('captures desktop, mobile, and reduced-motion garden frames', async ({
    page,
  }, testInfo) => {
    mkdirSync(outputDir, { recursive: true })
    const suffix = testInfo.project.name
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: '犬たちの里山アトリエ' }),
    ).toBeVisible()
    await expect(page.getByRole('combobox', { name: '担当' })).toContainText(
      'サグル',
    )
    await expect(page.getByTestId('world-stage')).toBeVisible()
    await expect(page.getByTestId('first-run-guide')).toBeVisible()
    await expect(page.getByTestId('world-stage')).toHaveAttribute(
      'data-employee-id',
      /.+/,
    )
    await page.screenshot({
      path: `${outputDir}/${suffix}-garden.png`,
      fullPage: true,
    })

    await page.getByRole('link', { name: '成果棚' }).click()
    await expect(page.getByRole('heading', { name: '成果棚' })).toBeVisible()
    await page.screenshot({
      path: `${outputDir}/${suffix}-artifacts.png`,
      fullPage: true,
    })

    await page.getByRole('link', { name: 'AI社員' }).click()
    await expect(page.getByRole('heading', { name: 'AI社員' })).toBeVisible()
    await expect(page.getByRole('button', { name: /サグル/ })).toBeVisible()
    await page.screenshot({
      path: `${outputDir}/${suffix}-employees.png`,
      fullPage: true,
    })

    await page.getByRole('link', { name: '設定' }).click()
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
    await expect(page.getByRole('combobox', { name: '担当' })).toContainText(
      'サグル',
    )
    await expect(page.getByTestId('world-stage')).toBeVisible()
    await expect(page.getByTestId('world-stage')).toHaveAttribute(
      'data-employee-id',
      /.+/,
    )
    await page.screenshot({
      path: `${outputDir}/${suffix}-reduced-motion.png`,
      fullPage: true,
    })
  })
})
