import { useEffect } from 'react'
import type { GardenStationId } from '@sikumi-local/core'
import {
  describeStationOccupants,
  gardenStationLabels,
  gardenStationMeanings,
} from './worlds'

export type GardenInspectSubject =
  | {
      readonly kind: 'character'
      readonly name: string
      readonly role?: string
      readonly station: GardenStationId
      readonly traveling: boolean
      readonly summary: string
      readonly jobTitle?: string
      readonly nowText?: string
      readonly implementationLook?: string
      readonly nextStep?: string
      readonly driverNote?: string | null
      readonly live?: boolean
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
  const hasProgress =
    subject.nowText !== undefined &&
    subject.implementationLook !== undefined &&
    subject.nextStep !== undefined
  const live = subject.live !== false
  return (
    <dl className="garden-inspect__facts">
      {subject.role && !hasProgress ? (
        <>
          <dt>役割</dt>
          <dd>{subject.role}</dd>
        </>
      ) : null}
      <dt>場所</dt>
      <dd>
        {subject.traveling ? `${place}へ向かっています` : `${place}にいます`}
      </dd>
      {hasProgress && live ? (
        <>
          <dt>いま</dt>
          <dd>
            {subject.nowText}
            {subject.driverNote ? (
              <span className="garden-inspect__driver">
                {subject.driverNote}
              </span>
            ) : null}
          </dd>
          <dt>実装の様子</dt>
          <dd>{subject.implementationLook}</dd>
          <dt>これから</dt>
          <dd>{subject.nextStep}</dd>
        </>
      ) : hasProgress ? (
        <>
          <dt>どこまでやったか</dt>
          <dd>
            {describeStoppedLook(subject.nowText, subject.implementationLook)}
            {subject.driverNote ? (
              <span className="garden-inspect__driver">
                {subject.driverNote}
              </span>
            ) : null}
          </dd>
          <dt>次はこんな感じか</dt>
          <dd>{subject.nextStep}</dd>
        </>
      ) : (
        <>
          {subject.jobTitle ? (
            <>
              <dt>仕事</dt>
              <dd>{subject.jobTitle}</dd>
            </>
          ) : null}
          <dt>要約</dt>
          <dd>{subject.summary}</dd>
        </>
      )}
    </dl>
  )
}

function describeStoppedLook(
  nowText: string | undefined,
  implementationLook: string | undefined,
): string {
  const now = nowText?.trim() ?? ''
  const look = implementationLook?.trim() ?? ''
  if (!look || now.includes(look)) {
    return now
  }
  if (!now) {
    return look
  }
  return `${now} ${look}`
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
