import { AppError } from '@sikumi-local/core'
import { describe, expect, it } from 'vitest'
import { mapCodexNotification } from './map-event.js'
import {
  assertSupportedCodexProtocol,
  loadCodexProtocolFixture,
} from './protocol.js'

describe('Codex protocol fixtures', () => {
  it('accepts app-server v1 and drops reasoning-shaped items', () => {
    const fixture = loadCodexProtocolFixture('app-server-v1.json')
    expect(fixture.supported).toBe(true)
    expect(assertSupportedCodexProtocol(fixture.protocolVersion)).toBe(1)

    const mapped = (fixture.notifications ?? [])
      .map((notification) =>
        mapCodexNotification(
          'run-1',
          notification.method,
          notification.params,
          't',
        ),
      )
      .filter((event) => event !== null)

    expect(mapped.map((event) => event.type)).toEqual(
      fixture.expectedEventTypes ?? ['run.started', 'command.started'],
    )
    expect(JSON.stringify(mapped)).not.toContain(
      'INTERNAL_REASONING_MUST_NOT_PERSIST',
    )
    expect(JSON.stringify(mapped)).not.toContain('sk-protocol-secret')
  })

  it('accepts the current versionless app-server initialize result', () => {
    const fixture = loadCodexProtocolFixture('app-server-current.json')

    expect(fixture.supported).toBe(true)
    expect(fixture.initializeResult).toEqual({
      userAgent:
        'shikumi-local/0.144.6 (macOS; arm64) unknown (shikumi-local; 0.1.0)',
      codexHome: '/tmp/.codex',
      platformFamily: 'unix',
      platformOs: 'macos',
    })
    expect(fixture.initializeResult).not.toHaveProperty('protocolVersion')
    expect(assertSupportedCodexProtocol(fixture.initializeResult)).toBe(1)
  })

  it('accepts a versionless Codex Desktop initialize result with the same runtime fields', () => {
    expect(
      assertSupportedCodexProtocol({
        userAgent: 'Codex Desktop/0.144.6',
        codexHome: '/tmp/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      }),
    ).toBe(1)
  })

  it('rejects an unrecognized versionless initialize result', () => {
    expect(() =>
      assertSupportedCodexProtocol({ userAgent: 'unknown-client' }),
    ).toThrowError(AppError)
  })

  it('rejects a versionless object that only happens to share some runtime fields', () => {
    expect(() =>
      assertSupportedCodexProtocol({
        userAgent: 'totally-unrelated/1.0.0',
        codexHome: '/tmp/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      }),
    ).toThrowError(AppError)
  })

  it('rejects an explicit unknown protocolVersion even when the rest looks current', () => {
    try {
      assertSupportedCodexProtocol({
        protocolVersion: 99,
        userAgent:
          'shikumi-local/0.144.6 (macOS; arm64) unknown (shikumi-local; 0.1.0)',
        codexHome: '/tmp/.codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      })
      throw new Error('expected PROVIDER_CAPABILITY_MISMATCH')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('PROVIDER_CAPABILITY_MISMATCH')
    }
  })

  it('rejects an explicit protocol v2 fixture', () => {
    const fixture = loadCodexProtocolFixture('unsupported-v2.json')
    expect(fixture.supported).toBe(false)
    try {
      assertSupportedCodexProtocol(fixture.initializeResult?.protocolVersion)
      throw new Error('expected PROVIDER_CAPABILITY_MISMATCH')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('PROVIDER_CAPABILITY_MISMATCH')
    }
    expect(
      mapCodexNotification(
        'run-1',
        fixture.notifications?.[0]?.method ?? '',
        fixture.notifications?.[0]?.params,
        't',
      ),
    ).toBeNull()
  })
})
