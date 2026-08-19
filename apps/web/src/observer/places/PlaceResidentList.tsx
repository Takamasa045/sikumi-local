import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import {
  collectPlaceResidents,
  placeActivityLabel,
  type PlaceResident,
} from './placeResidents'

type PlaceResidentListProps = {
  readonly overview: TodayOverview | null
  readonly workspaces?: readonly Workspace[]
  readonly selectedRepositoryId?: string | null
  readonly variant?: 'page' | 'garden'
  readonly onSelect: (repositoryId: string) => void
}

export function PlaceResidentList({
  overview,
  workspaces = [],
  selectedRepositoryId = null,
  variant = 'page',
  onSelect,
}: PlaceResidentListProps) {
  const residents = collectPlaceResidents(overview, workspaces)
  const className =
    variant === 'garden'
      ? 'observer-place-list observer-place-list--garden'
      : 'observer-place-list'

  return (
    <section className={className} aria-label="○○番の一覧">
      <div className="observer-place-list__heading">
        <p className="section-kicker">観測している場所</p>
        <h3>○○番の一覧</h3>
        <p>
          登録した場所を並べて見ます。ここは作業を頼む場所ではなく、それぞれの様子を眺める場所です。
        </p>
      </div>
      {residents.length === 0 ? (
        <p className="observer-place-list__empty">
          {variant === 'garden'
            ? '登録した場所がまだありません。今日の作業場からフォルダを追加してください。'
            : '登録した場所がまだありません。下の欄からフォルダを追加してください。'}
        </p>
      ) : (
        <ul className="observer-place-list__rows" role="list">
          {residents.map((resident) => (
            <li key={resident.repositoryId}>
              <PlaceResidentRow
                resident={resident}
                selected={resident.repositoryId === selectedRepositoryId}
                onSelect={() => onSelect(resident.repositoryId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PlaceResidentRow({
  resident,
  selected,
  onSelect,
}: {
  readonly resident: PlaceResident
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={
        selected ? 'observer-place-row is-selected' : 'observer-place-row'
      }
      data-testid={`observer-place-${resident.repositoryId}`}
      data-working={resident.working ? 'true' : 'false'}
      data-waiting={resident.waiting ? 'true' : 'false'}
      onClick={onSelect}
    >
      <strong className="observer-place-row__name">{resident.placeName}</strong>
      <span className="observer-place-row__repo">
        {resident.repositoryName}
      </span>
      <span className="observer-place-row__status">
        {placeActivityLabel(resident)}
      </span>
      <span className="observer-place-row__work">
        {resident.lastObservedWork}
      </span>
      {resident.lastObservedLabel ? (
        <small className="observer-place-row__observed">
          最後の観測: {resident.lastObservedLabel}
        </small>
      ) : null}
    </button>
  )
}

export default PlaceResidentList
