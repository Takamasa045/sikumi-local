import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import { confirmUnregisterPlace } from '../../workspace/confirmUnregisterPlace'
import {
  collectPlaceResidents,
  describeImplementationLook,
  placeActivityLabel,
  sortPlaceResidents,
  type PlaceResident,
} from './placeResidents'

type PlaceResidentListProps = {
  readonly overview: TodayOverview | null
  readonly workspaces?: readonly Workspace[]
  readonly selectedRepositoryId?: string | null
  readonly onSelect: (repositoryId: string) => void
  readonly onUnregister?: (workspaceId: string) => void
}

export function PlaceResidentList({
  overview,
  workspaces = [],
  selectedRepositoryId = null,
  onSelect,
  onUnregister,
}: PlaceResidentListProps) {
  const residents = sortPlaceResidents(
    collectPlaceResidents(overview, workspaces),
  )

  return (
    <section className="observer-place-list" aria-label="○○番の一覧">
      <div className="observer-place-list__heading">
        <p className="section-kicker">観測している場所</p>
        <h3>○○番の一覧</h3>
        <p>
          動いている場所を先に、そのあと更新が新しい順に並べています。ここは作業を頼む場所ではなく、登録した場所を確認する場所です。
        </p>
      </div>
      {residents.length === 0 ? (
        <p className="observer-place-list__empty">
          登録した場所がまだありません。下の「フォルダを選ぶ」から追加してください。
        </p>
      ) : (
        <ul className="observer-place-list__rows" role="list">
          {residents.map((resident) => (
            <li key={resident.repositoryId}>
              <PlaceResidentRow
                resident={resident}
                selected={resident.repositoryId === selectedRepositoryId}
                onSelect={() => onSelect(resident.repositoryId)}
                {...(onUnregister
                  ? {
                      onUnregister: () => {
                        if (confirmUnregisterPlace()) {
                          onUnregister(resident.workspaceId)
                        }
                      },
                    }
                  : {})}
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
  onUnregister,
}: {
  readonly resident: PlaceResident
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onUnregister?: () => void
}) {
  const work = listedWork(resident)
  return (
    <div
      className={
        selected ? 'observer-place-row is-selected' : 'observer-place-row'
      }
    >
      <button
        type="button"
        className="observer-place-row__select"
        data-testid={`observer-place-${resident.repositoryId}`}
        data-working={resident.working ? 'true' : 'false'}
        data-waiting={resident.waiting ? 'true' : 'false'}
        onClick={onSelect}
      >
        <strong className="observer-place-row__name">
          {resident.placeName}
        </strong>
        <span className="observer-place-row__repo">
          {resident.repositoryName}
        </span>
        <span className="observer-place-row__status">
          {placeActivityLabel(resident)}
        </span>
        {work ? (
          <span className="observer-place-row__work">{work}</span>
        ) : null}
        {resident.lastObservedLabel ? (
          <small className="observer-place-row__observed">
            最後の観測: {resident.lastObservedLabel}
          </small>
        ) : null}
      </button>
      {onUnregister ? (
        <button
          type="button"
          className="observer-place-row__remove is-quiet"
          data-testid={`observer-place-unregister-${resident.workspaceId}`}
          onClick={onUnregister}
        >
          この場所を外す
        </button>
      ) : null}
    </div>
  )
}

function listedWork(resident: PlaceResident): string {
  const job = resident.lastObservedWork.trim()
  if (job) {
    return job
  }
  return describeImplementationLook(resident)
}

export default PlaceResidentList
