import type { ObserverChangeType, ResourceAction } from '../types.js'
import {
  classifyConflictPath,
  directoryOf,
  normalizeConflictPath,
  packageNameOf,
  sharedSignificantTokens,
  type ClassifiedConflictPath,
} from './classify.js'
import type { ConflictClaimInput, ScoreHit } from './types.js'

export const CONFLICT_RULE_SCORES = {
  deleteEdit: 92,
  sameFile: 82,
  sameSchemaOrMigration: 80,
  sameApi: 80,
  sameConfig: 80,
  samePackageManifest: 80,
  generatedFile: 80,
  sameMigrationNumber: 80,
  schemaToApi: 68,
  importLink: 62,
  lockfile: 55,
  sameDirectory: 45,
  testPair: 42,
  readWrite: 38,
} as const

const WRITE_ACTIONS = new Set<ResourceAction>(['write', 'create', 'delete'])
const DELETE_TYPES = new Set<ObserverChangeType>(['deleted'])

export function effectiveClaims(
  claims: readonly ConflictClaimInput[],
): ConflictClaimInput[] {
  const observed = claims.filter((claim) => claim.claimKind === 'observed')
  const observedKeys = new Set(observed.flatMap((claim) => claimPathKeys(claim)))
  const planned = claims.filter((claim) => {
    if (claim.claimKind !== 'planned') {
      return false
    }
    return !claimPathKeys(claim).some((key) => observedKeys.has(key))
  })
  return [...observed, ...planned]
}

export function scoreClaimPair(
  left: ConflictClaimInput,
  right: ConflictClaimInput,
): ScoreHit[] {
  const leftPath = classifyConflictPath(left.resourceKey)
  const rightPath = classifyConflictPath(right.resourceKey)
  const hits: ScoreHit[] = []
  const same = isSameFile(left, right)
  const leftWrite = isWriteClaim(left)
  const rightWrite = isWriteClaim(right)

  if (same && isDeleteVersusEdit(left, right)) {
    hits.push(
      hit(
        'delete-edit',
        CONFLICT_RULE_SCORES.deleteEdit,
        `${leftPath.areaLabel}を、一方は消し、もう一方は直しています`,
        leftPath,
        rightPath,
      ),
    )
    return hits
  }

  if (same && isReadWritePair(left, right)) {
    hits.push(
      hit(
        'read-write',
        CONFLICT_RULE_SCORES.readWrite,
        `一方は${leftPath.areaLabel}を読み、もう一方は書いています`,
        leftPath,
        rightPath,
      ),
    )
    return hits
  }

  if (same && leftPath.class === 'lockfile') {
    hits.push(
      hit(
        'lockfile',
        CONFLICT_RULE_SCORES.lockfile,
        '同じ依存関係の記録ファイルを両方とも変更しています',
        leftPath,
        rightPath,
      ),
    )
    return hits
  }

  if (same && leftWrite && rightWrite) {
    if (leftPath.class === 'schema' || leftPath.class === 'migration') {
      hits.push(
        hit(
          'same-schema',
          CONFLICT_RULE_SCORES.sameSchemaOrMigration,
          `同じ${leftPath.areaLabel}を両方とも変更しています`,
          leftPath,
          rightPath,
        ),
      )
    } else if (leftPath.class === 'api') {
      hits.push(
        hit(
          'same-api',
          CONFLICT_RULE_SCORES.sameApi,
          '同じAPIの約束を両方とも変更しています',
          leftPath,
          rightPath,
        ),
      )
    } else if (leftPath.class === 'config') {
      hits.push(
        hit(
          'same-config',
          CONFLICT_RULE_SCORES.sameConfig,
          '同じ設定ファイルを両方とも変更しています',
          leftPath,
          rightPath,
        ),
      )
    } else if (leftPath.class === 'package-manifest') {
      hits.push(
        hit(
          'same-package',
          CONFLICT_RULE_SCORES.samePackageManifest,
          '同じ道具の一覧を両方とも変更しています',
          leftPath,
          rightPath,
        ),
      )
    } else if (leftPath.isGenerated) {
      hits.push(
        hit(
          'generated',
          CONFLICT_RULE_SCORES.generatedFile,
          '同じ自動生成ファイルを両方とも変更しています',
          leftPath,
          rightPath,
        ),
      )
    } else {
      hits.push(
        hit(
          'same-file',
          CONFLICT_RULE_SCORES.sameFile,
          `同じファイル（${leftPath.areaLabel}）を両方とも変更しています`,
          leftPath,
          rightPath,
        ),
      )
    }
    return hits
  }

  if (
    leftPath.migrationNumber &&
    leftPath.migrationNumber === rightPath.migrationNumber &&
    leftPath.path !== rightPath.path
  ) {
    hits.push(
      hit(
        'migration-number',
        CONFLICT_RULE_SCORES.sameMigrationNumber,
        `同じ番号のデータの形の変更（${leftPath.migrationNumber}）が重なっています`,
        leftPath,
        rightPath,
      ),
    )
  }

  const schemaApi = isSchemaApiPair(leftPath, rightPath)
  const shared = sharedSignificantTokens(leftPath, rightPath)
  if (schemaApi && shared.length > 0) {
    hits.push(
      hit(
        'schema-api',
        CONFLICT_RULE_SCORES.schemaToApi,
        `別ファイルですが、同じデータ構造（${shared[0]}）に関係しています`,
        leftPath,
        rightPath,
      ),
    )
  }

  if (isTestPair(leftPath, rightPath) && stemsAlign(leftPath, rightPath)) {
    hits.push(
      hit(
        'test-pair',
        CONFLICT_RULE_SCORES.testPair,
        '本体と、それを確認する仕組みを両方とも触っています',
        leftPath,
        rightPath,
      ),
    )
  }

  if (hasImportLink(left, right)) {
    hits.push(
      hit(
        'import-link',
        CONFLICT_RULE_SCORES.importLink,
        '一方が他方のファイルを参照しています',
        leftPath,
        rightPath,
      ),
    )
  }

  if (
    leftPath.directory === rightPath.directory &&
    leftPath.directory !== '.' &&
    !same
  ) {
    hits.push(
      hit(
        'same-directory',
        CONFLICT_RULE_SCORES.sameDirectory,
        `近い場所（${leftPath.areaLabel}）を両方とも触っています`,
        leftPath,
        rightPath,
      ),
    )
  }

  return hits
}

