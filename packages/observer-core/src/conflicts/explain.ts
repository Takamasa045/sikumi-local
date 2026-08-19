import {
  OBSERVER_MAX_CONFLICT_EVIDENCE,
  OBSERVER_MAX_CONFLICT_REASONS,
} from '../limits.js'
import {
  conflictHeadline,
  displayNameForSource,
  scoreToConflictLevel,
  type AttributionConfidence,
  type ConflictEvidenceItem,
} from '../types.js'
import type { ConflictSide, ScoreHit } from './types.js'

const NAMED_CONFIDENCE = new Set<AttributionConfidence>(['verified', 'reported'])
const UNKNOWN_ACTOR_LABEL = '変更元不明'

export function canNameConflictActor(
  source: ConflictSide['source'] | null | undefined,
  confidence: AttributionConfidence | null | undefined,
): boolean {
  return Boolean(
    source &&
      source !== 'git' &&
      confidence &&
      NAMED_CONFIDENCE.has(confidence),
  )
}

export function safeActorLabel(
  source: ConflictSide['source'] | null | undefined,
  confidence: AttributionConfidence | null | undefined,
): string {
  if (!canNameConflictActor(source, confidence) || !source) {
    return UNKNOWN_ACTOR_LABEL
  }
  return displayNameForSource(source)
}

export function actorDisplayName(side: ConflictSide): string {
  return safeActorLabel(side.source, side.attributionConfidence)
}

export function pairActorPhrase(left: ConflictSide, right: ConflictSide): string {
  const leftName = actorDisplayName(left)
  const rightName = actorDisplayName(right)
  if (leftName === '変更元不明' && rightName === '変更元不明') {
    return '変更元不明の2つの作業'
  }
  if (leftName === rightName) {
    return `${leftName}の2つの作業`
  }
  return `${leftName}と${rightName}`
}

export function explainHits(
  left: ConflictSide,
  right: ConflictSide,
  hits: readonly ScoreHit[],
  score: number,
): {
  readonly headline: string
  readonly summary: string
  readonly recommendation: string
  readonly reasons: readonly string[]
  readonly evidence: readonly ConflictEvidenceItem[]
  readonly resources: readonly string[]
} {
  const level = scoreToConflictLevel(score)
  const headline = conflictHeadline(level)
  const actors = pairActorPhrase(left, right)
  const top = hits[0]
  const schemaApi = hits.some((item) => item.kind === 'schema-api')
  const deleteEdit = hits.some((item) => item.kind === 'delete-edit')
  const sameFile = hits.some(
    (item) =>
      item.kind === 'same-file' ||
      item.kind === 'same-schema' ||
      item.kind === 'same-api' ||
      item.kind === 'same-config' ||
      item.kind === 'same-package',
  )
  const resource = top?.resourceLabel ?? '作業中のファイル'

  const summary = deleteEdit
    ? `${headline} ${actors}が、同じファイルを一方は消し、もう一方は直しています`
    : schemaApi && level === 'caution'
      ? `${headline} 2つの作業が同じデータ構造に関係しています`
      : sameFile
        ? `${headline} ${actors}が同じ${resource}ファイルを変更しています`
        : level === 'related'
          ? `${headline} ${actors}の作業の一部が関係しています`
          : level === 'caution'
            ? `${headline} ${actors}の完了順を調整した方が安全です`
            : level === 'safe'
              ? headline
              : `${headline} ${actors}が同じ仕組みを変更しています`

  return {
    headline,
    summary: clip(summary, 280),
    recommendation: recommendationFor(level),
    reasons: hits.slice(0, OBSERVER_MAX_CONFLICT_REASONS).map((item) => item.label),
    evidence: hits.slice(0, OBSERVER_MAX_CONFLICT_EVIDENCE).map((item) => ({
      kind: item.kind,
      label: item.label,
      ...(item.leftPath ? { leftPath: item.leftPath } : {}),
      ...(item.rightPath ? { rightPath: item.rightPath } : {}),
    })),
    resources: unique(
      hits
        .map((item) => item.resourceLabel)
        .filter((value): value is string => Boolean(value)),
    ),
  }
}

export function recommendationFor(level: ReturnType<typeof scoreToConflictLevel>): string {
  switch (level) {
    case 'critical':
    case 'high':
      return '先に一方を仕上げてから、もう一方で最新の状態を確認してください。こちらから自動では取り込みません。'
    case 'caution':
      return '完了する順番を決めてから進めると安全です。こちらから自動操作はしません。'
    case 'related':
      return '関係がありそうなので、必要ならあとで見比べてください。自動操作はしません。'
    case 'safe':
      return '別々に進めてよさそうです。自動操作はしません。'
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max - 1)
}
