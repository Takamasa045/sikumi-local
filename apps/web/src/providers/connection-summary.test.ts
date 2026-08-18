import { describe, expect, it } from 'vitest'
import type { ProviderAvailability } from '@sikumi-local/core'
import { deriveProviderConnectionSummary } from './connection-summary'

describe('deriveProviderConnectionSummary', () => {
  it('reports the initial loading badge without exposing provider ids', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'loading',
      providers: [],
      fakeHarness: false,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('loading')
    expect(summary.badgeLabel).toBe('実行エンジンを確認中')
    expect(summary.toolLabel).toBe('確認中')
    expect(JSON.stringify(summary)).not.toMatch(/codex|grok-build|claude-code/)
  })

  it('labels a single connected Codex without using the provider id', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex', { connected: true, status: 'ready' }),
        provider('grok-build', 'Grok Build'),
        provider('claude-code', 'Claude Code'),
      ],
      fakeHarness: false,
      defaultProviderId: 'codex',
    })
    expect(summary.status).toBe('connected')
    expect(summary.badgeLabel).toBe('Codex 接続済み')
    expect(summary.toolLabel).toBe('Codex')
    expect(summary.badgeLabel).not.toContain('codex')
  })

  it('labels a single connected Claude Code by display name', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex'),
        provider('claude-code', 'Claude Code', {
          connected: true,
          status: 'ready',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: 'claude-code',
    })
    expect(summary.badgeLabel).toBe('Claude Code 接続済み')
    expect(summary.toolLabel).toBe('Claude Code')
    expect(summary.badgeLabel).not.toContain('claude-code')
  })

  it('summarizes multiple connected engines with names in the detail', () => {
    const two = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex', { connected: true, status: 'ready' }),
        provider('grok-build', 'Grok Build', {
          connected: true,
          status: 'ready',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: null,
    })
    expect(two.status).toBe('connected')
    expect(two.badgeLabel).toBe('Codex · Grok Build 接続済み')
    expect(two.badgeDetail).toContain('Codex')
    expect(two.badgeDetail).toContain('Grok Build')

    const three = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex', { connected: true, status: 'ready' }),
        provider('grok-build', 'Grok Build', {
          connected: true,
          status: 'ready',
        }),
        provider('claude-code', 'Claude Code', {
          connected: true,
          status: 'ready',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: null,
    })
    expect(three.badgeLabel).toBe('3つの実行エンジン接続済み')
    expect(three.badgeDetail).toContain('Claude Code')
    expect(JSON.stringify(three)).not.toMatch(/codex|grok-build|claude-code/)
  })

  it('reports all disconnected engines', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex'),
        provider('grok-build', 'Grok Build'),
        provider('claude-code', 'Claude Code'),
      ],
      fakeHarness: false,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('disconnected')
    expect(summary.badgeLabel).toBe('実行エンジン未接続')
    expect(summary.toolLabel).toBe('実行エンジン未接続')
  })

  it('reports a fetch error without treating it as disconnected success', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'error',
      providers: [],
      fakeHarness: false,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('error')
    expect(summary.badgeLabel).toBe('接続状態を確認できません')
  })

  it('labels the fake harness instead of a real engine', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [provider('codex', 'Codex')],
      fakeHarness: true,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('harness')
    expect(summary.badgeLabel).toBe('開発用ハーネス')
    expect(summary.toolLabel).toBe('テスト実行')
  })

  it('does not treat an unset default as disconnected when a provider is available', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex', {
          connected: true,
          installed: true,
          authenticated: true,
          status: 'ready',
        }),
        provider('grok-build', 'Grok Build'),
      ],
      fakeHarness: false,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('connected')
    expect(summary.toolLabel).toBe('依頼ごとに選択')
    expect(summary.toolLabel).not.toBe('実行エンジン未接続')
    expect(summary.badgeLabel).not.toContain('codex')
  })

  it('keeps loading ahead of a known fake harness', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'loading',
      providers: [],
      fakeHarness: true,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('loading')
    expect(summary.badgeLabel).toBe('実行エンジンを確認中')
  })

  it('keeps a catalog fetch error ahead of a fake harness', () => {
    const summary = deriveProviderConnectionSummary({
      loadState: 'error',
      providers: [],
      fakeHarness: true,
      defaultProviderId: null,
    })
    expect(summary.status).toBe('error')
    expect(summary.badgeLabel).toBe('接続状態を確認できません')
  })

  it('describes a configured default that still needs login or install', () => {
    const login = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex', {
          installed: true,
          authenticated: false,
          status: 'login_required',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: 'codex',
    })
    expect(login.toolLabel).toBe('Codex · ログインが必要')

    const missing = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('grok-build', 'Grok Build', {
          installed: false,
          status: 'not_installed',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: 'grok-build',
    })
    expect(missing.toolLabel).toBe('Grok Build · 未インストール')
  })

  it('does not present a configured but unusable default as healthy', () => {
    const disconnected = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('codex', 'Codex', {
          installed: true,
          authenticated: true,
          status: 'disconnected',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: 'codex',
    })
    expect(disconnected.toolLabel).toBe('Codex · つながっていません')
    expect(disconnected.toolLabel).not.toBe('Codex')
    expect(disconnected.toolLabel).not.toContain('codex')

    const mismatch = deriveProviderConnectionSummary({
      loadState: 'ready',
      providers: [
        provider('claude-code', 'Claude Code', {
          installed: true,
          authenticated: true,
          status: 'capability_mismatch',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: 'claude-code',
    })
    expect(mismatch.toolLabel).toBe('Claude Code · この仕事には使えません')
    expect(mismatch.toolLabel).not.toContain('claude-code')

    const errored = deriveProviderConnectionSummary({
      loadState: 'error',
      providers: [
        provider('grok-build', 'Grok Build', {
          installed: true,
          authenticated: true,
          status: 'disconnected',
        }),
      ],
      fakeHarness: false,
      defaultProviderId: 'grok-build',
    })
    expect(errored.toolLabel).toBe('Grok Build · 確認できません')
    expect(errored.badgeLabel).toBe('接続状態を確認できません')
    expect(JSON.stringify(errored)).not.toMatch(/grok-build/)
  })
})

function provider(
  id: ProviderAvailability['id'],
  displayName: string,
  options?: {
    readonly connected?: boolean
    readonly installed?: boolean
    readonly authenticated?: boolean
    readonly status?: ProviderAvailability['status']
  },
): ProviderAvailability {
  return {
    id,
    displayName,
    executionConnected: options?.connected ?? false,
    installed: options?.installed ?? false,
    authenticated: options?.authenticated ?? false,
    status: options?.status ?? 'disconnected',
    capabilities: [],
  }
}
