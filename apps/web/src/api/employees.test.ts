import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSessionToken } from './session.js'
import {
  getEmployee,
  listEmployees,
  updateEmployeeDefaultProvider,
} from './employees.js'

afterEach(() => {
  resetSessionToken()
  vi.unstubAllGlobals()
})

describe('employee API client', () => {
  it('lists employees and updates the default tool', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/session')) {
          return jsonResponse({ token: 'boot-session-token' })
        }
        if (url.endsWith('/api/employees') && init?.method !== 'PATCH') {
          return jsonResponse({ employees: [sampleEmployee()] })
        }
        if (url.endsWith('/api/employees/saguru') && init?.method === 'PATCH') {
          return jsonResponse({
            employee: { ...sampleEmployee(), defaultProviderId: 'codex' },
          })
        }
        if (url.endsWith('/api/employees/saguru')) {
          return jsonResponse({
            employee: sampleEmployee(),
            recentJobs: [],
            stateMap: { states: {}, eventBindings: {} },
          })
        }
        return jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'missing' } },
          404,
        )
      }),
    )

    await expect(listEmployees()).resolves.toEqual([sampleEmployee()])
    await expect(getEmployee('saguru')).resolves.toMatchObject({
      employee: { id: 'saguru' },
    })
    await expect(
      updateEmployeeDefaultProvider('saguru', 'codex'),
    ).resolves.toMatchObject({ defaultProviderId: 'codex' })
  })
})

function sampleEmployee() {
  return {
    id: 'saguru',
    packId: 'saguru',
    name: 'サグル',
    role: '調査担当',
    defaultProviderId: null,
    createdAt: 't',
    updatedAt: 't',
    description: '調査担当',
    version: '1.0.0',
    permissionProfile: 'research',
    supportedJobTypes: ['research'],
    defaultProviderOrder: ['grok-build', 'codex', 'claude-code'],
    requiredProviderCapabilities: ['streaming', 'sessionResume'],
    character: 'saguru-default',
    source: 'builtin',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
