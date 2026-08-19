import { cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('employee packs remain available through the legacy API but are not garden agents', async ({
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

  await page.goto('/#garden')
  const listed = await page.request.get('/api/employees')
  const body = (await listed.json()) as {
    employees?: Array<{ id: string; name: string; role: string }>
  }
  const saguru = (body.employees ?? []).find(
    (employee) => employee.id === 'saguru',
  )
  expect(saguru, JSON.stringify(body)).toMatchObject({
    id: 'saguru',
    name: 'サグル',
    role: '調査担当',
  })
  expect(
    (body.employees ?? []).map((employee) => employee.id),
    JSON.stringify(body),
  ).toEqual(expect.arrayContaining(['saguru', 'miru']))

  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '担当' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'AI社員' })).toHaveCount(0)

  const observingAgents = page.getByRole('list', {
    name: '観測中のエージェント',
  })
  const agentCount = await observingAgents.count()
  if (agentCount === 0) {
    await expect(page.getByRole('heading', { name: 'ミル' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'サグル' })).toHaveCount(0)
    await expect(
      page.getByRole('listitem').filter({ hasText: /^ミル$/ }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('listitem').filter({ hasText: /^サグル$/ }),
    ).toHaveCount(0)
  }
})
