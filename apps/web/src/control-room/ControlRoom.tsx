import type { ControlPlaneSnapshot } from '../api/observer'
import {
  attentionKindLabel,
  attentionTone,
  degradedAdapterLabel,
  everydayText,
  placeLabel,
  placeNextText,
  placeNowText,
  relatedWorkSentence,
  summarizeControlPlane,
  toolLabel,
  workListText,
  workNextText,
  workNowText,
  type ControlRoomAttention,
  type ControlRoomPlace,
  type ControlRoomTechnical,
  type ControlRoomWork,
} from './copy'

export type ControlRoomSelectionKind = 'place' | 'work' | 'attention'

interface ControlRoomProps {
  readonly snapshot: ControlPlaneSnapshot | null
  readonly selectedKind: ControlRoomSelectionKind | null
  readonly selectedId: string | null
  readonly showTechnical: boolean
  readonly technical: ControlRoomTechnical | null
  readonly busy: boolean
  readonly onSelectPlace: (repositoryId: string) => void
  readonly onSelectWork: (workId: string) => void
  readonly onSelectAttention: (attentionId: string) => void
  readonly onToggleTechnical: () => void
  readonly onAcknowledge: (attentionId: string) => void
  readonly onCloseDetail: () => void
}

export function ControlRoom({
  snapshot,
  selectedKind,
  selectedId,
  showTechnical,
  technical,
  busy,
  onSelectPlace,
  onSelectWork,
  onSelectAttention,
  onToggleTechnical,
  onAcknowledge,
  onCloseDetail,
}: ControlRoomProps) {
  const summary = snapshot ? summarizeControlPlane(snapshot) : null
  const degraded = (snapshot?.observer.adapters ?? []).filter(
    (adapter) => adapter.source !== 'git' && adapter.status === 'degraded',
  )
  const selected = snapshot
    ? selectedSubject(snapshot, selectedKind, selectedId)
    : null

  return (
    <section className="observer-home control-room" aria-label="管制所">
      <p className="section-kicker">管制所</p>
      <h2>いまの様子</h2>
      <p className="observer-lead">
        誰がどこで何をしているかを見ます。動かすボタンはありません。
      </p>

      {summary ? (
        <div className="observer-stats" data-testid="control-room-summary">
          <span>動いているAI {summary.runningAiCount}</span>
          <span>場所 {summary.placeCount}</span>
          <span>注意 {summary.attentionCount}</span>
          <span>確認待ち {summary.waitingCount}</span>
        </div>
      ) : (
        <p className="observer-empty">いまの様子をまだ受け取っていません。</p>
      )}

      <section className="control-room-section" aria-label="確認が必要">
        <h3>確認が必要</h3>
        {snapshot && snapshot.attention.length > 0 ? (
          <ul className="control-room-list">
            {snapshot.attention.map((item) => (
              <li
                key={item.id}
                className="control-room-item"
                data-testid={`control-room-attention-${item.id}`}
                data-severity={attentionTone(item.severity)}
              >
                <button
                  type="button"
                  className="control-room-item__select"
                  onClick={() => onSelectAttention(item.id)}
                >
                  <strong>
                    {everydayText(item.title) ?? attentionKindLabel(item.kind)}
                  </strong>
                  <span>
                    {everydayAttentionSummary(item, snapshot.repositories)}
                  </span>
                </button>
                <button
                  type="button"
                  className="washi-tab"
                  disabled={busy}
                  onClick={() => onAcknowledge(item.id)}
                >
                  確認した
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="observer-empty">いま確認することはありません</p>
        )}
      </section>

      <section className="control-room-section" aria-label="動いている仕事">
        <h3>動いている仕事</h3>
        {snapshot &&
        snapshot.repositories.some((place) => place.works.length > 0) ? (
          <ul className="control-room-place-list">
            {snapshot.repositories.map((place) =>
              place.works.length === 0 ? null : (
                <li key={place.repositoryId} className="control-room-place">
                  <button
                    type="button"
                    className="control-room-place__name"
                    onClick={() => onSelectPlace(place.repositoryId)}
                  >
                    {place.displayName}
                  </button>
                  <ul className="control-room-work-list">
                    {place.works.map((work) => (
                      <li key={work.id}>
                        <button
                          type="button"
                          className="control-room-work"
                          onClick={() => onSelectWork(work.id)}
                        >
                          {workListText(work)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="observer-empty">いま動いている仕事はありません</p>
        )}
      </section>

      {degraded.length > 0 ? (
        <section className="control-room-section" aria-label="観測の健康">
          <h3>観測の健康</h3>
          <ul className="control-room-health">
            {degraded.map((adapter) => (
              <li key={adapter.source}>
                {degradedAdapterLabel(adapter.source)}の観測が弱くなっています
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? (
        <ControlRoomDetail
          subject={selected}
          snapshot={snapshot!}
          showTechnical={showTechnical}
          technical={technical}
          busy={busy}
          onToggleTechnical={onToggleTechnical}
          onAcknowledge={onAcknowledge}
          onClose={onCloseDetail}
        />
      ) : null}
    </section>
  )
}

function everydayAttentionSummary(
  item: ControlRoomAttention,
  repositories: readonly ControlRoomPlace[],
): string {
  const place = placeLabel(item.repositoryId, repositories)
  const summary = everydayText(item.summary) ?? attentionKindLabel(item.kind)
  const tool = toolLabel(item.source)
  if (place && tool) {
    return `${place} · ${tool} · ${summary}`
  }
  if (place) {
    return `${place} · ${summary}`
  }
  return summary
}

function selectedSubject(
  snapshot: ControlPlaneSnapshot,
  kind: ControlRoomSelectionKind | null,
  id: string | null,
):
  | { readonly kind: 'place'; readonly place: ControlRoomPlace }
  | { readonly kind: 'work'; readonly work: ControlRoomWork }
  | { readonly kind: 'attention'; readonly item: ControlRoomAttention }
  | null {
  if (!kind || !id) {
    return null
  }
  if (kind === 'place') {
    const place = snapshot.repositories.find((item) => item.repositoryId === id)
    return place ? { kind: 'place', place } : null
  }
  if (kind === 'work') {
    const work = snapshot.works.find((item) => item.id === id)
    return work ? { kind: 'work', work } : null
  }
  const item = snapshot.attention.find((attention) => attention.id === id)
  return item ? { kind: 'attention', item } : null
}

function ControlRoomDetail({
  subject,
  snapshot,
  showTechnical,
  technical,
  busy,
  onToggleTechnical,
  onAcknowledge,
  onClose,
}: {
  readonly subject: NonNullable<ReturnType<typeof selectedSubject>>
  readonly snapshot: ControlPlaneSnapshot
  readonly showTechnical: boolean
  readonly technical: ControlRoomTechnical | null
  readonly busy: boolean
  readonly onToggleTechnical: () => void
  readonly onAcknowledge: (attentionId: string) => void
  readonly onClose: () => void
}) {
  const title =
    subject.kind === 'place'
      ? subject.place.displayName
      : subject.kind === 'work'
        ? workListText(subject.work)
        : (everydayText(subject.item.title) ??
          attentionKindLabel(subject.item.kind))
  const label =
    subject.kind === 'place'
      ? '場所の様子'
      : subject.kind === 'work'
        ? '仕事の様子'
        : '確認が必要'
  const now =
    subject.kind === 'place'
      ? placeNowText(subject.place)
      : subject.kind === 'work'
        ? workNowText(subject.work)
        : (everydayText(subject.item.summary) ??
          attentionKindLabel(subject.item.kind))
  const next =
    subject.kind === 'place'
      ? placeNextText(subject.place)
      : subject.kind === 'work'
        ? workNextText(subject.work, snapshot.attention)
        : nextForAttention(subject.item)
  const attention = attentionFor(subject, snapshot)
  const related =
    subject.kind === 'work'
      ? relatedWorkSentence(subject.work, snapshot.works)
      : subject.kind === 'place'
        ? relatedForPlace(subject.place)
        : null
  const acknowledgeId =
    subject.kind === 'attention' ? subject.item.id : attention[0]?.id

  return (
    <aside
      className="control-room-detail"
      data-testid="control-room-detail"
      role="region"
      aria-label={label}
    >
      <div className="control-room-detail__head">
        <p className="section-kicker">{label}</p>
        <strong>{title}</strong>
        <button type="button" className="washi-tab" onClick={onClose}>
          閉じる
        </button>
      </div>
      <dl className="control-room-detail__facts">
        <div>
          <dt>いま</dt>
          <dd>{now}</dd>
        </div>
        <div>
          <dt>次</dt>
          <dd>{next}</dd>
        </div>
        <div>
          <dt>注意</dt>
          <dd>
            {attention.length > 0
              ? attention
                  .map(
                    (item) =>
                      everydayText(item.title) ?? attentionKindLabel(item.kind),
                  )
                  .join('、')
              : 'いま注意はありません'}
          </dd>
        </div>
        {related ? (
          <div>
            <dt>関係する仕事</dt>
            <dd>{related}</dd>
          </div>
        ) : null}
      </dl>
      <button
        type="button"
        className="washi-tab"
        aria-expanded={showTechnical}
        onClick={onToggleTechnical}
      >
        {showTechnical ? 'かんたん表示' : '技術の詳細を見る'}
      </button>
      {showTechnical ? (
        <dl
          className="control-room-technical"
          data-testid="control-room-technical"
        >
          <div>
            <dt>branch</dt>
            <dd>{technical?.branch ?? 'まだありません'}</dd>
          </div>
          <div>
            <dt>worktree</dt>
            <dd>{technical?.worktreePath ?? 'まだありません'}</dd>
          </div>
          <div>
            <dt>commit</dt>
            <dd>{technical?.commit ?? 'まだありません'}</dd>
          </div>
        </dl>
      ) : null}
      {acknowledgeId ? (
        <button
          type="button"
          className="washi-tab"
          disabled={busy}
          onClick={() => onAcknowledge(acknowledgeId)}
        >
          確認した
        </button>
      ) : null}
    </aside>
  )
}

function attentionFor(
  subject: NonNullable<ReturnType<typeof selectedSubject>>,
  snapshot: ControlPlaneSnapshot,
): readonly ControlRoomAttention[] {
  if (subject.kind === 'place') {
    return subject.place.attention
  }
  if (subject.kind === 'work') {
    return snapshot.attention.filter((item) =>
      item.workIds.includes(subject.work.id),
    )
  }
  return [subject.item]
}

function relatedForPlace(place: ControlRoomPlace): string | null {
  if (place.works.length < 2) {
    return null
  }
  return placeNowText(place)
}

function nextForAttention(item: ControlRoomAttention): string {
  if (item.kind === 'waiting-for-user') {
    return 'あなたの確認が必要です'
  }
  if (item.kind === 'conflict') {
    return 'ぶつからないか、先に見てください'
  }
  if (item.kind === 'stale-work') {
    return '続きがあるか、様子を見てください'
  }
  if (item.kind === 'observer-degraded') {
    return '観測のつなぎを見直してください'
  }
  return '誰の作業か、様子を見てください'
}
