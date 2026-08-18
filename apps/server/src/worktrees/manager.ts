import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import {
  AppError,
  textContainsSecrets,
  type DirtyWorktreePolicy,
  type JobWorktree,
} from '@sikumi-local/core'
import { persistJobArtifactFile } from '../artifacts/persist.js'
import { runGit, runGitWithStdin } from '../git/exec.js'
import type { AppStore } from '../storage/store.js'
import {
  assertInsideDataDirectory,
  assertInsideWorktreesRoot,
  assertSafeBranchName,
  exportsRoot,
  resolveContainedDirectory,
  worktreeBranchName,
  worktreeRelPath,
  worktreesRoot,
} from './paths.js'

const SECRET_BASENAME =
  /^(\.env(\..*)?|\.npmrc|\.netrc|\.git-credentials|\.pem|\.key|id_rsa|id_ed25519|id_ecdsa|credentials(\..*)?|secrets?(\..*)?|.*\.(pem|key|p12|pfx|asc))$/i
const SECRET_DIRECTORY = /(^|\/)(\.ssh|\.aws|\.gnupg|credentials)(\/|$)/i
const MAX_DIRTY_PATCH_BYTES = 256 * 1024

export interface RepositoryGitState {
  readonly dirty: boolean
  readonly head: string
  readonly porcelain: string
}

export interface PreparedWorktree {
  readonly record: JobWorktree
  readonly cwd: string
}

export interface WorktreeDiff {
  readonly summary: string
  readonly files: readonly string[]
  readonly patch: string
}

const writeJobLocks = new Map<string, string>()

export function inspectRepositoryGitState(
  repoPath: string,
): RepositoryGitState {
  const head = runGit(repoPath, ['rev-parse', 'HEAD'])
  const porcelain = runGit(repoPath, ['status', '--porcelain'])
  return {
    dirty: porcelain.length > 0,
    head,
    porcelain,
  }
}