export function scoreSides(
  leftClaims: readonly ConflictClaimInput[],
  rightClaims: readonly ConflictClaimInput[],
): ScoreHit[] {
  const left = effectiveClaims(leftClaims)
  const right = effectiveClaims(rightClaims)
  const hits: ScoreHit[] = []
  for (const leftClaim of left) {
    for (const rightClaim of right) {
      hits.push(...scoreClaimPair(leftClaim, rightClaim))
    }
  }

  if (isCompletelySeparatePackage(left, right) && !hasCrossPackageLink(hits)) {
    return []
  }

  return strongestHits(hits)
}

export function strongestHits(hits: readonly ScoreHit[]): ScoreHit[] {
  const best = new Map<string, ScoreHit>()
  for (const item of hits) {
    const key = `${item.kind}:${item.leftPath ?? ''}:${item.rightPath ?? ''}`
    const current = best.get(key)
    if (!current || item.score > current.score) {
      best.set(key, item)
    }
  }
  return [...best.values()].sort((left, right) => right.score - left.score)
}

export function maxScore(hits: readonly ScoreHit[]): number {
  return hits.reduce((score, hit) => Math.max(score, hit.score), 0)
}

function isSameFile(left: ConflictClaimInput, right: ConflictClaimInput): boolean {
  const leftKeys = claimPathKeys(left)
  const rightKeys = new Set(claimPathKeys(right))
  return leftKeys.some((key) => rightKeys.has(key))
}

export function claimPathKeys(claim: ConflictClaimInput): string[] {
  const keys = [normalizeConflictPath(claim.resourceKey)]
  if (claim.previousPath) {
    keys.push(normalizeConflictPath(claim.previousPath))
  }
  return keys
}

function isWriteClaim(claim: ConflictClaimInput): boolean {
  return WRITE_ACTIONS.has(claim.action) || claim.changeType === 'deleted'
}

function isDeleteVersusEdit(
  left: ConflictClaimInput,
  right: ConflictClaimInput,
): boolean {
  const leftDeleted =
    left.action === 'delete' ||
    (left.changeType !== undefined && DELETE_TYPES.has(left.changeType))
  const rightDeleted =
    right.action === 'delete' ||
    (right.changeType !== undefined && DELETE_TYPES.has(right.changeType))
  return leftDeleted !== rightDeleted
}

function isReadWritePair(
  left: ConflictClaimInput,
  right: ConflictClaimInput,
): boolean {
  return (
    (left.action === 'read' && isWriteClaim(right)) ||
    (right.action === 'read' && isWriteClaim(left))
  )
}

function isSchemaApiPair(
  left: ClassifiedConflictPath,
  right: ClassifiedConflictPath,
): boolean {
  const classes = new Set([left.class, right.class])
  return (
    (classes.has('schema') || classes.has('migration')) && classes.has('api')
  )
}

function isTestPair(
  left: ClassifiedConflictPath,
  right: ClassifiedConflictPath,
): boolean {
  return (
    (left.class === 'test' && right.class !== 'test') ||
    (right.class === 'test' && left.class !== 'test')
  )
}

function stemsAlign(
  left: ClassifiedConflictPath,
  right: ClassifiedConflictPath,
): boolean {
  return left.stem.length > 0 && left.stem === right.stem
}

function hasImportLink(
  left: ConflictClaimInput,
  right: ConflictClaimInput,
): boolean {
  const leftPath = normalizeConflictPath(left.resourceKey)
  const rightPath = normalizeConflictPath(right.resourceKey)
  return (
    (left.importedPaths ?? []).some(
      (path) => normalizeConflictPath(path) === rightPath,
    ) ||
    (right.importedPaths ?? []).some(
      (path) => normalizeConflictPath(path) === leftPath,
    )
  )
}

function isCompletelySeparatePackage(
  left: readonly ConflictClaimInput[],
  right: readonly ConflictClaimInput[],
): boolean {
  const leftPackages = new Set(
    left.map((claim) => packageNameOf(claim.resourceKey)).filter(isString),
  )
  const rightPackages = new Set(
    right.map((claim) => packageNameOf(claim.resourceKey)).filter(isString),
  )
  if (leftPackages.size === 0 || rightPackages.size === 0) {
    return false
  }
  return [...leftPackages].every((name) => !rightPackages.has(name))
}

function hasCrossPackageLink(hits: readonly ScoreHit[]): boolean {
  return hits.some(
    (item) =>
      item.kind === 'schema-api' ||
      item.kind === 'import-link' ||
      item.kind === 'same-file' ||
      item.kind === 'delete-edit',
  )
}

function hit(
  kind: string,
  score: number,
  label: string,
  left: ClassifiedConflictPath,
  right: ClassifiedConflictPath,
): ScoreHit {
  return {
    kind,
    score,
    label,
    leftPath: left.path,
    rightPath: right.path,
    resourceLabel: left.areaLabel,
  }
}

function isString(value: string | null): value is string {
  return value !== null
}

export function directoriesOf(claims: readonly ConflictClaimInput[]): Set<string> {
  return new Set(claims.map((claim) => directoryOf(claim.resourceKey)))
}
