import {
  analyzeRepositoryConflicts,
  reconcileConflictFindings,
  type ConflictFinding,
} from '@sikumi-local/observer-core'
import {
  resolveMergeBase,
  type ChangedFileRecord,
} from '@sikumi-local/observer-git'
import type { CombinedStore } from '../storage/store.js'

export function refreshConflicts(
  store: CombinedStore,
  repositoryId: string,
  worktrees: ReadonlyArray<{
    readonly path: string
    readonly branch: string | null
    readonly headCommit: string | null
    readonly baseCommit: string | null
    readonly files: readonly ChangedFileRecord[]
  }>,
  now: string,
): ConflictFinding[] {
  const repository = store.getRegisteredRepository(repositoryId)
  const analyzed = analyzeRepositoryConflicts({
    repositoryId,
    worktrees: worktrees.map((worktree) => ({
      path: worktree.path,
      branch: worktree.branch,
      headCommit: worktree.headCommit,
      baseCommit: worktree.baseCommit,
      files: worktree.files.map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        changeType: file.changeType,
      })),
    })),
    sessions: store.listExternalSessions({ repositoryId }),
    claims: store.listResourceClaims({ repositoryId }),
    now,
    commonBaseForPair: (left, right) => {
      const cwd = repository?.absolutePath ?? left.worktreePath ?? right.worktreePath
      if (!cwd) {
        return null
      }
      return resolveMergeBase(cwd, left.headCommit, right.headCommit)
    },
  })
  const next = reconcileConflictFindings({
    existing: store.listConflicts({ repositoryId }),
    analyzed,
    now,
  })
  for (const finding of next) {
    store.upsertConflict(finding)
  }
  return next
}
