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
      readonly nowText?: string | null
      readonly implementationLook?: string | null
      readonly nextStep?: string | null
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
          {knownLine(subject.nowText) ? (
            <>
              <dt>いま</dt>
              <dd>
                {subject.nowText}
                {knownLine(subject.driverNote) ? (
                  <span className="garden-inspect__driver">
                    {subject.driverNote}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {knownLine(subject.implementationLook) ? (
            <>
              <dt>実装の様子</dt>
              <dd>{subject.implementationLook}</dd>
            </>
          ) : null}
          {knownLine(subject.nextStep) ? (
            <>
              <dt>これから</dt>
              <dd>{subject.nextStep}</dd>
            </>
          ) : null}
        </>
      ) : hasProgress ? (
        <>
          {knownLine(
            describeStoppedLook(subject.nowText, subject.implementationLook),
          ) ? (
            <>
              <dt>どこまでやったか</dt>
              <dd>
                {describeStoppedLook(
                  subject.nowText,
                  subject.implementationLook,
                )}
                {knownLine(subject.driverNote) ? (
                  <span className="garden-inspect__driver">
                    {subject.driverNote}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {knownLine(subject.nextStep) ? (
            <>
              <dt>次はこんな感じか</dt>
              <dd>{subject.nextStep}</dd>
            </>
          ) : null}
        </>
      ) : (
        <>
          {subject.jobTitle && knownLine(subject.jobTitle) ? (
            <>
              <dt>仕事</dt>
              <dd>{subject.jobTitle}</dd>
            </>
          ) : null}
          {knownLine(subject.summary) ? (
            <>
              <dt>いま</dt>
              <dd>{subject.summary}</dd>
            </>
          ) : null}
        </>
      )}
    </dl>
  )
}

function knownLine(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return false
  }
  if (
    trimmed.includes('まだ分かっていません') ||
    trimmed.includes('変更元不明') ||
    trimmed.includes('の作業が始まりました') ||
    trimmed.includes('がファイルを扱っています') ||
    trimmed === '作業中' ||
    trimmed === '作業' ||
    trimmed === 'いまの作業の続き' ||
    trimmed === '次に動かすまで待つ'
  ) {
    return false
  }
  return true
}

function describeStoppedLook(
  nowText: string | null | undefined,
  implementationLook: string | null | undefined,
): string {
  const now = knownLine(nowText) ? nowText!.trim() : ''
  const look = knownLine(implementationLook) ? implementationLook!.trim() : ''
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
