import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeProvider } from '@sikumi-local/provider-fake'
import type { AgentProviderAdapter } from '@sikumi-local/provider-sdk'
import { DISCONNECTED_CAPABILITIES } from '@sikumi-local/provider-sdk'
import { buildApp } from '../app.js'
import { createProviderRegistry } from '../providers/registry.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { injectAuthed, injectPublic } from '../test/http.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('provider registry API', () => {
  it('probes, lists models, and updates workspace default without live CLIs', async () => {
    const dataDirectory = track(createTemporaryDirectory())
    const repositoryPath = track(createTemporaryGitRepository())
    const registry = createProviderRegistry({
      fakeHarnessEnabled: true,
      liveProviderRuns: false,
      adapters: [createFakeProvider(), stubCodex()],
    })
    const app = buildApp({
      dataDirectory,
      enableFakeProvider: true,
      liveProviderRuns: false,
      registry,
    })
    apps.push(app)

    const workspaceId = (
      await injectAuthed(app, {
        method: 'POST',
        url: '/api/workspaces',
        payload: { path: repositoryPath },
      })
    ).json().workspace.id as string

    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers',
    })
    expect(listed.json().fakeHarness).toBe(true)

    const probe = await injectAuthed(app, {
      method: 'POST',
      url: '/api/providers/fake/probe',
    })
    expect(probe.json().probe.transport).toBe('fake')

    const models = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers/fake/models',
    })
    expect(models.json().models).toEqual([])

    const detail = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers/codex',
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().provider.id).toBe('codex')

    const missing = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers/not-a-provider',
    })
    expect(missing.statusCode).toBe(404)

    const missingModels = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers/missing/models',
    })
    expect(missingModels.statusCode).toBe(404)

    const missingProbe = await injectAuthed(app, {
      method: 'POST',
      url: '/api/providers/missing/probe',
    })
    expect(missingProbe.statusCode).toBe(404)

    const invalidWorkspace = await injectAuthed(app, {
      method: 'PATCH',
      url: `/api/workspaces/${workspaceId}`,
      payload: { defaultProviderId: 'nope' },
    })
    expect(invalidWorkspace.statusCode).toBe(400)

    const updated = await injectAuthed(app, {
      method: 'PATCH',
      url: `/api/workspaces/${workspaceId}`,
      payload: { defaultProviderId: 'codex' },
    })
    expect(updated.json().workspace.defaultProviderId).toBe('codex')

    const renamed = await injectAuthed(app, {
      method: 'PATCH',
      url: `/api/workspaces/${workspaceId}`,
      payload: { employeeName: 'イトパン' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().workspace.employeeName).toBe('イトパン')

    const doctor = await injectPublic(app, {
      method: 'GET',
      url: '/api/doctor',
    })
    expect(doctor.statusCode).toBe(200)
    expect(Array.isArray(doctor.json().providers)).toBe(true)

    const settings = await injectAuthed(app, {
      method: 'PATCH',
      url: '/api/providers/codex/settings',
      payload: { workspaceId, selectedModel: 'default' },
    })
    expect(settings.statusCode).toBe(200)

    const invalidSettings = await injectAuthed(app, {
      method: 'PATCH',
      url: '/api/providers/codex/settings',
      payload: {},
    })
    expect(invalidSettings.statusCode).toBe(400)

    const confirmed = await injectAuthed(app, {
      method: 'POST',
      url: '/api/jobs',
      payload: {
        workspaceId,
        request: '調べて',
        selectedProvider: 'claude-code',
        confirmFallbackProvider: 'fake',
      },
    })
    expect(confirmed.statusCode).toBe(201)
    expect(confirmed.json().job.selectedProvider).toBe('fake')
  })

  it('probes uncached real providers on the first catalog read', async () => {
    let probes = 0
    const adapter: AgentProviderAdapter = {
      ...stubCodex(),
      async probe() {
        probes += 1
        return {
          installed: true,
          authenticated: true,
          transport: 'app-server',
          supportedFeatures: DISCONNECTED_CAPABILITIES,
          warnings: [],
          errors: [],
        }
      },
    }
    const registry = createProviderRegistry({
      fakeHarnessEnabled: false,
      liveProviderRuns: true,
      adapters: [adapter],
    })
    const app = buildApp({
      dataDirectory: track(createTemporaryDirectory()),
      liveProviderRuns: true,
      registry,
    })
    apps.push(app)

    expect(probes).toBe(0)
    const listed = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers',
    })
    expect(probes).toBe(1)
    const providers = listed.json().providers as Array<{
      id: string
      executionConnected: boolean
    }>
    expect(providers.find((provider) => provider.id === 'codex')).toMatchObject(
      {
        executionConnected: true,
      },
    )
    expect(listed.json().executionConnected).toBe(true)
  })

  it('keeps provider detail disconnected when live runs are disabled', async () => {
    const adapter: AgentProviderAdapter = {
      ...stubCodex(),
      async probe() {
        return {
          installed: true,
          authenticated: true,
          transport: 'app-server',
          supportedFeatures: DISCONNECTED_CAPABILITIES,
          warnings: [],
          errors: [],
        }
      },
    }
    const registry = createProviderRegistry({
      fakeHarnessEnabled: false,
      liveProviderRuns: false,
      adapters: [adapter],
    })
    const app = buildApp({
      dataDirectory: track(createTemporaryDirectory()),
      liveProviderRuns: false,
      registry,
    })
    apps.push(app)

    const detail = await injectPublic(app, {
      method: 'GET',
      url: '/api/providers/codex',
    })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().provider.executionConnected).toBe(false)
    expect(detail.json().provider.probe.installed).toBe(true)
    expect(detail.json().provider.probe.authenticated).toBe(true)
  })
})

function stubCodex(): AgentProviderAdapter {
  return {
    id: 'codex',
    displayName: 'Codex',
    advertisedAsRealProvider: true,
    async probe() {
      return {
        installed: false,
        authenticated: false,
        transport: 'disconnected',
        supportedFeatures: DISCONNECTED_CAPABILITIES,
        warnings: [],
        errors: ['fixture'],
      }
    },
    async getAuthStatus() {
      return { authenticated: false, description: 'fixture' }
    },
    async listModels() {
      return []
    },
    async getCapabilities() {
      return DISCONNECTED_CAPABILITIES
    },
    async startRun() {
      throw new Error('unused')
    },
    async resumeRun() {
      throw new Error('unused')
    },
    async respondToApproval() {},
    async respondToQuestion() {},
    async cancelRun() {},
    async dispose() {},
  }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
