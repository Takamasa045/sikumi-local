import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import { mapGrokSessionUpdate } from './map-event.js'
import {
  assertSupportedGrokProtocol,
  loadGrokProtocolFixture,
} from './protocol.js'

describe('Grok protocol fixtures', () => {
  it('accepts ACP v1 and drops thought chunks', () => {
    const fixture = loadGrokProtocolFixture('acp-v1.json')
    expect(assertSupportedGrokProtocol(fixture.protocolVersion)).toBe(1)
    const mapped = (fixture.sessionUpdates ?? [])
      .map((update) => mapGrokSessionUpdate('run-1', update, 't'))
      .filter((event) => event !== null)
    expect(mapped.map((event) => event.type)).toEqual(
      fixture.expectedEventTypes ?? ['repository.read'],
    )
    expect(JSON.stringify(mapped)).not.toContain(
      'INTERNAL_REASONING_MUST_NOT_PERSIST',
    )
  })

  it('rejects an explicit ACP v2 fixture', () => {
    const fixture = loadGrokProtocolFixture('unsupported-v2.json')
    expect(() =>
      assertSupportedGrokProtocol(fixture.initializeResult?.protocolVersion),
    ).toThrow(AppError)
    expect(
      mapGrokSessionUpdate('run-1', fixture.sessionUpdates?.[0], 't'),
    ).toBeNull()
    expect(JSON.stringify(fixture.sessionUpdates ?? [])).toContain(
      'sk-protocol-secret',
    )
  })
})
