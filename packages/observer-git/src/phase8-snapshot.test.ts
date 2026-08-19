import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OBSERVER_MAX_SNAPSHOT_FILES,
  analyzeRepositoryConflictsReport,
} from '@sikumi-local/observer-core'
import { snapshotGitRepository } from './snapshot.js'
import { parseStatusPorcelainV2 } from './status.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('phase 8 large repository snapshots', () => {
  it('parses thousands of porcelain paths without storing full diffs', () => {
    const started = Date.now()
    const lines = Array.from({ length: 5_000 }, (_, index) => {
      const path = `src/generated/file-${String(index).padStart(5, '0')}.ts`
      const hash = 'a'.repeat(40)
      return `1 .M N... 100644 100644 100644 ${hash} ${hash} ${path}`
    })
    const parsed = parseStatusPorcelainV2(lines.join('\n'), '/repo')
    expect(parsed.length).toBe(5_000)
    expect(parsed[0]?.hash).toMatch(/^[a-f0-9]+$/)
    expect(JSON.stringify(parsed)).not.toContain('diff --git')
    expect(JSON.stringify(parsed)).not.toContain('+added body')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('snapshots a temp git repo with thousands of changed files and reports truncation', () => {
    const repo = createGitRepo()
    const total = OBSERVER_MAX_SNAPSHOT_FILES + 250
    for (let index = 0; index < total; index += 1) {
      writeFileSync(
        join(repo, 'src', `file-${String(index).padStart(5, '0')}.ts`),
        `export const n = ${index}\n`,
      )
    }
    const started = Date.now()
    const snapshot = snapshotGitRepository(repo)
    expect(snapshot.available).toBe(true)
    expect(snapshot.worktrees[0]?.changedFileCount).toBe(total)
    expect(snapshot.worktrees[0]?.changedFiles.length).toBe(
      OBSERVER_MAX_SNAPSHOT_FILES,
    )
    expect(snapshot.worktrees[0]?.truncated).toBe(true)
    expect(snapshot.truncated).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('export const n =')
    expect(Date.now() - started).toBeLessThan(20_000)
  })

  it('caps conflict comparisons on huge irrelevant sets and warns', () => {
    const files = Array.from({ length: 800 }, (_, index) => ({
      path: `src/noise/file-${index}.ts`,
      changeType: 'modified' as const,
    }))
    const started = Date.now()
    const report = analyzeRepositoryConflictsReport({
      repositoryId: 'repo-huge',
      now: '2026-08-18T00:00:00.000Z',
      worktrees: [
        {
          path: '/tmp/left',
          branch: 'main',
          headCommit: 'aaa',
          baseCommit: null,
          files,
        },
        {
          path: '/tmp/right',
          branch: 'feature',
          headCommit: 'bbb',
          baseCommit: null,
          files: files.map((file) => ({
            ...file,
            path: file.path.replace('noise', 'other'),
          })),
        },
      ],
      sessions: [],
      claims: [],
    })
    expect(report.truncated).toBe(true)
    expect(report.warning).toContain('一部だけ')
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

function createGitRepo(): string {
  const directory = track(mkdtempSync(join(tmpdir(), 'sikumi-large-git-')))
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: directory })
  writeFileSync(join(directory, 'README.md'), '# large\n')
  mkdirSync(join(directory, 'src'), { recursive: true })
  writeFileSync(join(directory, 'src', '.gitkeep'), '')
  execFileSync('git', ['add', 'README.md', 'src/.gitkeep'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory })
  return directory
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
