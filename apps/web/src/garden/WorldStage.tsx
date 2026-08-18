import type { CSSProperties } from 'react'
import type { WorldPack } from './worlds'

interface WorldStageProps {
  readonly world: WorldPack
  readonly activitySummary?: string
}

type StageStyle = CSSProperties & {
  '--world-background': string
  '--character-atlas': string
  '--atlas-columns': number
  '--atlas-rows': number
  '--atlas-x': string
  '--atlas-y': string
  '--character-x': string
  '--character-y': string
}

export function WorldStage({
  world,
  activitySummary = 'まだ仕事は始まっていません',
}: WorldStageProps) {
  const columnPosition =
    world.character.atlasColumns === 1
      ? 0
      : (world.character.atlasColumn / (world.character.atlasColumns - 1)) * 100
  const rowPosition =
    world.character.atlasRows === 1
      ? 0
      : (world.character.atlasRow / (world.character.atlasRows - 1)) * 100
  const style: StageStyle = {
    '--world-background': `url(${world.backgroundUrl})`,
    '--character-atlas': `url(${world.character.atlasUrl})`,
    '--atlas-columns': world.character.atlasColumns,
    '--atlas-rows': world.character.atlasRows,
    '--atlas-x': `${columnPosition}%`,
    '--atlas-y': `${rowPosition}%`,
    '--character-x': `${world.character.position.x}%`,
    '--character-y': `${world.character.position.y}%`,
  }

  return (
    <section
      className="world-stage"
      data-testid="world-stage"
      data-world-pack={world.id}
      aria-labelledby="garden-heading"
      style={style}
    >
      <div className="world-stage__shade" />
      <header className="world-stage__heading">
        <p>WORLD PACK · {world.shortName}</p>
        <h1 id="garden-heading">{world.name}</h1>
        <span>{world.description}</span>
      </header>

      <div
        className="employee"
        aria-label={`${world.character.name}、${world.character.role}`}
      >
        <div className="employee__note" role="status">
          <strong>{world.character.name}</strong>
          <span>{world.character.role}</span>
          <small>{activitySummary}</small>
        </div>
        <div className="employee__sprite" aria-hidden="true" />
        <div className="employee__shadow" aria-hidden="true" />
      </div>

      <div className="world-stage__local-mark" aria-label="ローカル専用">
        <span aria-hidden="true" />
        LOCAL ONLY
      </div>
    </section>
  )
}
