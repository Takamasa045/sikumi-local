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
      readonly goal?: string | null
      readonly articleTitles?: readonly {
        readonly title: string
        readonly date?: string | null
      }[]
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
      <div className="garden-inspect__body">
        {subject.kind === 'character' ? (
          <CharacterBody subject={subject} />
        ) : (
          <StationBody subject={subject} />
        )}
      </div>
    </aside>
  )
}

function CharacterBody({
  subject,
}: {
  readonly subject: Extract<GardenInspectSubject, { kind: 'character' }>
}) {
  const hasProgress =
    subject.nowText !== undefined &&
    subject.implementationLook !== undefined &&
    subject.nextStep !== undefined
  const live = subject.live !== false
  const articles = knownArticleTitles(subject.articleTitles)
  return (
    <dl className="garden-inspect__facts">
      {subject.role && !hasProgress ? (
        <>
          <dt>役割</dt>
          <dd>{subject.role}</dd>
        </>
      ) : null}
      <dt>場所</dt>
      <dd>{describeInspectPlace(subject.station, subject.traveling)}</dd>
      {knownLine(subject.goal) ? (
        <>
          <dt>いまの仕事</dt>
          <dd>{subject.goal}</dd>
        </>
      ) : null}
      {hasProgress && live ? (
        <>
          {hasFactLines(subject.nowText) ? (
            <>
              <dt>いま</dt>
              <dd>
                <FactLines value={subject.nowText} />
                {knownLine(subject.driverNote) ? (
                  <span className="garden-inspect__driver">
                    {subject.driverNote}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {hasFactLines(subject.nextStep) ? (
            <>
              <dt>これから</dt>
              <dd>
                <FactLines value={subject.nextStep} />
              </dd>
            </>
          ) : null}
        </>
      ) : hasProgress ? (
        <>
          {hasFactLines(
            describeStoppedLook(subject.nowText, subject.implementationLook),
          ) ? (
            <>
              <dt>どこまでやったか</dt>
              <dd>
                <FactLines
                  value={describeStoppedLook(
                    subject.nowText,
                    subject.implementationLook,
                  )}
                />
                {knownLine(subject.driverNote) ? (
                  <span className="garden-inspect__driver">
                    {subject.driverNote}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
          {hasFactLines(subject.nextStep) ? (
            <>
              <dt>次はこんな感じか</dt>
              <dd>
                <FactLines value={subject.nextStep} />
              </dd>
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
          {hasFactLines(subject.summary) ? (
            <>
              <dt>いま</dt>
              <dd>
                <FactLines value={subject.summary} />
              </dd>
            </>
          ) : null}
        </>
      )}
      {articles.length > 0 ? (
        <>
          <dt>これまでの記事</dt>
          <dd>
            <ul className="garden-inspect__articles">
              {articles.map((article) => (
                <li key={`${article.date ?? ''}:${article.title}`}>
                  {article.date
                    ? `${article.date} ${article.title}`
                    : article.title}
                </li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
    </dl>
  )
}

function describeInspectPlace(
  station: GardenStationId,
  traveling: boolean,
): string {
  if (traveling) {
    switch (station) {
      case 'rest':
      case 'observatory':
        return '仕事の合間へ向かっています'
      case 'workbench':
        return '作業するところへ向かっています'
      case 'waiting':
        return '確認を待っています'
      case 'delivery':
        return '届ける場所へ向かっています'
      case 'archive':
        return '資料のところへ向かっています'
    }
  }
  switch (station) {
    case 'rest':
    case 'observatory':
      return '仕事の合間にいます'
    case 'workbench':
      return '作業しています'
    case 'waiting':
      return '確認を待っています'
    case 'delivery':
      return '届ける場所にいます'
    case 'archive':
      return '資料を見ています'
  }
}

function knownArticleTitles(
  values:
    | readonly { readonly title: string; readonly date?: string | null }[]
    | undefined,
): { readonly title: string; readonly date: string | null }[] {
  const seen = new Set<string>()
  const articles: { readonly title: string; readonly date: string | null }[] = []
  for (const item of values ?? []) {
    const title = item.title.trim()
    if (!knownLine(title) || seen.has(title)) {
      continue
    }
    seen.add(title)
    articles.push({
      title,
      date: item.date?.trim() || null,
    })
  }
  return articles
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
    /^[0-9a-f]{7,40}$/i.test(trimmed) ||
    /\.(md|ya?ml|log|ts|tsx|css|json)$/i.test(trimmed) ||
    /\b(SHA|commit|HEAD|origin)\b/i.test(trimmed) ||
    trimmed === '作業中' ||
    trimmed === '作業' ||
    trimmed === 'いまの作業の続き' ||
    trimmed === '次に動かすまで待つ'
  ) {
    return false
  }
  return true
}

function factLines(value: string | null | undefined): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const part of (value ?? '').split('\n')) {
    const trimmed = part.trim()
    if (!knownLine(trimmed) || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    lines.push(trimmed)
  }
  return lines
}

function hasFactLines(value: string | null | undefined): boolean {
  return factLines(value).length > 0
}

function FactLines({ value }: { readonly value: string | null | undefined }) {
  const lines = factLines(value)
  if (lines.length === 0) {
    return null
  }
  if (lines.length === 1) {
    return lines[0]
  }
  return (
    <span className="garden-inspect__lines">
      {lines.map((line) => (
        <span key={line} className="garden-inspect__line">
          {line}
        </span>
      ))}
    </span>
  )
}

function describeStoppedLook(
  nowText: string | null | undefined,
  implementationLook: string | null | undefined,
): string {
  const now = factLines(nowText)
  const look = factLines(implementationLook).filter(
    (line) => !now.includes(line),
  )
  return [...now, ...look].join('\n')
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