export function prepareJobWorktree(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly jobId: string
  readonly employeeId: string
  readonly repositoryId: string
  readonly repositoryPath: string
  readonly policy?: DirtyWorktreePolicy
}): PreparedWorktree {
  const repoPath = input.repositoryPath
  const state = inspectRepositoryGitState(repoPath)
  if (state.dirty && !input.policy) {
    throw new AppError(
      'WORKTREE_DIRTY_REPO',
      '現在の作業ディレクトリに未commitの変更があります',
      409,
      {
        dirty: true,
        options: ['from-head', 'include-dirty-patch', 'cancel'],
      },
    )
  }
  if (input.policy === 'cancel') {
    throw new AppError('WORKTREE_CANCELLED', 'Worktree作成を中止しました', 409)
  }

  const existing = input.store.getJobWorktreeByJobId(input.jobId)
  if (
    existing &&
    (existing.status === 'prepared' || existing.status === 'active')
  ) {
    throw new AppError(
      'WORKTREE_CONFLICT',
      'このWorktreeはすでに実行中です',
      409,
    )
  }

  const activeOnRepo = input.store
    .listActiveWriteWorktrees()
    .find((record) => record.repositoryId === input.repositoryId)
  if (activeOnRepo) {
    throw new AppError(
      'WORKTREE_CONFLICT',
      '同じRepositoryで書き込みJobが実行中です',
      409,
    )
  }

  const branch = worktreeBranchName(input.employeeId, input.jobId)
  const relPath = worktreeRelPath(input.repositoryId, input.jobId)
  const absolute = resolveContainedDirectory(input.dataDirectory, relPath)
  assertInsideWorktreesRoot(dirname(absolute), input.dataDirectory)
  if (existsSync(absolute)) {
    throw new AppError(
      'WORKTREE_CONFLICT',
      '同じWorktreeがすでに存在します',
      409,
    )
  }

  const lockKey = `${input.repositoryId}:${relPath}`
  if (writeJobLocks.has(lockKey)) {
    throw new AppError(
      'WORKTREE_CONFLICT',
      '同じWorktreeを同時実行できません',
      409,
    )
  }
  writeJobLocks.set(lockKey, input.jobId)

  mkdirSync(worktreesRoot(input.dataDirectory), {
    recursive: true,
    mode: 0o700,
  })
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 })

  try {
    runGit(repoPath, ['worktree', 'add', '-b', branch, absolute, state.head])
    const created = assertInsideWorktreesRoot(absolute, input.dataDirectory)
    if (input.policy === 'include-dirty-patch' && state.dirty) {
      applySafeDirtyPatch(repoPath, created)
    }
    const now = new Date().toISOString()
    const record = input.store.insertJobWorktree({
      id: randomUUID(),
      jobId: input.jobId,
      repositoryId: input.repositoryId,
      worktreeRelPath: relPath,
      branchName: branch,
      baseCommit: state.head,
      includeDirtyPatch: input.policy === 'include-dirty-patch',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    return { record, cwd: created }
  } catch (error) {
    writeJobLocks.delete(lockKey)
    cleanupFailedWorktree(repoPath, absolute, branch)
    if (error instanceof AppError) {
      throw error
    }
    throw new AppError(
      'WORKTREE_CREATE_FAILED',
      'Worktreeを作成できませんでした',
      500,
    )
  }
}

export function releaseWorktreeLock(
  repositoryId: string,
  relPath: string,
): void {
  writeJobLocks.delete(`${repositoryId}:${relPath}`)
}

export function collectWorktreeDiff(input: {
  readonly repositoryPath: string
  readonly worktreePath: string
  readonly baseCommit: string
}): WorktreeDiff {
  const pending = listChangedPaths(input.worktreePath, input.baseCommit)
  assertNoSecretPaths(pending)
  runGit(input.worktreePath, ['add', '-A'])
  const files = runGit(input.worktreePath, [
    'diff',
    '--cached',
    '--name-only',
    input.baseCommit,
  ])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  assertNoSecretPaths(files)
  const patch = runGit(
    input.worktreePath,
    ['diff', '--cached', '--binary', input.baseCommit],
    { trim: false },
  )
  assertNoSecretContent(patch)
  const stat = runGit(input.worktreePath, [
    'diff',
    '--cached',
    '--stat',
    input.baseCommit,
  ])
  assertNoSecretContent(stat)
  return {
    summary: stat.length > 0 ? stat : '変更はありません',
    files,
    patch,
  }
}

export function persistWorktreeArtifacts(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly jobId: string
  readonly repositoryPath: string
}): void {
  const record = input.store.getJobWorktreeByJobId(input.jobId)
  if (!record) {
    return
  }
  const worktreePath = resolveContainedDirectory(
    input.dataDirectory,
    record.worktreeRelPath,
  )
  if (!existsSync(worktreePath)) {
    return
  }
  const diff = collectWorktreeDiff({
    repositoryPath: input.repositoryPath,
    worktreePath,
    baseCommit: record.baseCommit,
  })
  const now = new Date().toISOString()
  const diffId = randomUUID()
  const patchId = randomUUID()
  const diffPath = persistJobArtifactFile({
    dataDirectory: input.dataDirectory,
    jobId: input.jobId,
    artifactId: diffId,
    artifactType: 'code_diff',
    title: 'コード差分',
    content: diff.summary,
  })
  const patchPath = persistJobArtifactFile({
    dataDirectory: input.dataDirectory,
    jobId: input.jobId,
    artifactId: patchId,
    artifactType: 'patch',
    title: '変更パッチ',
    content: diff.patch,
  })
  input.store.insertArtifact({
    id: diffId,
    jobId: input.jobId,
    type: 'code_diff',
    title: 'コード差分',
    storagePath: diffPath,
    createdAt: now,
  })
  input.store.insertArtifact({
    id: patchId,
    jobId: input.jobId,
    type: 'patch',
    title: '変更パッチ',
    storagePath: patchPath,
    createdAt: now,
  })
  input.store.updateJobWorktree(record.id, {
    status: 'completed',
    updatedAt: now,
  })
}

