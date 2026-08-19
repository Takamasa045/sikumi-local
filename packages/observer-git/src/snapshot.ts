import { existsSync, lstatSync } from 'node:fs'
import { basename } from 'node:path'
import {
  classifyChangedPath,
  clipList,
  OBSERVER_MAX_SNAPSHOT_FILES,
  type ObserverChangeType,
} from '@sikumi-local/observer-core'
import { runGit } from './exec.js'
import {
  resolveRepositoryBaseCommit,
  resolveWorktreeBaseCommit,
} from './merge-base.js'
import {
  readBlogArticleTitles,
  readBlogWorkStory,
  type BlogArticleTitle,
} from './blog-story.js'
import { readPlaceIntro } from './place-intro.js'
import { resolveExistingRoot } from './paths.js'
import {
  applyNameStatus,
  applyNumstat,
  parseStatusPorcelainV2,
  parseWorktreeList,
  type ChangedPath,
} from './status.js'

export interface GitWorktreeSnapshot {
  readonly path: string
  readonly isPrimary: boolean
  readonly branch: string | null
  readonly headCommit: string | null
  readonly baseCommit: string | null
  readonly changedFiles: readonly ChangedFileRecord[]
  readonly changedFileCount: number
  readonly truncated: boolean
}

export interface ChangedFileRecord {
  readonly path: string
  readonly previousPath: string | null
  readonly changeType: ObserverChangeType
  readonly addedLines: number | null
  readonly deletedLines: number | null
  readonly staged: boolean
  readonly untracked: boolean
  readonly category: string
  readonly label: string
  readonly hash: string | null
}

export interface GitSyncCounts {
  readonly outgoingCount: number | null
  readonly incomingCount: number | null
}

export const RAW_WORK_TITLE_LOOKBACK = 24

export interface GitRepositorySnapshot {
  readonly available: boolean
  readonly reason: string | null
  readonly repositoryRoot: string | null
  readonly displayName: string | null
  readonly branch: string | null
  readonly headCommit: string | null
  readonly baseCommit: string | null
  readonly latestRecordTitle: string | null
  readonly workStory: string | null
  readonly placeIntro: string | null
  readonly articleTitles: readonly BlogArticleTitle[]
  readonly workTitles: readonly string[]
  readonly outgoingCount: number | null
  readonly incomingCount: number | null
  readonly worktrees: readonly GitWorktreeSnapshot[]
  readonly changedFiles: readonly ChangedFileRecord[]
  readonly scannedAt: string
  readonly truncated: boolean
}

export function snapshotGitRepository(
  repositoryPath: string,
  now: () => string = () => new Date().toISOString(),
): GitRepositorySnapshot {
  const scannedAt = now()
  const unavailable = (reason: string): GitRepositorySnapshot => ({
    available: false,
    reason,
    repositoryRoot: null,
    displayName: null,
    branch: null,
    headCommit: null,
    baseCommit: null,
    latestRecordTitle: null,
    workStory: null,
    placeIntro: null,
    articleTitles: [],
    workTitles: [],
    outgoingCount: null,
    incomingCount: null,
    worktrees: [],
    changedFiles: [],
    scannedAt,
    truncated: false,
  })

  if (!existsSync(repositoryPath)) {
    return unavailable('missing')
  }
  try {
    if (!lstatSync(repositoryPath).isDirectory()) {
      return unavailable('not-directory')
    }
  } catch {
    return unavailable('unreadable')
  }

  const realRoot = resolveExistingRoot(repositoryPath)
  if (!realRoot) {
    return unavailable('unreadable')
  }

  const inside = runGit(realRoot, ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') {
    return unavailable('not-git')
  }

  const toplevel = runGit(realRoot, ['rev-parse', '--show-toplevel'])
  const root = toplevel ? resolveExistingRoot(toplevel) ?? realRoot : realRoot
  const branch = emptyToNull(runGit(root, ['branch', '--show-current']))
  const headCommit = emptyToNull(runGit(root, ['rev-parse', 'HEAD']))
  const baseCommit = resolveRepositoryBaseCommit(root, headCommit)
  const latestRecordTitle = readLatestRecordTitle(root)
  const sync = readSyncCounts(root)
  const worktreeOutput = runGit(root, ['worktree', 'list', '--porcelain']) ?? ''
  const listed = parseWorktreeList(worktreeOutput)
  const worktrees =
    listed.length > 0
      ? listed.map((item, index) =>
          snapshotWorktree(
            item.path,
            item.branch,
            item.head,
            index === 0,
            headCommit,
          ),
        )
      : [snapshotWorktree(root, branch, headCommit, true, headCommit)]

  return {
    available: true,
    reason: null,
    repositoryRoot: root,
    displayName: basename(root),
    branch,
    headCommit,
    baseCommit,
    latestRecordTitle,
    workStory: readBlogWorkStory(root, {
      changedPaths: worktrees.flatMap((worktree) =>
        worktree.changedFiles.map((file) => file.path),
      ),
    }),
    placeIntro: readPlaceIntro(root),
    articleTitles: readBlogArticleTitles(root),
    workTitles: readRecentRecordTitles(root),
    outgoingCount: sync.outgoingCount,
    incomingCount: sync.incomingCount,
    worktrees,
    changedFiles: worktrees.flatMap((worktree) => [...worktree.changedFiles]),
    scannedAt,
    truncated: worktrees.some((worktree) => worktree.truncated),
  }
}

