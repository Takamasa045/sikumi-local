import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createTemporaryGitRepository(options?: {
  readonly remoteUrl?: string
  readonly branch?: string
  readonly nestedDirectory?: string
}): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-git-'))
  const branch = options?.branch ?? 'main'

  execFileSync('git', ['init', '-b', branch], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: directory })
  writeFileSync(join(directory, 'README.md'), '# fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory })

  if (options?.remoteUrl) {
    execFileSync('git', ['remote', 'add', 'origin', options.remoteUrl], {
      cwd: directory,
    })
  }

  if (options?.nestedDirectory) {
    mkdirSync(join(directory, options.nestedDirectory), { recursive: true })
  }

  return realpathSync(directory)
}

export function createTemporaryDirectory(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'sikumi-local-data-')))
}
