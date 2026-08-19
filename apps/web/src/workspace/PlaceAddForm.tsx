import { useState, type FormEvent } from 'react'

export interface PlaceAddFormProps {
  readonly busy: boolean
  readonly error: string | null
  readonly onRegister: (path: string, employeeName: string) => void
  readonly onChooseFolder?: () => Promise<string | null>
  readonly submitLabel?: string
}

export function PlaceAddForm({
  busy,
  error,
  onRegister,
  onChooseFolder,
  submitLabel = 'この場所を追加',
}: PlaceAddFormProps) {
  const [path, setPath] = useState('')
  const [choosing, setChoosing] = useState(false)
  const blocked = busy || choosing

  async function handleChooseFolder() {
    if (!onChooseFolder) {
      return
    }
    setChoosing(true)
    try {
      const chosen = await onChooseFolder()
      if (chosen) {
        setPath(chosen)
      }
    } finally {
      setChoosing(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const employeeName = String(form.get('employeeName') ?? '').trim()
    onRegister(path, employeeName)
    setPath('')
    event.currentTarget.reset()
  }

  return (
    <form
      className="observer-add-repository"
      data-testid="observer-add-repository"
      onSubmit={handleSubmit}
    >
      <h3>観測する場所を追加</h3>
      <p>
        「フォルダを選ぶ」から登録します。選べないときは、場所のパスを貼っても大丈夫です。フォルダそのものは消えません。
      </p>
      {onChooseFolder ? (
        <button
          type="button"
          data-testid="place-choose-folder"
          disabled={blocked}
          onClick={() => {
            void handleChooseFolder()
          }}
        >
          フォルダを選ぶ
        </button>
      ) : null}
      <label>
        <span>担当の名前（任意）</span>
        <input
          name="employeeName"
          aria-label="担当の名前（任意）"
          placeholder="例：ブログ番"
          autoComplete="off"
          maxLength={40}
          disabled={blocked}
        />
      </label>
      <label>
        <span>場所のパス（手入力してもよい）</span>
        <input
          name="path"
          aria-label="場所のパス"
          placeholder="例：自分のプロジェクトのフォルダ"
          autoComplete="off"
          spellCheck={false}
          disabled={blocked}
          value={path}
          onChange={(event) => {
            setPath(event.target.value)
          }}
        />
      </label>
      {error ? (
        <p className="repository-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={blocked || path.trim().length === 0}>
        {submitLabel}
      </button>
    </form>
  )
}