export function applyWorktreeToCurrentTree(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly jobId: string
  readonly repositoryPath: string
  readonly confirm: true
}): JobWorktree {
  const record = requireWorktree(input.store, input.jobId)
  if (record.status === 'applied') {
    throw new AppError(
      'WORKTREE_APPLY_FAILED',
      'この変更はすでに適用済みです',
      409,
    )
  }
  if (record.status === 'discarded') {
    throw new AppError(
      'WORKTREE_APPLY_FAILED',
      '破棄した変更は適用できません',
      409,
    )
  }
  const current = inspectRepositoryGitState(input.repositoryPath)
  if (current.dirty) {
    throw new AppError(
      'WORKTREE_TARGET_DIRTY',
      '作業ツリーに未commitの変更があるため適用できません',
      409,
    )
  }
  if (current.head !== record.baseCommit) {
    throw new AppError(
      'WORKTREE_APPLY_FAILED',
      '適用先HEADがWorktree作成時のbase commitと一致しません',
      409,
    )
  }
  const worktreePath = resolveExistingWorktree(
    input.dataDirectory,
    record.worktreeRelPath,
  )
  const diff = collectWorktreeDiff({
    repositoryPath: input.repositoryPath,
    worktreePath,
    baseCommit: record.baseCommit,
  })
  if (diff.patch.trim().length === 0) {
    const now = new Date().toISOString()
    return input.store.updateJobWorktree(record.id, {
      status: 'applied',
      updatedAt: now,
    })
  }
  const check = tryGit(
    input.repositoryPath,
    ['apply', '--check', '--whitespace=nowarn', '-'],
    diff.patch,
  )
  if (!check.ok) {
    throw new AppError(
      'WORKTREE_APPLY_FAILED',
      '現在のbranchへ安全に適用できませんでした',
      409,
    )
  }
  const applied = tryGit(
    input.repositoryPath,
    ['apply', '--whitespace=nowarn', '-'],
    diff.patch,
  )
  if (!applied.ok) {
    throw new AppError(
      'WORKTREE_APPLY_FAILED',
      '現在のbranchへ安全に適用できませんでした',
      409,
    )
  }
  return input.store.updateJobWorktree(record.id, {
    status: 'applied',
    updatedAt: new Date().toISOString(),
  })
}

export function discardJobWorktree(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly jobId: string
  readonly repositoryPath: string
  readonly confirm: true
}): JobWorktree {
  const record = requireWorktree(input.store, input.jobId)
  const worktreePath = join(input.dataDirectory, record.worktreeRelPath)
  const branch = assertSafeBranchName(record.branchName)
  if (existsSync(worktreePath)) {
    const contained = assertInsideWorktreesRoot(
      worktreePath,
      input.dataDirectory,
    )
    const removed = tryGit(input.repositoryPath, [
      'worktree',
      'remove',
      '--force',
      contained,
    ])
    if (!removed.ok) {
      throw new AppError(
        'WORKTREE_DISCARD_FAILED',
        'Worktreeを安全に削除できませんでした',
        500,
      )
    }
    if (existsSync(contained)) {
      rmSync(contained, { recursive: true, force: true })
    }
  }
  const branchDeleted = tryGit(input.repositoryPath, ['branch', '-D', branch])
  if (!branchDeleted.ok && branchExists(input.repositoryPath, branch)) {
    throw new AppError(
      'WORKTREE_DISCARD_FAILED',
      'Worktree branchを安全に削除できませんでした',
      500,
    )
  }
  releaseWorktreeLock(record.repositoryId, record.worktreeRelPath)
  return input.store.updateJobWorktree(record.id, {
    status: 'discarded',
    updatedAt: new Date().toISOString(),
  })
}

