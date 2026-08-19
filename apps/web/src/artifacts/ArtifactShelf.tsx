import { useState } from 'react'
import type { Artifact } from '@sikumi-local/core'
import type { PublicArtifact } from '../api/jobs'
import { ArtifactViewer } from './ArtifactViewer'

interface ArtifactShelfProps {
  readonly artifacts: readonly PublicArtifact[]
  readonly worktree?: {
    readonly branchName: string
    readonly baseCommit: string
    readonly status: string
    readonly summary: string
    readonly files: readonly string[]
    readonly patch: string
  } | null
  readonly busy?: boolean
  readonly onApply?: (artifactId: string) => void
  readonly onExport?: (artifactId: string) => void
  readonly onKeep?: () => void
  readonly onDiscard?: () => void
}

export function ArtifactShelf({
  artifacts,
  worktree,
  busy = false,
  onApply,
  onExport,
  onKeep,
  onDiscard,
}: ArtifactShelfProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [restoreFocus, setRestoreFocus] = useState<HTMLElement | null>(null)
  const openArtifact = artifacts.find((artifact) => artifact.id === openId)

  function openViewer(artifactId: string, trigger: HTMLElement | null) {
    setRestoreFocus(trigger)
    setOpenId(artifactId)
  }

  function closeViewer() {
    setOpenId(null)
    restoreFocus?.focus()
  }

  return (
    <section
      className="artifact-shelf"
      id="artifacts"
      aria-label="成果棚"
      data-testid="artifact-shelf"
    >
      <p className="section-kicker">今日届いた成果 {artifacts.length}件</p>
      <h2>成果棚</h2>
      {artifacts.length === 0 ? (
        <p>まだ届いた成果はありません</p>
      ) : (
        <ul>
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <strong>{artifact.title}</strong>
              <small>{artifactTypeLabel(artifact.type)}</small>
              <div className="artifact-shelf__actions">
                <button
                  type="button"
                  onClick={(event) => {
                    openViewer(artifact.id, event.currentTarget)
                  }}
                >
                  内容を見る
                </button>
              </div>
              {artifact.type === 'patch' || artifact.type === 'code_diff' ? (
                <div className="artifact-shelf__actions">
                  {onApply ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onApply(artifact.id)
                      }}
                    >
                      現在のbranchへ適用
                    </button>
                  ) : null}
                  {onExport ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onExport(artifact.id)
                      }}
                    >
                      Patchを書き出す
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {worktree ? (
        <div className="worktree-diff" data-testid="worktree-diff">
          <p>
            branch {worktree.branchName} · base{' '}
            {worktree.baseCommit.slice(0, 8)} · {worktree.status}
          </p>
          <pre>{worktree.summary}</pre>
          {worktree.files.length > 0 ? (
            <ul>
              {worktree.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : null}
          {worktree.patch ? <pre>{worktree.patch}</pre> : null}
          <div className="artifact-shelf__actions">
            {onKeep ? (
              <button type="button" disabled={busy} onClick={onKeep}>
                branchを残す
              </button>
            ) : null}
            {onDiscard ? (
              <button type="button" disabled={busy} onClick={onDiscard}>
                破棄
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {openArtifact ? (
        <ArtifactViewer artifact={openArtifact} onClose={closeViewer} />
      ) : null}
    </section>
  )
}

function artifactTypeLabel(type: Artifact['type']): string {
  switch (type) {
    case 'report':
      return '調査レポート'
    case 'markdown':
      return 'Markdown'
    case 'code_diff':
      return 'コード差分'
    case 'patch':
      return 'Patch'
    case 'test_result':
      return 'テスト結果'
    case 'review':
      return 'レビュー結果'
    case 'plan':
      return '計画'
    case 'handoff':
      return '引き継ぎメモ'
    case 'file':
      return 'ファイル'
    case 'link':
      return 'URL'
    default:
      return type
  }
}
