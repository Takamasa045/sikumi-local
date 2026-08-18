import { cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('a fixture employee pack appears in the garden without Core changes', async ({
  page,
}) => {
  const dataDirectory = process.env.SIKUMI_E2E_DATA_DIR
  expect(dataDirectory).toBeTruthy()
  const destination = `${dataDirectory}/employees/miru`
  cpSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../packages/employee-sdk/fixtures/miru',
    ),
    destination,
    { recursive: true },
  )
  expect(existsSync(join(destination, 'employee.yaml'))).toBe(true)

  await page.goto('/')
  const listed = await page.request.get('/api/employees')
  const body = (await listed.json()) as {
    employees?: Array<{ id: string; name: string }>
  }
  expect(
    (body.employees ?? []).map((employee) => employee.id),
    JSON.stringify(body),
  ).toEqual(expect.arrayContaining(['saguru', 'miru']))

  const selector = page.getByRole('combobox', { name: '担当' })
  await expect(selector).toContainText('サグル')
  await expect(selector).toContainText('ミル')
  await selector.selectOption('miru')
  await expect(
    page.getByRole('heading', { name: 'ミルに何を頼みますか' }),
  ).toBeVisible()
})
