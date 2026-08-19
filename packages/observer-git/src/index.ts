export { createGitObserverAdapter } from './adapter.js'
export { resolveGitExecutable, runGit } from './exec.js'
export {
  resolveDefaultBranchRef,
  resolveMergeBase,
  resolveRepositoryBaseCommit,
  resolveWorktreeBaseCommit,
} from './merge-base.js'
export {
  matchLongestObservedRoot,
  resolveExistingRoot,
  sanitizeRepoPath,
} from './paths.js'
export {
  readLatestRecordTitle,
  readSyncCounts,
  snapshotGitRepository,
  type ChangedFileRecord,
  type GitRepositorySnapshot,
  type GitSyncCounts,
  type GitWorktreeSnapshot,
} from './snapshot.js'
export {
  applyNameStatus,
  applyNumstat,
  parseStatusPorcelainV2,
  parseWorktreeList,
} from './status.js'
