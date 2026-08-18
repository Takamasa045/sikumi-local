import type { FormEvent } from 'react'

interface JobComposerProps {
  readonly enabled: boolean
  readonly busy: boolean
  readonly request: string
  readonly notice: string
  readonly onRequestChange: (value: string) => void
  readonly onSubmit: (request: string) => void
}

export function JobComposer({
  enabled,
  busy,
  request,
  notice,
  onRequestChange,
  onSubmit,
}: JobComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enabled && !busy && request.trim().length > 0) {
      onSubmit(request)
    }
  }

  return (
    <form
      className="job-composer"
      aria-label="仕事を頼む"
      onSubmit={handleSubmit}
    >
      <div className="job-composer__intro">
        <p className="section-kicker">仕事の入口</p>
        <h2>サグルに何を調べてもらいますか</h2>
      </div>
      <label>
        <span>依頼内容</span>
        <textarea
          value={request}
          disabled={!enabled || busy}
          placeholder="例：このRepositoryの構成と改善点を調べて"
          rows={3}
          onChange={(event) => {
            onRequestChange(event.target.value)
          }}
        />
      </label>
      <div className="job-composer__footer">
        <p>
          <span aria-hidden="true">◇</span> {notice}
        </p>
        <button
          type="submit"
          disabled={!enabled || busy || request.trim().length === 0}
        >
          仕事を頼む
        </button>
      </div>
    </form>
  )
}
