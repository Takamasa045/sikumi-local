import { describe, expect, it } from 'vitest'
import { defaultProviders, isProviderId, isShikumiEventType } from './domain.js'
import {
  providerSchema,
  registerWorkspaceRequestSchema,
  workspaceSchema,
} from './schemas.js'

describe('registerWorkspaceRequestSchema', () => {
  it('accepts a trimmed absolute path', () => {
    expect(
      registerWorkspaceRequestSchema.parse({
        path: ' /Users/example/project ',
      }),
    ).toEqual({ path: '/Users/example/project' })
  })

  it('rejects an empty path', () => {
    expect(() =>
      registerWorkspaceRequestSchema.parse({ path: '   ' }),
    ).toThrow()
  })
})

describe('workspaceSchema', () => {
  it('accepts a persisted workspace snapshot', () => {
    const workspace = workspaceSchema.parse({
      id: 'ws_1',
      name: 'project',
      defaultProviderId: null,
      worldPackId: 'dog-office',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      repository: {
        id: 'repo_1',
        absolutePath: '/Users/example/project',
        displayName: 'project',
        currentBranch: 'main',
        remoteName: 'origin',
        remoteUrl: 'https://github.com/example/project.git',
        readable: true,
      },
    })

    expect(workspace.repository.displayName).toBe('project')
  })
})

describe('providerSchema', () => {
  it('keeps every catalog provider disconnected in this phase', () => {
    for (const provider of defaultProviders) {
      expect(providerSchema.parse(provider).executionConnected).toBe(false)
    }
  })
})

describe('domain guards', () => {
  it('accepts catalog provider ids and known event types only', () => {
    expect(isProviderId('codex')).toBe(true)
    expect(isProviderId('secret-provider')).toBe(false)
    expect(isShikumiEventType('run.state_changed')).toBe(true)
    expect(isShikumiEventType('internal.reasoning')).toBe(false)
  })
})
