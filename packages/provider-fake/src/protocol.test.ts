import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createFakeProvider } from './fake-provider.js'
import { mapFakeProcessEvent } from './map-event.js'

interface FakeProtocolFixture {
  readonly protocolVersion: number
  readonly probe: { readonly version: string }
  readonly events: readonly Record<string, unknown>[]
  readonly expectedEventTypes: readonly string[]
}

describe('Fake protocol fixture', () => {
  it('keeps the harness on protocol v0 and drops reasoning-shaped events', async () => {
    const fixture = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '../fixtures/protocol/fake-v0.json',
        ),
        'utf8',
      ),
    ) as FakeProtocolFixture
    const provider = createFakeProvider()
    const probe = await provider.probe()
    expect(probe.version).toBe(fixture.probe.version)
    expect(provider.advertisedAsRealProvider).toBe(false)
    const mapped = fixture.events
      .map((event) => mapFakeProcessEvent('run-1', event, 't'))
      .filter((event) => event !== null)
    expect(mapped.map((event) => event.type)).toEqual(
      fixture.expectedEventTypes,
    )
    expect(JSON.stringify(mapped)).not.toContain(
      'INTERNAL_REASONING_MUST_NOT_PERSIST',
    )
    expect(JSON.stringify(mapped)).not.toContain('FAKE_SECRET_TOKEN')
    await provider.dispose()
  })
})