function snapshotWorktree(
  path: string,
  branch: string | null,
  head: string | null,
  isPrimary: boolean,
  primaryHead: string | null,
): GitWorktreeSnapshot {
  const root = resolveExistingRoot(path) ?? path
  const status = runGit(root, ['status', '--porcelain=v2']) ?? ''
  const nameStatus =
    runGit(root, ['diff', '--name-status', 'HEAD'], { allowedFailure: true }) ?? ''
  const cachedNameStatus =
    runGit(root, ['diff', '--cached', '--name-status'], { allowedFailure: true }) ??
    ''
  const numstat =
    runGit(root, ['diff', '--numstat', 'HEAD'], { allowedFailure: true }) ?? ''
  const cachedNumstat =
    runGit(root, ['diff', '--cached', '--numstat'], { allowedFailure: true }) ?? ''

  let files = parseStatusPorcelainV2(status, root)
  files = applyNameStatus(files, `${nameStatus}\n${cachedNameStatus}`, root)
  files = applyNumstat(files, `${numstat}\n${cachedNumstat}`, root)
  const headCommit = head ?? emptyToNull(runGit(root, ['rev-parse', 'HEAD']))
  const bounded = clipList(files.map(toRecord), OBSERVER_MAX_SNAPSHOT_FILES)

  return {
    path: root,
    isPrimary,
    branch: branch ?? emptyToNull(runGit(root, ['branch', '--show-current'])),
    headCommit,
    baseCommit: resolveWorktreeBaseCommit(root, headCommit, primaryHead, isPrimary),
    changedFiles: bounded.items,
    changedFileCount: bounded.total,
    truncated: bounded.truncated,
  }
}

function toRecord(file: ChangedPath): ChangedFileRecord {
  const area = classifyChangedPath(file.path)
  return {
    ...file,
    category: area.category,
    label: area.label,
  }
}

export function readLatestRecordTitle(cwd: string): string | null {
  return emptyToNull(runGit(cwd, ['log', '-1', '--format=%s']))
}

export function readRecentRecordTitles(
  cwd: string,
  limit = RAW_WORK_TITLE_LOOKBACK,
): string[] {
  const take = Math.min(RAW_WORK_TITLE_LOOKBACK, Math.max(1, limit))
  const output = runGit(cwd, ['log', `-${take}`, '--format=%s'])
  if (!output) {
    return []
  }
  const seen = new Set<string>()
  const titles: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const title = line.trim()
    if (!title || seen.has(title)) {
      continue
    }
    seen.add(title)
    titles.push(title)
    if (titles.length >= take) {
      break
    }
  }
  return titles
}

export function readSyncCounts(cwd: string): GitSyncCounts {
  const output = runGit(
    cwd,
    ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
    { allowedFailure: true },
  )
  if (!output) {
    return { outgoingCount: null, incomingCount: null }
  }
  const match = /^(\d+)\s+(\d+)$/.exec(output)
  if (!match) {
    return { outgoingCount: null, incomingCount: null }
  }
  return {
    incomingCount: Number.parseInt(match[1]!, 10),
    outgoingCount: Number.parseInt(match[2]!, 10),
  }
}

function emptyToNull(value: string | null): string | null {
  if (!value || value.length === 0) {
    return null
  }
  return value
}
