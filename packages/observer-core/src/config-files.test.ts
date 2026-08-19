import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyFilePlans,
  cloneJson,
  commandFromHookEntry,
  formatJson,
  hookCommandMatches,
  isHookEntryOurs,
  isPlainObject,
  previewForFiles,
  readJsonObject,
  readTextIfExists,
  restoreFile,
  toSafeHookCommand,
  unquoteHookCommand,
  writeJsonAtomic,
} from './config-files.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function trackDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-config-'))
  tempDirectories.push(directory)
  return directory
}

describe('config-files helpers', () => {
  it('rejects unsafe hook commands and accepts an existing starred path', () => {
    expect(toSafeHookCommand('relative/hook.mjs')).toBeNull()
    expect(toSafeHookCommand('/tmp/hook\0.mjs')).toBeNull()
    expect(toSafeHookCommand('/tmp/../etc/passwd')).toBeNull()
    expect(toSafeHookCommand('/tmp/hook$(id).mjs')).toBeNull()
    expect(toSafeHookCommand('/tmp/not-there*/hook.mjs')).toBeNull()
    const starred = mkdtempSync(join(tmpdir(), 'sikumi-star*-cfg-'))
    tempDirectories.push(starred)
    const hook = join(starred, 'hook.mjs')
    writeFileSync(hook, 'export {}\n')
    expect(toSafeHookCommand(hook)).toBe(hook)
  })

  it('reads, writes, and restores JSON files atomically', () => {
    const root = trackDir()
    const path = join(root, 'nested', 'hooks.json')
    expect(readJsonObject(path)).toEqual({ ok: true, value: {}, raw: null })
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(path, '', { encoding: 'utf8' })
    expect(readJsonObject(path)).toMatchObject({ ok: true, value: {} })
    writeFileSync(path, '[]\n', { encoding: 'utf8' })
    expect(readJsonObject(path).ok).toBe(false)
    writeFileSync(path, '{not-json', { encoding: 'utf8' })
    expect(readJsonObject(path).ok).toBe(false)
    writeJsonAtomic(path, { hooks: { SessionStart: [] } })
    expect(readJsonObject(path).ok).toBe(true)
    expect(readJsonObject(path).value.hooks).toEqual({ SessionStart: [] })
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}\n')
    restoreFile(path, undefined)
    expect(existsSync(path)).toBe(false)
    restoreFile(path, '{"ok":true}\n')
    expect(readFileSync(path, 'utf8')).toBe('{"ok":true}\n')
  })

  it('applies, previews, and rolls back file plans', () => {
    const root = trackDir()
    const created = join(root, 'created.json')
    const removed = join(root, 'removed.json')
    const kept = join(root, 'kept.json')
    writeFileSync(removed, 'old\n')
    writeFileSync(kept, 'same\n')
    const applied = applyFilePlans([
      { path: created, action: 'create', preview: '{"n":1}\n' },
      { path: removed, action: 'remove', preview: '', previous: 'old\n' },
      { path: kept, action: 'keep', preview: 'same\n', previous: 'same\n' },
    ])
    expect(applied).toEqual({ ok: true, changed: true })
    expect(readFileSync(created, 'utf8')).toBe('{"n":1}\n')
    expect(existsSync(removed)).toBe(false)
    expect(readFileSync(kept, 'utf8')).toBe('same\n')
    expect(
      previewForFiles([{ path: created, action: 'create', preview: 'x' }]),
    ).toContain('create')
    const blocked = join(root, 'no-write', 'file.json')
    writeFileSync(join(root, 'no-write'), 'not-a-dir')
    const failed = applyFilePlans([
      {
        path: created,
        action: 'update',
        preview: '{"n":2}\n',
        previous: '{"n":1}\n',
      },
      { path: blocked, action: 'create', preview: 'nope\n' },
    ])
    expect(failed.ok).toBe(false)
    expect(readFileSync(created, 'utf8')).toBe('{"n":1}\n')
    expect(applyFilePlans([])).toEqual({ ok: true, changed: false })
  })

  it('matches quoted hook commands and nested entries', () => {
    expect(unquoteHookCommand('"/tmp/hook.mjs"')).toBe('/tmp/hook.mjs')
    expect(unquoteHookCommand("'/tmp/hook.mjs'")).toBe('/tmp/hook.mjs')
    expect(unquoteHookCommand('/tmp/hook.mjs')).toBe('/tmp/hook.mjs')
    expect(hookCommandMatches('"/tmp/hook.mjs"', '/tmp/hook.mjs')).toBe(true)
    expect(
      hookCommandMatches(['/tmp/hook.mjs', '--flag'], '/tmp/hook.mjs'),
    ).toBe(true)
    expect(hookCommandMatches(1, '/tmp/hook.mjs')).toBe(false)
    expect(commandFromHookEntry(' /tmp/hook.mjs ')).toBe('/tmp/hook.mjs')
    expect(commandFromHookEntry(['/tmp/hook.mjs'])).toBe('/tmp/hook.mjs')
    expect(commandFromHookEntry({})).toBeNull()
    expect(isHookEntryOurs({ command: '/tmp/hook.mjs' }, '/tmp/hook.mjs')).toBe(
      true,
    )
    expect(
      isHookEntryOurs(
        { hooks: [{ command: '/tmp/hook.mjs' }] },
        '/tmp/hook.mjs',
      ),
    ).toBe(true)
    expect(isHookEntryOurs('nope', '/tmp/hook.mjs')).toBe(false)
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(cloneJson({ a: 1 })).toEqual({ a: 1 })
    const missing = join(trackDir(), 'gone.txt')
    expect(readTextIfExists(missing)).toBeNull()
    writeFileSync(missing, 'hello')
    expect(readTextIfExists(missing)).toBe('hello')
  })
})
