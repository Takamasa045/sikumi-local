import type { InstalledPack, ProviderId, Workspace } from '@sikumi-local/core'
import type { ProviderAvailability } from '../api/providers'
import type { ProviderLoadState } from '../providers/connection-summary'
import { AdapterSettings } from '../observer/adapters/AdapterSettings'
import { RepositoryPanel } from '../workspace/RepositoryPanel'
import { ProviderStatusPanel } from './ProviderStatusPanel'

interface PackPreview {
  readonly id: string
  readonly packId: string
  readonly version: string
  readonly sourceKind: string
  readonly sourceDisplay: string
  readonly validation: { ok: boolean; errors: readonly string[] }
  readonly fileSummary: { files: number; names: readonly string[] }
  readonly gitCommit: string | null
  readonly gitChanges: string | null
}

interface SettingsPanelProps {
  readonly workspace: Workspace | null
  readonly workspaces?: readonly Workspace[]
  readonly providers: readonly ProviderAvailability[]
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
  readonly onChooseFolder?: () => Promise<string | null>
  readonly onUnregister?: (workspaceId: string) => void
  readonly onEmployeeNameChange?: ((employeeName: string) => void) | undefined
  readonly onWorkspaceProviderChange?: (providerId: ProviderId | null) => void
  readonly packs?: readonly InstalledPack[]
  readonly packPreview?: PackPreview | null
  readonly onPreviewPack?: (input: {
    sourceType: 'folder' | 'zip' | 'git'
    path?: string
    gitUrl?: string
  }) => void
  readonly onInstallPack?: () => void
  readonly onUninstallPack?: (id: string) => void
  readonly providerLoadState?: ProviderLoadState
  readonly providerProbeError?: string | null
  readonly providerProbes?: Partial<
    Record<
      ProviderId,
      {
        readonly version?: string
        readonly transport?: string
        readonly warnings?: readonly string[]
        readonly errors?: readonly string[]
      }
    >
  >
  readonly onRecheckProvider?: (id: ProviderId) => void
}

export function SettingsPanel({
  workspace,
  workspaces,
  providers,
  busy,
  error,
  onRegister,
  onChooseFolder,
  onUnregister,
  onEmployeeNameChange,
  onWorkspaceProviderChange,
  packs = [],
  packPreview = null,
  onPreviewPack,
  onInstallPack,
  onUninstallPack,
  providerLoadState = 'idle',
  providerProbeError = null,
  providerProbes,
  onRecheckProvider,
}: SettingsPanelProps) {
  return (
    <section className="settings-panel" id="settings" aria-label="設定">
      <p className="section-kicker">設定</p>
      <h2>工房の整え方</h2>
      <AdapterSettings
        key={
          (workspaces ?? (workspace ? [workspace] : []))
            .map((item) => item.id)
            .join(',') || 'none'
        }
      />
      <RepositoryPanel
        workspace={workspace}
        busy={busy}
        error={error}
        onRegister={onRegister}
        {...(workspaces ? { workspaces } : {})}
        {...(onChooseFolder ? { onChooseFolder } : {})}
        {...(onUnregister ? { onUnregister } : {})}
        {...(onEmployeeNameChange ? { onEmployeeNameChange } : {})}
      />
      {workspace && onWorkspaceProviderChange ? (
        <label className="settings-panel__tool">
          <span>この工房の標準の道具</span>
          <select
            aria-label="この工房の標準の道具"
            value={workspace.defaultProviderId ?? ''}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value
              onWorkspaceProviderChange(
                value === '' ? null : (value as ProviderId),
              )
            }}
          >
            <option value="">まだ選ばない</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {onRecheckProvider ? (
        <ProviderStatusPanel
          providers={providers}
          loadState={providerLoadState}
          busy={busy}
          probeError={providerProbeError}
          {...(providerProbes ? { probes: providerProbes } : {})}
          onRecheck={onRecheckProvider}
        />
      ) : null}
      {onPreviewPack ? (
        <form
          className="pack-import"
          data-testid="pack-import"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const sourceType = String(form.get('sourceType') ?? 'folder') as
              'folder' | 'zip' | 'git'
            const path = String(form.get('path') ?? '').trim()
            const gitUrl = String(form.get('gitUrl') ?? '').trim()
            onPreviewPack({
              sourceType,
              ...(path ? { path } : {}),
              ...(gitUrl ? { gitUrl } : {}),
            })
          }}
        >
          <h3>Packを確認して追加</h3>
          <label>
            <span>入手元</span>
            <select
              name="sourceType"
              aria-label="Packの入手元"
              defaultValue="folder"
            >
              <option value="folder">ローカルフォルダ</option>
              <option value="zip">Zip</option>
              <option value="git">Git URL</option>
            </select>
          </label>
          <label>
            <span>場所</span>
            <input name="path" aria-label="Packの場所" />
          </label>
          <label>
            <span>Git URL</span>
            <input name="gitUrl" aria-label="PackのGit URL" />
          </label>
          <button type="submit" disabled={busy}>
            確認画面を開く
          </button>
        </form>
      ) : null}
      {packPreview ? (
        <section className="pack-trust" data-testid="pack-trust">
          <h3>導入してよいPackですか</h3>
          <dl>
            <div>
              <dt>入手元</dt>
              <dd>
                {packPreview.sourceKind} · {packPreview.sourceDisplay}
              </dd>
            </div>
            <div>
              <dt>Pack</dt>
              <dd>
                {packPreview.packId} {packPreview.version}
              </dd>
            </div>
            <div>
              <dt>検証</dt>
              <dd>
                {packPreview.validation.ok
                  ? 'データのみで安全に読めました'
                  : packPreview.validation.errors.join(' / ')}
              </dd>
            </div>
            <div>
              <dt>ファイル</dt>
              <dd>
                {packPreview.fileSummary.files}件 ·{' '}
                {packPreview.fileSummary.names.slice(0, 8).join(', ')}
              </dd>
            </div>
            {packPreview.gitCommit ? (
              <div>
                <dt>Git</dt>
                <dd>
                  {packPreview.gitCommit.slice(0, 12)} ·{' '}
                  {packPreview.gitChanges}
                </dd>
              </div>
            ) : null}
          </dl>
          {onInstallPack ? (
            <button type="button" disabled={busy} onClick={onInstallPack}>
              このPackを導入する
            </button>
          ) : null}
        </section>
      ) : null}
      {packs.length > 0 ? (
        <ul className="pack-list" data-testid="pack-list">
          {packs.map((pack) => (
            <li key={pack.id}>
              <strong>
                {pack.packId} {pack.version}
              </strong>
              <small>
                {pack.kind} · {pack.builtin ? '組み込み' : pack.sourceKind}
              </small>
              {!pack.builtin && onUninstallPack ? (
                <button
                  type="button"
                  className="is-quiet"
                  disabled={busy}
                  onClick={() => {
                    onUninstallPack(pack.id)
                  }}
                >
                  削除
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
