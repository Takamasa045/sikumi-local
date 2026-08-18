import type { FormEvent } from 'react'
import type { Workspace } from '@sikumi-local/core'

interface RepositoryPanelProps {
  readonly workspace: Workspace | null
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
  readonly onEmployeeNameChange?: ((employeeName: string) => void) | undefined
}

export function RepositoryPanel({
  workspace,
  busy,
  error,
  onRegister,
  onEmployeeNameChange,
}: RepositoryPanelProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const path = String(form.get('path') ?? '')
    const employeeName = String(form.get('employeeName') ?? '').trim()
    onRegister(path, employeeName)
  }

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
      aria-label={workspace ? '登録済みRepository' : 'Repository登録'}
    >
      {workspace ? (
        <>
          <p className="section-kicker">この工房の場所</p>
          <h2>{workspace.repository.displayName}</h2>
          <p className="repository-panel__path">
            {workspace.repository.absolutePath}
          </p>
          <ul className="repository-checks">
            <li>✓ Git Repository</li>
            <li>
              ✓ 現在のbranch: {workspace.repository.currentBranch ?? 'detached'}
            </li>
            <li>✓ remote: {workspace.repository.remoteName ?? 'なし'}</li>
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
          <h2>AI社員をどこで働かせますか？</h2>
        </>
      )}

      <form onSubmit={handleSubmit}>
        {!workspace ? (
          <label>
            <span>担当の名前（任意）</span>
            <p className="repository-panel__help">
              空欄ならRepository名から自動で決めます。登録後も変更できます。
            </p>
            <input
              name="employeeName"
              aria-label="担当の名前（任意）"
              placeholder="例：ブログ番"
              autoComplete="off"
              maxLength={40}
              disabled={busy}
            />
          </label>
        ) : null}
        <label>
          <span>Repositoryの場所</span>
          <p className="repository-panel__help">
            AI社員に作業してもらいたいGitプロジェクトのフォルダを指定してください。Shikumi
            Local自身のフォルダではありません。
          </p>
          <input
            name="path"
            aria-label="Repositoryの場所"
            placeholder="/Users/example/Projects/my-website"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        {error ? (
          <p className="repository-panel__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          この工房に登録する
        </button>
      </form>
    </section>
  )
}
