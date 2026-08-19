import { basename } from 'node:path'
import { expect, test } from '@playwright/test'
import { createTemporaryGitRepository } from './owned-temp'

test.describe.configure({ mode: 'serial' })

test('legacy jobs API remains available without a garden job form', async ({
  page,
}) => {
  const repositoryPath = createTemporaryGitRepository('sikumi-e2e-job-')

  await page.goto('/#observer')
  await page.getByLabel('観測するRepositoryの場所').fill(repositoryPath)
  await page.getByRole('button', { name: '観測するRepositoryを追加' }).click()
  await expect(
    page.getByText(basename(repositoryPath), { exact: false }).first(),
  ).toBeVisible()

  const workspacesResponse = await page.request.get('/api/workspaces')
  const workspacesBody = (await workspacesResponse.json()) as {
    workspaces?: Array<{
      id?: string
      repository?: { absolutePath?: string; displayName?: string }
    }>
  }
  const workspace = (workspacesBody.workspaces ?? []).find((item) => {
    const path = item.repository?.absolutePath ?? ''
    const displayName = item.repository?.displayName ?? ''
    return (
      path.includes(basename(repositoryPath)) ||
      displayName.includes(basename(repositoryPath))
    )
  })
  const workspaceId = workspace?.id
  expect(workspaceId, JSON.stringify(workspacesBody)).toBeTruthy()

  const jobsResponse = await page.request.get(
    `/api/jobs?workspaceId=${encodeURIComponent(workspaceId as string)}`,
  )
  expect(jobsResponse.ok()).toBeTruthy()
  const jobsBody = (await jobsResponse.json()) as { jobs?: unknown }
  expect(Array.isArray(jobsBody.jobs)).toBeTruthy()

  await page.goto('/#garden')
  await expect(page.getByRole('heading', { name: '観測の庭' })).toBeVisible()
  await expect(page.getByRole('form', { name: '仕事を頼む' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '仕事を頼む' })).toHaveCount(0)
})
