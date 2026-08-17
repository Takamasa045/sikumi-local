import { expect, test } from '@playwright/test'

test('the Vite UI obtains an HttpOnly SameSite=Strict session token', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(() =>
    fetch('/api/session', { credentials: 'include' }).then((response) =>
      response.json(),
    ),
  )

  const cookie = (await context.cookies()).find(
    (entry) => entry.name === 'sikumi_session',
  )

  expect(cookie).toBeTruthy()
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Strict')
  expect(cookie?.path).toBe('/')
})
