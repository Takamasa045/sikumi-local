import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import {
  capabilitiesMissing,
  createProviderRunHandle,
  DISCONNECTED_CAPABILITIES,
  extractJsonObject,
  isApprovalDecision,
  isCanonicalEventType,
  isTerminalEventType,
  parseApprovalDecision,
  resolveProviderSelection,
  validateJsonSchema,
} from './index.js'

describe('provider SDK contracts', () => {
  it('keeps disconnected capabilities fully off', () => {
    expect(
      Object.values(DISCONNECTED_CAPABILITIES).every(
        (value) => value === false,
      ),
    ).toBe(true)
    expect(
      capabilitiesMissing(['streaming', 'liveApprovals'], {
        ...DISCONNECTED_CAPABILITIES,
        streaming: true,
      }),
    ).toEqual(['liveApprovals'])
  })

  it('accepts only known approval decisions and terminal events', () => {
    expect(parseApprovalDecision('approved')).toBe('approved')
    expect(isApprovalDecision('denied')).toBe(true)
    expect(isApprovalDecision('always')).toBe(false)
    expect(() => parseApprovalDecision('always')).toThrow(AppError)
    expect(isTerminalEventType('run.completed')).toBe(true)
    expect(isTerminalEventType('run.state_changed')).toBe(false)
    expect(isCanonicalEventType('artifact.created')).toBe(true)
    expect(isCanonicalEventType('reasoning.delta')).toBe(false)
  })

  it('exposes providerSessionId through a live getter', () => {
    const session: { id?: string } = {}
    const handle = createProviderRunHandle({
      runId: 'run-1',
      providerId: 'codex',
      getSessionId: () => session.id,
      events: () => (async function* () {})(),
      cancel: async () => {},
    })
    expect(handle.providerSessionId).toBeUndefined()
    session.id = 'late-session'
    expect(handle.providerSessionId).toBe('late-session')
  })

  it('resolves provider priority without auto-fallback', () => {
    expect(
      resolveProviderSelection({
        jobOverride: 'codex',
        employeeDefault: 'grok-build',
        workspaceDefault: 'claude-code',
        fakeHarnessEnabled: false,
        available: ['grok-build', 'claude-code'],
      }),
    ).toMatchObject({
      kind: 'unavailable',
      requested: 'codex',
      alternatives: ['grok-build', 'claude-code'],
    })
    expect(
      resolveProviderSelection({
        confirmFallbackProvider: 'grok-build',
        jobOverride: 'codex',
        fakeHarnessEnabled: false,
        available: ['grok-build'],
      }),
    ).toMatchObject({ kind: 'selected', providerId: 'grok-build' })
    expect(
      resolveProviderSelection({
        fakeHarnessEnabled: true,
        available: ['fake'],
      }),
    ).toMatchObject({ kind: 'selected', providerId: 'fake' })
    expect(
      resolveProviderSelection({
        employeeDefault: 'grok-build',
        workspaceDefault: 'codex',
        fakeHarnessEnabled: false,
        available: ['codex'],
      }),
    ).toMatchObject({
      kind: 'unavailable',
      requested: 'grok-build',
    })
  })

  it('validates structured results against a JSON Schema subset', () => {
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['title', 'summary'],
      additionalProperties: false,
    }
    expect(
      validateJsonSchema({ title: '調査', summary: '完了' }, schema).ok,
    ).toBe(true)
    expect(validateJsonSchema({ title: '調査', extra: true }, schema).ok).toBe(
      false,
    )
    expect(
      extractJsonObject('prefix {"title":"調査","summary":"完了"} suffix'),
    ).toEqual({ title: '調査', summary: '完了' })
    expect(
      extractJsonObject('```json\n{"title":"調査","summary":"完了"}\n```'),
    ).toEqual({ title: '調査', summary: '完了' })
    expect(extractJsonObject('')).toBeNull()
    expect(extractJsonObject('["array"]')).toBeNull()
    expect(
      validateJsonSchema(['a'], {
        type: 'array',
        items: { type: 'string' },
      }).ok,
    ).toBe(true)
    expect(validateJsonSchema(1, { type: 'integer' }).ok).toBe(true)
    expect(validateJsonSchema(true, { type: 'boolean' }).ok).toBe(true)
    expect(validateJsonSchema(null, { type: 'null' }).ok).toBe(true)
    expect(validateJsonSchema('x', { type: 'number' }).ok).toBe(false)
    expect(validateJsonSchema([], { type: 'object' }).ok).toBe(false)
    expect(
      resolveProviderSelection({
        employeeDefault: 'grok-build',
        workspaceDefault: 'codex',
        fakeHarnessEnabled: false,
        available: ['grok-build', 'codex'],
      }),
    ).toMatchObject({ kind: 'selected', providerId: 'grok-build' })
    expect(
      resolveProviderSelection({
        workspaceDefault: 'codex',
        fakeHarnessEnabled: false,
        available: ['codex'],
      }),
    ).toMatchObject({ kind: 'selected', providerId: 'codex' })
    expect(
      resolveProviderSelection({
        jobOverride: 'fake',
        fakeHarnessEnabled: false,
        available: ['codex'],
      }),
    ).toMatchObject({ kind: 'unavailable', requested: 'fake' })
    expect(
      resolveProviderSelection({
        fakeHarnessEnabled: false,
        available: ['codex'],
      }),
    ).toMatchObject({ kind: 'unspecified' })
  })
})
