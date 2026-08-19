import { useEffect } from 'react'
import type { GardenStationId } from '@sikumi-local/core'
import {
  describeStationOccupants,
  gardenStationLabels,
  gardenStationMeanings,
} from './worlds'

export const UNKNOWN_INSPECT_FACT = 'まだ分かっていません'

export type GardenInspectSubject =
  | {
      readonly kind: 'character'
      readonly name: string
      readonly role?: string
      readonly station: GardenStationId
      readonly traveling: boolean
      readonly summary: string
      readonly jobTitle?: string
      readonly operatorSummary?: string | null
      readonly repositoryLabel?: string
      readonly stopped?: boolean
      readonly progressSummary?: string | null
      readonly nextStepSummary?: string | null
    }
  | {
      readonly kind: 'station'
      readonly station: GardenStationId
      readonly occupants: readonly {
        readonly name: string
        readonly traveling: boolean
        readonly summary?: string
      }[]
    }

interface GardenInspectProps {
  readonly subject: GardenInspectSubject
  readonly onClose: () => void
}

export function GardenInspect({ subject, onClose }: GardenInspectProps) {
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

  const title =
    subject.kind === 'character'
      ? subject.name
      : gardenStationLabels[subject.station]

  return (
    <aside
      className="garden-inspect"
      data-testid="garden-inspect"
      data-kind={subject.kind}
      role="region"
      aria-label="いまの様子"
    >
      <div className="garden-inspect__head">
        <p className="garden-inspect__kicker">
          {subject.kind === 'character' ? 'いまの様子' : 'この場所'}
        </p>
        <strong className="garden-inspect__title">{title}</strong>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
      {subject.kind === 'character' ? (
        <CharacterBody subject={subject} />
      ) : (
        <StationBody subject={subject} />
      )}
    </aside>
  )
}

function CharacterBody({
  subject,
}: {
  readonly subject: Extract<GardenInspectSubject, { kind: 'character' }>
}) {
  const place = gardenStationLabels[subject.station]
  return (
    <dl className="garden-inspect__facts">
      {subject.role ? (
        <>
          <dt>役割</dt>
          <dd>{subject.role}</dd>
        </>
      ) : null}
      {subject.repositoryLabel ? (
        <>
          <dt>リポジトリ</dt>
          <dd>{subject.repositoryLabel}</dd>
        </>
      ) : null}
      <dt>場所</dt>
      <dd>
        {subject.traveling ? `${place}へ向かっています` : `${place}にいます`}
      </dd>
      {subject.operatorSummary ? (
        <>
          <dt>いま</dt>
          <dd>{subject.operatorSummary}</dd>
        </>
      ) : null}
      {subject.jobTitle ? (
        <>
          <dt>仕事</dt>
          <dd>{subject.jobTitle}</dd>
        </>
      ) : null}
      {subject.stopped ? (
        <>
          <dt>どこまでやったか</dt>
          <dd>{knownFact(subject.progressSummary ?? subject.summary)}</dd>
          <dt>次はこんな感じか</dt>
          <dd>{knownFact(subject.nextStepSummary)}</dd>
        </>
      ) : (
        <>
          <dt>いまの仕事</dt>
          <dd>{knownFact(subject.summary)}</dd>
        </>
      )}
    </dl>
  )
}

function knownFact(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || UNKNOWN_INSPECT_FACT
}

function StationBody({
  subject,
}: {
  readonly subject: Extract<GardenInspectSubject, { kind: 'station' }>
}) {
  return (
    <>
      <p className="garden-inspect__meaning">
        {gardenStationMeanings[subject.station]}
      </p>
      <p className="garden-inspect__occupants">
        {describeStationOccupants(subject.station, subject.occupants)}
      </p>
      {subject.occupants.map((occupant) =>
        occupant.summary ? (
          <p
            key={`${occupant.name}:${occupant.summary}`}
            className="garden-inspect__summary"
          >
            {occupant.name}：{occupant.summary}
          </p>
        ) : null,
      )}
    </>
  )
}
