import type { FormEvent } from 'react'
import type { Workspace } from '@sikumi-local/core'
import { confirmUnregisterPlace } from './confirmUnregisterPlace'
import { PlaceAddForm } from './PlaceAddForm'

interface RepositoryPanelProps {
  readonly workspace: Workspace | null
  readonly workspaces?: readonly Workspace[]
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
  readonly onChooseFolder?: () => Promise<string | null>
  readonly onUnregister?: (workspaceId: string) => void
  readonly onEmployeeNameChange?: ((employeeName: string) => void) | undefined
}

export function RepositoryPanel({
  workspace,
  workspaces,
  busy,
  error,
  onRegister,
  onChooseFolder,
  onUnregister,
  onEmployeeNameChange,
}: RepositoryPanelProps) {
  const places = workspaces ?? (workspace ? [workspace] : [])

  function handleEmployeeNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const employeeName = String(form.get('employeeName') ?? '').trim()
    if (employeeName) {
      onEmployeeNameChange?.(employeeName)
    }
  }

  return (
    <section
      className="repository-panel"
      aria-label={places.length > 0 ? '登録した場所' : '場所の登録'}
    >
      {workspace ? (
        <>
          <p className="section-kicker">この工房の場所</p>
          <h2>{workspace.repository.displayName}</h2>
          <p className="repository-panel__path">
            {workspace.repository.absolutePath}
          </p>
          <ul className="repository-checks">
            <li>✓ Gitの場所です</li>
            <li>
              ✓ いまの枝: {workspace.repository.currentBranch ?? 'detached'}
            </li>
            <li>✓ 遠隔: {workspace.repository.remoteName ?? 'なし'}</li>
            <li>
              ✓{' '}
              {workspace.repository.readable ? '読み取り可能' : '読み取り不可'}
            </li>
          </ul>
          <form onSubmit={handleEmployeeNameSubmit}>
            <label>
              <span>担当の名前</span>
              <input
                key={workspace.employeeName}
                name="employeeName"
                aria-label="担当の名前"
                defaultValue={workspace.employeeName ?? ''}
                maxLength={40}
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy || !onEmployeeNameChange}>
              担当の名前を保存
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="section-kicker">最初の工房</p>
          <h2>どの場所を観測しますか？</h2>
        </>
      )}

      {places.length > 0 ? (
        <ul className="repository-place-list" aria-label="登録した場所">
          {places.map((place) => (
            <li key={place.id}>
              <div>
                <strong>{place.employeeName ?? place.repository.displayName}</strong>
                <p className="repository-panel__path">
                  {place.repository.absolutePath}
                </p>
              </div>
              {onUnregister ? (
                <button
                  type="button"
                  className="is-quiet"
                  data-testid={`settings-place-unregister-${place.id}`}
                  disabled={busy}
                  onClick={() => {
                    if (confirmUnregisterPlace()) {
                      onUnregister(place.id)
                    }
                  }}
                >
                  この場所を外す
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <PlaceAddForm
        busy={busy}
        error={error}
        onRegister={onRegister}
        onChooseFolder={onChooseFolder}
      />
    </section>
  )
}
