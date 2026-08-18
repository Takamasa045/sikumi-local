import type { ProviderAvailability, ProviderId } from '@sikumi-local/core'

export type ProviderLoadState = 'loading' | 'ready' | 'error' | 'idle'

export type ProviderConnectionSummaryStatus =
  'loading' | 'connected' | 'disconnected' | 'error' | 'harness'

export interface ProviderConnectionSummary {
  readonly status: ProviderConnectionSummaryStatus
  readonly badgeLabel: string
  readonly badgeDetail: string
  readonly toolLabel: string
}

export function deriveProviderConnectionSummary(input: {
  readonly loadState: ProviderLoadState
  readonly providers: readonly ProviderAvailability[]
  readonly fakeHarness: boolean
  readonly defaultProviderId: ProviderId | null
}): ProviderConnectionSummary {
  if (input.loadState === 'loading') {
    return {
      status: 'loading',
      badgeLabel: '実行エンジンを確認中',
      badgeDetail: '実行エンジンの接続状態を確認しています',
      toolLabel: '確認中',
    }
  }

  if (input.loadState === 'error') {
    return {
      status: 'error',
      badgeLabel: '接続状態を確認できません',
      badgeDetail: '実行エンジンの接続状態を取得できませんでした',
      toolLabel: deriveToolLabel(input),
    }
  }

  if (input.fakeHarness) {
    return {
      status: 'harness',
      badgeLabel: '開発用ハーネス',
      badgeDetail: '開発用ハーネスでテスト実行します',
      toolLabel: 'テスト実行',
    }
  }

  const connected = connectedProviders(input.providers)
  if (connected.length === 1) {
    const name = connected[0]?.displayName ?? '実行エンジン'
    return {
      status: 'connected',
      badgeLabel: `${name} 接続済み`,
      badgeDetail: `${name} 接続済み`,
      toolLabel: deriveToolLabel(input),
    }
  }

  if (connected.length > 1) {
    const names = connected.map((provider) => provider.displayName)
    const joined = names.join(' · ')
    const badgeLabel =
      connected.length <= 2
        ? `${joined} 接続済み`
        : `${connected.length}つの実行エンジン接続済み`
    return {
      status: 'connected',
      badgeLabel,
      badgeDetail: joined,
      toolLabel: deriveToolLabel(input),
    }
  }

  return {
    status: 'disconnected',
    badgeLabel: '実行エンジン未接続',
    badgeDetail: '使える実行エンジンがまだありません',
    toolLabel: deriveToolLabel(input),
  }
}

export function connectedProviders(
  providers: readonly ProviderAvailability[],
): ProviderAvailability[] {
  return providers.filter((provider) => provider.executionConnected)
}

function deriveToolLabel(input: {
  readonly loadState?: ProviderLoadState
  readonly providers: readonly ProviderAvailability[]
  readonly fakeHarness: boolean
  readonly defaultProviderId: ProviderId | null
}): string {
  if (input.fakeHarness) {
    return 'テスト実行'
  }

  const selected = input.defaultProviderId
    ? input.providers.find(
        (provider) => provider.id === input.defaultProviderId,
      )
    : undefined

  if (selected) {
    if (selected.executionConnected) {
      return selected.displayName
    }
    if (selected.status === 'login_required' || needsLogin(selected)) {
      return `${selected.displayName} · ログインが必要`
    }
    if (selected.status === 'not_installed' || !selected.installed) {
      return `${selected.displayName} · 未インストール`
    }
    if (selected.status === 'capability_mismatch') {
      return `${selected.displayName} · この仕事には使えません`
    }
    if (input.loadState === 'error') {
      return `${selected.displayName} · 確認できません`
    }
    return `${selected.displayName} · つながっていません`
  }

  if (hasUsableProvider(input.providers)) {
    return '依頼ごとに選択'
  }

  return '実行エンジン未接続'
}

function needsLogin(provider: ProviderAvailability): boolean {
  return provider.installed && !provider.authenticated
}

function hasUsableProvider(
  providers: readonly ProviderAvailability[],
): boolean {
  return providers.some(
    (provider) =>
      provider.executionConnected ||
      provider.status === 'ready' ||
      provider.installed,
  )
}
