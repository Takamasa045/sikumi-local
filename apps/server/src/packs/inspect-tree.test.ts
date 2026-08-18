import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { inspectDataOnlyTree } from './inspect-tree.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('data-only pack tree', () => {
  it('rejects symlinks, executables, hooks, and missing roots', () => {
    const root = track(createTemporaryDirectory())
    writeFileSync(join(root, 'world.yaml'), 'id: x\nversion: 1.0.0\n')
    expect(inspectDataOnlyTree(root).files).toBe(1)

    const linked = track(createTemporaryDirectory())
    writeFileSync(join(linked, 'world.yaml'), 'id: x\nversion: 1.0.0\n')
    symlinkSync(join(root, 'world.yaml'), join(linked, 'alias.yaml'))
    expect(() => inspectDataOnlyTree(linked)).toThrow(/symlink/)

    const execDir = track(createTemporaryDirectory())
    const script = join(execDir, 'note.txt')
    writeFileSync(script, 'hi')
    chmodSync(script, 0o755)
    expect(() => inspectDataOnlyTree(execDir)).toThrow(/executable/)

    const hookish = track(createTemporaryDirectory())
    writeFileSync(join(hookish, '.gitmodules'), 'bad')
    expect(() => inspectDataOnlyTree(hookish)).toThrow(/data-only|git/)

    expect(() => inspectDataOnlyTree(join(root, 'missing'))).toThrow(
      /not found/,
    )
  })

  it('rejects .git and hidden sensitive files instead of skipping them', () => {
    const withGit = track(createTemporaryDirectory())
    writeFileSync(join(withGit, 'world.yaml'), 'id: x\nversion: 1.0.0\n')
    mkdirSync(join(withGit, '.git'))
    writeFileSync(join(withGit, '.git', 'config'), 'bad')
    expect(() => inspectDataOnlyTree(withGit)).toThrow(/data-only|forbidden/)

    for (const name of ['.env', '.env.local', '.npmrc', '.netrc', 'id_rsa']) {
      const root = track(createTemporaryDirectory())
      writeFileSync(join(root, 'world.yaml'), 'id: x\nversion: 1.0.0\n')
      writeFileSync(join(root, name), 'secret')
      expect(() => inspectDataOnlyTree(root)).toThrow(/data-only|forbidden/)
    }

    const creds = track(createTemporaryDirectory())
    writeFileSync(join(creds, 'world.yaml'), 'id: x\nversion: 1.0.0\n')
    mkdirSync(join(creds, 'credentials'))
    writeFileSync(join(creds, 'credentials', 'token'), 'secret')
    expect(() => inspectDataOnlyTree(creds)).toThrow(/data-only|forbidden/)

    const key = track(createTemporaryDirectory())
    writeFileSync(join(key, 'world.yaml'), 'id: x\nversion: 1.0.0\n')
    writeFileSync(join(key, 'tls.pem'), '-----BEGIN PRIVATE KEY-----')
    expect(() => inspectDataOnlyTree(key)).toThrow(/data-only|forbidden/)
  })
})

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
