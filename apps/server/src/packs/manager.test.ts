import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureEmployeePackDirectory } from '@sikumi-local/employee-sdk'
import { createEmployeeRegistry } from '../employees/registry.js'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import {
  ensureBuiltinPacks,
  installPackPreview,
  previewPack,
  uninstallBackupPath,
  uninstallPack,
} from './manager.js'
import { buildZip } from './zip-fixture.js'

const tempDirectories: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('pack preview and install', () => {
  it('installs from a local folder, zip, and local bare git without network', () => {
    const { store, employees, dataDirectory } = openPacks()
    const folderPreview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    expect(folderPreview.packId).toBe('miru')
    expect(folderPreview.validation.ok).toBe(true)
    expect(folderPreview.sourceDisplay).toBe('miru')
    const installed = installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: folderPreview.id,
      confirm: true,
    })
    expect(installed?.packId).toBe('miru')
    expect(employees.list().some((item) => item.id === 'miru')).toBe(true)

    const zipPath = join(track(createTemporaryDirectory()), 'world.zip')
    writeFileSync(
      zipPath,
      buildZip([
        {
          name: 'world.yaml',
          content:
            'id: night-garden\nversion: 1.0.0\nkind: world\nname: 夜の庭\n',
        },
      ]),
    )
    const zipPreview = previewPack({
      store,
      dataDirectory,
      sourceType: 'zip',
      path: zipPath,
    })
    expect(zipPreview.kind).toBe('world')
    installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: zipPreview.id,
      confirm: true,
    })
    expect(store.findPack('world', 'night-garden')?.version).toBe('1.0.0')

    const bare = track(createTemporaryGitRepository())
    mkdirSync(join(bare, 'character-pack'), { recursive: true })
    writeFileSync(
      join(bare, 'character.yaml'),
      'id: alt-dog\nversion: 1.0.0\nkind: character\nname: 別の犬\n',
    )
    execFileSync('git', ['-C', bare, 'add', '.'], { encoding: 'utf8' })
    execFileSync('git', ['-C', bare, 'commit', '-m', 'add character pack'], {
      encoding: 'utf8',
    })
    const gitPreview = previewPack({
      store,
      dataDirectory,
      sourceType: 'git',
      gitUrl: `file://${bare}`,
    })
    expect(gitPreview.sourceKind).toBe('git')
    expect(gitPreview.gitCommit).toMatch(/^[0-9a-f]{7,40}$/)
    expect(gitPreview.gitChanges).toBeTruthy()
    expect(gitPreview.sourceDisplay).toBe('local git repository')
    installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: gitPreview.id,
      confirm: true,
    })
    expect(store.findPack('character', 'alt-dog')?.commitHash).toBeTruthy()
  })

  it('rejects downgrade, builtin uninstall, and credentialed git URLs', () => {
    const { store, employees, dataDirectory } = openPacks()
    const preview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    const installed = installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: preview.id,
      confirm: true,
    })
    expect(installed).toBeTruthy()

    const older = track(createTemporaryDirectory())
    copyMiruWithVersion(older, '0.0.1')
    const olderPreview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: older,
    })
    expect(olderPreview.validation.ok).toBe(false)
    expect(() =>
      installPackPreview({
        store,
        employees,
        dataDirectory,
        previewId: olderPreview.id,
        confirm: true,
      }),
    ).toThrow(/導入できません|Downgrade|古い/)

    const builtin = store.findPack('employee', 'saguru')
    expect(builtin?.builtin).toBe(true)
    expect(() =>
      uninstallPack({
        store,
        employees,
        dataDirectory,
        packRowId: builtin!.id,
        confirm: true,
      }),
    ).toThrow(/組み込み/)

    expect(() =>
      previewPack({
        store,
        dataDirectory,
        sourceType: 'git',
        gitUrl: 'https://user:secret@example.com/pack.git',
      }),
    ).toThrow(/credentials/)

    const installedId = store.findPack('employee', 'miru')?.id
    expect(installedId).toBeTruthy()
    uninstallPack({
      store,
      employees,
      dataDirectory,
      packRowId: installedId!,
      confirm: true,
    })
    expect(store.findPack('employee', 'miru')).toBeUndefined()
  })

  it('rolls back the target completely when first install fails after copy', () => {
    const { store, employees, dataDirectory } = openPacks()
    const preview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    const target = join(dataDirectory, 'employees', 'miru')
    expect(() =>
      installPackPreview({
        store,
        employees,
        dataDirectory,
        previewId: preview.id,
        confirm: true,
        afterCopy: () => {
          throw new Error('injected validation failure')
        },
      }),
    ).toThrow(/rolled back|injected validation/)
    expect(existsSync(target)).toBe(false)
    expect(store.findPack('employee', 'miru')).toBeUndefined()

    const dbFailPreview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    const failingStore = {
      ...store,
      insertPack() {
        throw new Error('injected db failure')
      },
    }
    expect(() =>
      installPackPreview({
        store: failingStore,
        employees,
        dataDirectory,
        previewId: dbFailPreview.id,
        confirm: true,
      }),
    ).toThrow(/rolled back|injected db/)
    expect(existsSync(target)).toBe(false)
    expect(store.findPack('employee', 'miru')).toBeUndefined()
  })

  it('restores filesystem and DB when an update fails after copy', () => {
    const { store, employees, dataDirectory } = openPacks()
    const first = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: first.id,
      confirm: true,
    })
    const target = join(dataDirectory, 'employees', 'miru')
    const original = readFileSync(join(target, 'employee.yaml'), 'utf8')
    expect(store.findPack('employee', 'miru')?.version).toBe('1.0.0')

    const newer = track(createTemporaryDirectory())
    copyMiruWithVersion(newer, '1.1.0')
    const updatePreview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: newer,
    })
    expect(() =>
      installPackPreview({
        store,
        employees,
        dataDirectory,
        previewId: updatePreview.id,
        confirm: true,
        afterCopy: () => {
          throw new Error('injected update failure')
        },
      }),
    ).toThrow(/rolled back|injected update/)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(join(target, 'employee.yaml'), 'utf8')).toBe(original)
    expect(store.findPack('employee', 'miru')?.version).toBe('1.0.0')
  })

  it('does not delete an already committed pack when refresh fails', () => {
    const { store, employees, dataDirectory } = openPacks()
    const preview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    const target = join(dataDirectory, 'employees', 'miru')
    const exploding = {
      ...employees,
      refresh() {
        employees.refresh()
        throw new Error('injected refresh failure')
      },
      syncToStore(nextStore: typeof store) {
        return employees.syncToStore(nextStore)
      },
    }
    expect(() =>
      installPackPreview({
        store,
        employees: exploding,
        dataDirectory,
        previewId: preview.id,
        confirm: true,
      }),
    ).toThrow(/refresh failed|injected refresh/)
    expect(existsSync(target)).toBe(true)
    expect(store.findPack('employee', 'miru')?.packId).toBe('miru')
  })

  it('restores files and keeps the DB row when uninstall delete fails', () => {
    const { store, employees, dataDirectory } = openPacks()
    const preview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: preview.id,
      confirm: true,
    })
    const installed = store.findPack('employee', 'miru')
    expect(installed).toBeTruthy()
    const target = join(dataDirectory, 'employees', 'miru')
    const original = readFileSync(join(target, 'employee.yaml'), 'utf8')
    const failingStore = {
      ...store,
      deletePack() {
        throw new Error('injected uninstall db failure')
      },
    }
    expect(() =>
      uninstallPack({
        store: failingStore,
        employees,
        dataDirectory,
        packRowId: installed!.id,
        confirm: true,
      }),
    ).toThrow(/rolled back|injected uninstall/)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(join(target, 'employee.yaml'), 'utf8')).toBe(original)
    expect(store.findPack('employee', 'miru')?.id).toBe(installed!.id)
    expect(existsSync(uninstallBackupPath(dataDirectory, installed!))).toBe(
      false,
    )
  })

  it('leaves only backup debris when cleanup fails after a successful DB delete', () => {
    const { store, employees, dataDirectory } = openPacks()
    const preview = previewPack({
      store,
      dataDirectory,
      sourceType: 'folder',
      path: fixtureEmployeePackDirectory('miru'),
    })
    installPackPreview({
      store,
      employees,
      dataDirectory,
      previewId: preview.id,
      confirm: true,
    })
    const installed = store.findPack('employee', 'miru')
    expect(installed).toBeTruthy()
    const target = join(dataDirectory, 'employees', 'miru')
    const backup = uninstallBackupPath(dataDirectory, installed!)
    expect(() =>
      uninstallPack({
        store,
        employees,
        dataDirectory,
        packRowId: installed!.id,
        confirm: true,
        removeBackup() {
          throw new Error('injected cleanup failure')
        },
      }),
    ).not.toThrow()
    expect(store.findPack('employee', 'miru')).toBeUndefined()
    expect(existsSync(target)).toBe(false)
    expect(existsSync(backup)).toBe(true)
    expect(employees.list().some((item) => item.id === 'miru')).toBe(false)
  })
})

function copyMiruWithVersion(destination: string, version: string) {
  cpSync(fixtureEmployeePackDirectory('miru'), destination, { recursive: true })
  const yaml = join(destination, 'employee.yaml')
  writeFileSync(
    yaml,
    readFileSync(yaml, 'utf8').replace(
      /version: 1\.0\.0/,
      `version: ${version}`,
    ),
  )
}

function openPacks() {
  const dataDirectory = track(createTemporaryDirectory())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  const employees = createEmployeeRegistry({ dataDirectory })
  employees.refresh()
  employees.syncToStore(store)
  ensureBuiltinPacks(store, employees)
  return { store, employees, dataDirectory }
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
