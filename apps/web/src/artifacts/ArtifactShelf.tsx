import type { Artifact } from '@sikumi-local/core'

interface ArtifactShelfProps {
  readonly artifacts: readonly Artifact[]
}

export function ArtifactShelf({ artifacts }: ArtifactShelfProps) {
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
              <small>
                {artifactTypeLabel(artifact.type)}
                {artifact.storagePath
                  ? ' · 保存済み'
                  : ' · 本文はまだありません'}
              </small>
            </li>
          ))}
        </ul>
      )}
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
