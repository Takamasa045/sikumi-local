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
              <small>{artifact.type}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
