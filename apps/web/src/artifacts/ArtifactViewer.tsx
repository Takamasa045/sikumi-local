import { useEffect, useId, useRef, useState } from 'react'
import type { Artifact, ArtifactContent } from '@sikumi-local/core'
import { getArtifactContent } from '../api/artifacts'

interface ArtifactViewerProps {
  readonly artifact: Artifact
  readonly onClose: () => void
}

export function ArtifactViewer({ artifact, onClose }: ArtifactViewerProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<ArtifactContent | null>(null)
  const [rawView, setRawView] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPayload(null)
    void getArtifactContent(artifact.id)
      .then((next) => {
        if (!cancelled) {
          setPayload(next)
          setLoading(false)
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : '内容を取得できません',
          )
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [artifact.id])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function handleCopy() {
    if (!payload) {
      return
    }
    try {
      await navigator.clipboard.writeText(payload.content)
      setCopyMessage('コピーしました')
    } catch {
      setCopyMessage('コピーできませんでした')
    }
  }

  return (
    <div className="artifact-viewer-backdrop">
      <div
        className="artifact-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="artifact-viewer"
      >
        <div className="artifact-viewer__header">
          <div>
            <p className="section-kicker">成果の内容</p>
            <h3 id={titleId}>{artifact.title}</h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="is-quiet"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
        {loading ? (
          <p data-testid="artifact-viewer-loading">読み込み中です</p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="artifact-viewer-error">
            {error}
          </p>
        ) : null}
        {payload ? (
          <>
            {payload.truncated ? (
              <p className="artifact-viewer__truncated">一部のみ表示</p>
            ) : null}
            <div className="artifact-viewer__toolbar">
              <button
                type="button"
                className="is-quiet"
                aria-pressed={rawView}
                onClick={() => {
                  setRawView((current) => !current)
                }}
              >
                {rawView ? '読みやすい表示' : '原文を見る'}
              </button>
              <button type="button" onClick={() => void handleCopy()}>
                コピー
              </button>
            </div>
            <div
              className="artifact-viewer__body"
              data-testid="artifact-viewer-body"
            >
              {rawView ? (
                <pre className="artifact-viewer__raw">{payload.content}</pre>
              ) : (
                <ReadableContent payload={payload} />
              )}
            </div>
          </>
        ) : null}
        <p className="visually-hidden" aria-live="polite">
          {copyMessage ?? ''}
        </p>
        {copyMessage && copyMessage !== 'コピーしました' ? (
          <p role="status">{copyMessage}</p>
        ) : null}
      </div>
    </div>
  )
}

function ReadableContent({ payload }: { readonly payload: ArtifactContent }) {
  if (payload.format === 'json') {
    return <SafeJsonView text={payload.content} />
  }
  if (payload.format === 'markdown') {
    return <pre className="artifact-viewer__plain">{payload.content}</pre>
  }
  return <pre className="artifact-viewer__mono">{payload.content}</pre>
}

export function SafeJsonView({ text }: { readonly text: string }) {
  try {
    return <JsonTree value={JSON.parse(text) as unknown} />
  } catch {
    return <pre className="artifact-viewer__raw">{text}</pre>
  }
}

function JsonTree({ value }: { readonly value: unknown }) {
  if (value === null) {
    return <span>null</span>
  }
  if (typeof value === 'string') {
    return <span>{value}</span>
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>
  }
  if (Array.isArray(value)) {
    return (
      <ul className="artifact-json__list">
        {value.map((item, index) => (
          <li key={index}>
            <JsonTree value={item} />
          </li>
        ))}
      </ul>
    )
  }
  if (typeof value === 'object') {
    return (
      <dl className="artifact-json">
        {Object.entries(value as Record<string, unknown>).map(
          ([key, child]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <JsonTree value={child} />
              </dd>
            </div>
          ),
        )}
      </dl>
    )
  }
  return <span>{String(value)}</span>
}