export function keepJobWorktreeBranch(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly jobId: string
  readonly repositoryPath: string
  readonly confirm: true
}): JobWorktree {
  const record = requireWorktree(input.store, input.jobId)
  const worktreePath = join(input.dataDirectory, record.worktreeRelPath)
  if (existsSync(worktreePath)) {
    assertInsideWorktreesRoot(worktreePath, input.dataDirectory)
  }
  releaseWorktreeLock(record.repositoryId, record.worktreeRelPath)
  return input.store.updateJobWorktree(record.id, {
    status: 'kept',
    updatedAt: new Date().toISOString(),
  })
}

export function exportArtifactPatch(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly artifactId: string
  readonly confirm: true
}): { readonly exportRelPath: string } {
  const artifact = input.store.getArtifact(input.artifactId)
  if (!artifact || !artifact.storagePath) {
    throw new AppError('NOT_FOUND', '成果が見つかりません', 404)
  }
  if (artifact.type !== 'patch' && artifact.type !== 'code_diff') {
    throw new AppError('VALIDATION_FAILED', 'この成果は書き出せません', 400)
  }
  const source = assertInsideDataDirectory(
    artifact.storagePath,
    input.dataDirectory,
  )
  const contents = readFileSync(source, 'utf8')
  assertNoSecretContent(contents)
  const root = exportsRoot(input.dataDirectory)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const relPath = join('exports', `${artifact.jobId}-${artifact.id}.patch`)
  const target = join(input.dataDirectory, relPath)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, contents, { mode: 0o600 })
  return { exportRelPath: relPath.split('\\').join('/') }
}

export function describeJobWorktree(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly jobId: string
  readonly repositoryPath: string
}) {
  const record = requireWorktree(input.store, input.jobId)
  let diff: WorktreeDiff = {
    summary: '差分はまだありません',
    files: [],
    patch: '',
  }
  const absolute = join(input.dataDirectory, record.worktreeRelPath)
  if (existsSync(absolute)) {
    diff = collectWorktreeDiff({
      repositoryPath: input.repositoryPath,
      worktreePath: assertInsideWorktreesRoot(absolute, input.dataDirectory),
      baseCommit: record.baseCommit,
    })
  }
  return {
    worktree: {
      jobId: record.jobId,
      branchName: record.branchName,
      baseCommit: record.baseCommit,
      status: record.status,
      includeDirtyPatch: record.includeDirtyPatch,
    },
    diff: {
      summary: diff.summary,
      files: diff.files,
      patch: diff.patch,
    },
  }
}

function requireWorktree(store: AppStore, jobId: string): JobWorktree {
  const record = store.getJobWorktreeByJobId(jobId)
  if (!record) {
    throw new AppError('WORKTREE_NOT_FOUND', 'Worktreeが見つかりません', 404)
  }
  return record
}

function resolveExistingWorktree(
  dataDirectory: string,
  relPath: string,
): string {
  const absolute = join(dataDirectory, relPath)
  if (!existsSync(absolute)) {
    throw new AppError('WORKTREE_NOT_FOUND', 'Worktreeが見つかりません', 404)
  }
  return assertInsideWorktreesRoot(absolute, dataDirectory)
}

