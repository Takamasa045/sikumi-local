export const OBSERVER_MAX_EVENT_BYTES = 16_384
export const OBSERVER_MAX_BATCH_COUNT = 50
export const OBSERVER_MAX_BATCH_BYTES = 256 * 1024
export const OBSERVER_MAX_SUMMARY_CHARS = 280
export const OBSERVER_MAX_PAYLOAD_KEYS = 32
export const OBSERVER_MAX_PAYLOAD_VALUE = 2_048
export const OBSERVER_MAX_PATH_CHARS = 4_096
export const OBSERVER_HUB_RECENT_LIMIT = 200
export const OBSERVER_MAX_SPOOL_FILE_BYTES = 256 * 1024
export const OBSERVER_MAX_SPOOL_FILE_LINES = 500
export const OBSERVER_MAX_SPOOL_FILES_PER_SWEEP = 5_000
export const OBSERVER_MAX_SPOOL_EVENTS_PER_SWEEP = 2_000
export const OBSERVER_MAX_SNAPSHOT_FILES = 2_000
export const OBSERVER_MAX_CONFLICT_CLAIMS_PER_SIDE = 400
export const OBSERVER_MAX_CONFLICT_PAIR_COMPARISONS = 2_000
export const OBSERVER_MAX_CONFLICT_EVIDENCE = 20
export const OBSERVER_MAX_CONFLICT_REASONS = 8
export const OBSERVER_UI_MAX_FILES = 40
export const OBSERVER_UI_MAX_SESSIONS = 50
export const OBSERVER_UI_MAX_CONFLICTS = 100
export const OBSERVER_UI_MAX_REPOSITORIES = 100
export const OBSERVER_API_DEFAULT_LIST_LIMIT = 100
export const OBSERVER_API_MAX_LIST_LIMIT = 200
export const OBSERVER_STALE_AFTER_MS = 30 * 60_000
export const OBSERVER_SCAN_DEBOUNCE_MS = 500
export const OBSERVER_SCAN_THROTTLE_MS = 2_000
export const OBSERVER_CONSISTENCY_INTERVAL_MS = 30_000
export const OBSERVER_GIT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024
export const OBSERVER_LIVE_SESSION_MAX_AGE_MS = 10 * 60_000
export const OBSERVER_LIVE_SCAN_THROTTLE_MS = 5_000
export const OBSERVER_LIVE_MAX_SESSION_FILES = 40
export const OBSERVER_LIVE_MAX_FILE_BYTES = 16_384

export const OBSERVER_TRUNCATED_WARNING =
  '変更が多すぎるため、一部だけを比べ・表示しています。件数の合計は残しています。'

export function clipList<T>(
  items: readonly T[],
  limit: number,
): {
  readonly items: readonly T[]
  readonly total: number
  readonly truncated: boolean
} {
  const total = items.length
  const safeLimit = Math.max(0, limit)
  if (total <= safeLimit) {
    return { items, total, truncated: false }
  }
  return {
    items: items.slice(0, safeLimit),
    total,
    truncated: true,
  }
}
