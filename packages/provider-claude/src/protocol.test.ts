import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import { mapClaudeStreamEvent } from './map-event.js'
import {
  assertSupportedClaudeProtocol,
  loadClaudeProtocolFixture,
} from './protocol.js'

describe('Claude protocol fixtures', () => {
  it('accepts stream-json v1 and drops thinking', () => {
    const fixture = loadClaudeProtocolFixture('stream-json-v1.json')
    expect(assertSupportedClaudeProtocol(fixture.protocolVersion)).toBe(1)
    const mapped = [fixture.initializeEvent ?? {}, ...(fixture.events ?? [])]
      .map((event) => mapClaudeStreamEvent('run-1', event, 't'))
      .filter((event) => event !== null)
    expect(mapped.map((event) => event.type)).toEqual(
      fixture.expectedEventTypes ?? ['run.started', 'run.state_changed'],
    )
    expect(JSON.stringify(mapped)).not.toContain(
      'INTERNAL_REASONING_MUST_NOT_PERSIST',
    )
  })

  it('rejects an explicit stream-json v2 fixture', () => {
    const fixture = loadClaudeProtocolFixture('unsupported-v2.json')
    expect(() =>
      assertSupportedClaudeProtocol(fixture.initializeEvent?.protocol_version),
    ).toThrow(AppError)
    expect(
      mapClaudeStreamEvent('run-1', fixture.events?.[0] ?? {}, 't'),
    ).toBeNull()
  })
})