function applySafeDirtyPatch(repoPath: string, worktreePath: string): void {
  const changed = runGit(repoPath, ['diff', '--name-only', 'HEAD'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const untracked = runGit(repoPath, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  assertNoSecretPaths([...changed, ...untracked])
  const patch = runGit(repoPath, ['diff', '--binary', 'HEAD'], { trim: false })
  if (patch.length > MAX_DIRTY_PATCH_BYTES) {
    throw new AppError('WORKTREE_CREATE_FAILED', '一時Patchが大きすぎます', 400)
  }
  assertNoSecretContent(patch)
  if (patch.trim().length > 0) {
    const check = tryGit(
      worktreePath,
      ['apply', '--check', '--whitespace=nowarn', '-'],
      patch,
    )
    if (!check.ok) {
      throw new AppError(
        'WORKTREE_CREATE_FAILED',
        '一時Patchを安全に適用できません',
        400,
      )
    }
    const applied = tryGit(
      worktreePath,
      ['apply', '--whitespace=nowarn', '-'],
      patch,
    )
    if (!applied.ok) {
      throw new AppError(
        'WORKTREE_CREATE_FAILED',
        '一時Patchを安全に適用できません',
        400,
      )
    }
  }
  copyUntrackedFiles(repoPath, worktreePath, untracked)
}

function copyUntrackedFiles(
  repoPath: string,
  worktreePath: string,
  untracked: readonly string[],
): void {
  let total = 0
  for (const relative of untracked) {
    if (
      relative.includes('\0') ||
      relative.startsWith('/') ||
      relative.split(/[/\\]/).includes('..')
    ) {
      throw new AppError(
        'WORKTREE_CREATE_FAILED',
        '一時Patchのパスが安全ではありません',
        400,
      )
    }
    const source = join(repoPath, relative)
    const dest = resolve(worktreePath, relative)
    const root = resolve(worktreePath)
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new AppError(
        'WORKTREE_CREATE_FAILED',
        '一時Patchのパスが安全ではありません',
        400,
      )
    }
    let sourceStat
    try {
      sourceStat = lstatSync(source)
    } catch {
      continue
    }
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new AppError(
        'WORKTREE_CREATE_FAILED',
        '一時Patchにsymlinkや特殊ファイルは含められません',
        400,
      )
    }
    total += sourceStat.size
    if (total > MAX_DIRTY_PATCH_BYTES) {
      throw new AppError(
        'WORKTREE_CREATE_FAILED',
        '一時Patchが大きすぎます',
        400,
      )
    }
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
    copyFileSync(source, dest)
  }
}

function cleanupFailedWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
): void {
  tryGit(repoPath, ['worktree', 'remove', '--force', worktreePath])
  tryGit(repoPath, ['branch', '-D', branch])
  if (existsSync(worktreePath) && !lstatSync(worktreePath).isSymbolicLink()) {
    rmSync(worktreePath, { recursive: true, force: true })
  }
}

function tryGit(
  cwd: string,
  args: readonly string[],
  stdin?: string,
): { ok: boolean } {
  try {
    if (stdin === undefined) {
      runGit(cwd, args)
      return { ok: true }
    }
    runGitWithStdin(cwd, args, stdin)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

function branchExists(repoPath: string, branch: string): boolean {
  return tryGit(repoPath, ['rev-parse', '--verify', '--quiet', branch]).ok
}

function listChangedPaths(worktreePath: string, baseCommit: string): string[] {
  const tracked = runGit(worktreePath, ['diff', '--name-only', baseCommit])
  const untracked = runGit(worktreePath, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ])
  return [...tracked.split('\n'), ...untracked.split('\n')]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function assertNoSecretPaths(paths: readonly string[]): void {
  const secret = paths.find((path) => isSecretFileName(path))
  if (secret) {
    throw new AppError(
      'WORKTREE_UNSAFE_DIFF',
      '秘密ファイルを含む差分は扱えません',
      400,
    )
  }
}

function assertNoSecretContent(value: string): void {
  if (textContainsSecrets(value)) {
    throw new AppError(
      'WORKTREE_UNSAFE_DIFF',
      '秘密らしい値を含む差分は扱えません',
      400,
    )
  }
}

export function isSecretFileName(path: string): boolean {
  const normalized = path.split('\\').join('/')
  if (SECRET_DIRECTORY.test(normalized)) {
    return true
  }
  const base = normalized.split('/').pop() ?? normalized
  return SECRET_BASENAME.test(base)
}
