import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  AppError,
  type PackKind,
  type PackPreviewRecord,
} from '@sikumi-local/core'
import {
  compareSemver,
  loadEmployeePack,
  resolveSafeInstalledEmployeesRoot,
} from '@sikumi-local/employee-sdk'
import type { EmployeeRegistry } from '../employees/registry.js'
import { resolveRegisteredPath } from '../security/local-path.js'
import type { AppStore } from '../storage/store.js'
import { clonePackRepository, displayGitSource } from './git-source.js'
import { inspectDataOnlyTree, packError } from './inspect-tree.js'
import { extractZipSafely } from './zip.js'

const PREVIEW_TTL_MS = 30 * 60 * 1000

export interface PackPreviewView {
  readonly id: string
  readonly kind: PackKind
  readonly packId: string
  readonly version: string
  readonly sourceKind: 'folder' | 'zip' | 'git'
  readonly sourceDisplay: string
  readonly validation: { ok: boolean; errors: readonly string[] }
  readonly fileSummary: {
    files: number
    totalBytes: number
    names: readonly string[]
  }
  readonly gitCommit: string | null
  readonly gitChanges: string | null
  readonly createdAt: string
}

export function previewPack(input: {
  readonly store: AppStore
  readonly dataDirectory: string
  readonly sourceType: 'folder' | 'zip' | 'git'
  readonly path?: string
  readonly gitUrl?: string
}): PackPreviewView {
  const stagingId = randomUUID()
  const stagingRel = join('packs', 'staging', stagingId)
  const stagingAbs = join(input.dataDirectory, stagingRel)
  mkdirSync(join(input.dataDirectory, 'packs', 'staging'), {
    recursive: true,
    mode: 0o700,
  })
  let sourceDisplay: string
  let gitCommit: string | null = null
  let gitChanges: string | null = null
  try {
    if (input.sourceType === 'folder') {
      const source = resolveRegisteredPath(requiredPath(input.path))
      sourceDisplay = basename(source)
      cpSync(source, stagingAbs, { recursive: true })
    } else if (input.sourceType === 'zip') {
      const source = resolveRegisteredPath(requiredPath(input.path))
      sourceDisplay = basename(source)
      mkdirSync(stagingAbs, { recursive: true, mode: 0o700 })
      extractZipSafely(readFileSync(source), stagingAbs)
    } else {
      const url = input.gitUrl?.trim()
      if (!url) {
        throw packError('Git URL is required')
      }
      const result = clonePackRepository(url, stagingAbs)
      sourceDisplay = displayGitSource(url)
      gitCommit = result.commit
      gitChanges = result.changes
      rmSync(join(stagingAbs, '.git'), { recursive: true, force: true })
    }
    const summary = inspectDataOnlyTree(stagingAbs)
    const manifest = readPackManifest(stagingAbs)
    const existing = input.store.findPack(manifest.kind, manifest.packId)
    const errors: string[] = []
    if (existing?.builtin) {
      errors.push('Built-in packs cannot be replaced')
    }
    if (existing && compareSemver(manifest.version, existing.version) < 0) {
      errors.push('Downgrade is not allowed')
    }
    const now = new Date().toISOString()
    const record: PackPreviewRecord = {
      id: stagingId,
      kind: manifest.kind,
      packId: manifest.packId,
      version: manifest.version,
      sourceKind: input.sourceType,
      sourceDisplay,
      validation: { ok: errors.length === 0, errors },
      fileSummary: {
        files: summary.files,
        totalBytes: summary.totalBytes,
        names: summary.names,
      },
      gitCommit,
      gitChanges,
      stagingRelPath: stagingRel,
      createdAt: now,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
    }
    input.store.insertPackPreview(record)
    return toPreviewView(record)
  } catch (error) {
    rmSync(stagingAbs, { recursive: true, force: true })
    if (error instanceof AppError) {
      throw error
    }
    throw packError('Pack preview failed')
  }
}

export function installPackPreview(input: {
  readonly store: AppStore
  readonly employees: EmployeeRegistry
  readonly dataDirectory: string
  readonly previewId: string
  readonly confirm: true
  readonly afterCopy?: () => void
}) {
  const preview = input.store.getPackPreview(input.previewId)
  if (!preview) {
    throw new AppError('NOT_FOUND', 'Pack previewが見つかりません', 404)
  }
  if (new Date(preview.expiresAt).getTime() < Date.now()) {
    throw new AppError(
      'PACK_UNTRUSTED',
      'この確認画面の有効期限が切れています',
      409,
    )
  }
  const validation = preview.validation as { ok?: boolean; errors?: string[] }
  if (!validation.ok) {
    throw new AppError(
      'PACK_UNTRUSTED',
      validation.errors?.[0] ?? 'このPackは導入できません',
      400,
    )
  }
  const staging = join(input.dataDirectory, preview.stagingRelPath)
  if (!existsSync(staging)) {
    throw new AppError(
      'PACK_UNTRUSTED',
      'Packの確認用データが見つかりません',
      409,
    )
  }
  const existing = input.store.findPack(preview.kind, preview.packId)
  if (existing?.builtin) {
    throw new AppError(
      'PACK_BUILTIN_PROTECTED',
      '組み込みPackは上書きできません',
      403,
    )
  }
  if (existing && compareSemver(preview.version, existing.version) < 0) {
    throw new AppError('PACK_DOWNGRADE', '古い版への更新はできません', 409)
  }
  const target = packInstallPath(
    input.dataDirectory,
    preview.kind,
    preview.packId,
  )
  const backup = `${target}.bak-${preview.id}`
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  let copied = false
  let committed = false
  try {
    if (existsSync(target)) {
      renameSync(target, backup)
    }
    cpSync(staging, target, { recursive: true })
    copied = true
    input.afterCopy?.()
    inspectDataOnlyTree(target)
    if (preview.kind === 'employee') {
      loadEmployeePack(
        target,
        'installed',
        resolveSafeInstalledEmployeesRoot(input.dataDirectory),
      )
    }
    const now = new Date().toISOString()
    if (existing) {
      input.store.updatePack(existing.id, {
        version: preview.version,
        sourceKind: preview.sourceKind,
        sourceDisplay: preview.sourceDisplay,
        commitHash: preview.gitCommit,
        builtin: false,
        installedAt: now,
      })
    } else {
      input.store.insertPack({
        id: randomUUID(),
        kind: preview.kind,
        packId: preview.packId,
        version: preview.version,
        sourcePath: null,
        sourceKind: preview.sourceKind,
        sourceDisplay: preview.sourceDisplay,
        commitHash: preview.gitCommit,
        builtin: false,
        installedAt: now,
      })
    }
    committed = true
    if (existsSync(backup)) {
      rmSync(backup, { recursive: true, force: true })
    }
    rmSync(staging, { recursive: true, force: true })
    input.store.deletePackPreview(preview.id)
    input.employees.refresh()
    input.employees.syncToStore(input.store)
    return input.store.findPack(preview.kind, preview.packId)
  } catch (error) {
    if (!committed) {
      if (existsSync(backup)) {
        rmSync(target, { recursive: true, force: true })
        renameSync(backup, target)
      } else if (copied || existsSync(target)) {
        rmSync(target, { recursive: true, force: true })
      }
    }
    if (error instanceof AppError) {
      throw error
    }
    throw packError(
      committed
        ? 'Pack was installed but post-install refresh failed'
        : 'Pack install failed and was rolled back',
    )
  }
}

export function uninstallPack(input: {
  readonly store: AppStore
  readonly employees: EmployeeRegistry
  readonly dataDirectory: string
  readonly packRowId: string
  readonly confirm: true
  readonly removeBackup?: (backupPath: string) => void
}): void {
  const pack = input.store.getPack(input.packRowId)
  if (!pack) {
    throw new AppError('NOT_FOUND', 'Packが見つかりません', 404)
  }
  if (pack.builtin || pack.packId === 'saguru') {
    throw new AppError(
      'PACK_BUILTIN_PROTECTED',
      '組み込みPackは削除できません',
      403,
    )
  }
  const target = packInstallPath(input.dataDirectory, pack.kind, pack.packId)
  const backup = uninstallBackupPath(input.dataDirectory, pack)
  let moved = false
  try {
    if (existsSync(target)) {
      mkdirSync(dirname(backup), { recursive: true, mode: 0o700 })
      renameSync(target, backup)
      moved = true
    }
    input.store.deletePack(pack.id)
  } catch (error) {
    if (moved && existsSync(backup) && !existsSync(target)) {
      renameSync(backup, target)
    }
    if (error instanceof AppError) {
      throw error
    }
    throw packError('Pack uninstall failed and was rolled back')
  }
  if (existsSync(backup)) {
    try {
      ;(input.removeBackup ?? removeBackupDirectory)(backup)
    } catch {
      // Installed state is already gone; leftover backup is debris only.
    }
  }
  input.employees.refresh()
  input.employees.syncToStore(input.store)
}

export function uninstallBackupPath(
  dataDirectory: string,
  pack: { readonly kind: PackKind; readonly packId: string; readonly id: string },
): string {
  return join(
    dataDirectory,
    'packs',
    'uninstall',
    `${pack.kind}-${pack.packId}-${pack.id}`,
  )
}

function removeBackupDirectory(backupPath: string): void {
  rmSync(backupPath, { recursive: true, force: true })
}

export function ensureBuiltinPacks(
  store: AppStore,
  employees: EmployeeRegistry,
): void {
  employees.refresh()
  employees.syncToStore(store)
  const now = new Date().toISOString()
  for (const employee of employees
    .list()
    .filter((item) => item.source === 'builtin')) {
    if (store.findPack('employee', employee.id)) {
      continue
    }
    store.insertPack({
      id: randomUUID(),
      kind: 'employee',
      packId: employee.id,
      version: employee.version,
      sourcePath: null,
      sourceKind: 'builtin',
      sourceDisplay: 'builtin',
      commitHash: null,
      builtin: true,
      installedAt: now,
    })
  }
}

function requiredPath(path: string | undefined): string {
  if (!path) {
    throw packError('Local path is required')
  }
  return path
}

function readPackManifest(root: string): {
  kind: PackKind
  packId: string
  version: string
} {
  if (existsSync(join(root, 'employee.yaml'))) {
    const pack = loadEmployeePack(root, 'installed')
    return {
      kind: 'employee',
      packId: pack.manifest.id,
      version: pack.manifest.version,
    }
  }
  if (existsSync(join(root, 'world.yaml'))) {
    return parseSimpleManifest(join(root, 'world.yaml'), 'world')
  }
  if (existsSync(join(root, 'character.yaml'))) {
    return parseSimpleManifest(join(root, 'character.yaml'), 'character')
  }
  throw packError('Pack manifest was not found')
}

function parseSimpleManifest(
  filePath: string,
  kind: Exclude<PackKind, 'employee'>,
): { kind: PackKind; packId: string; version: string } {
  const fields = new Map<string, string>()
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const match = line.match(/^([a-zA-Z]+):\s*(.+?)\s*$/)
    if (match?.[1] && match[2]) {
      fields.set(match[1], match[2].replace(/^['"]|['"]$/g, ''))
    }
  }
  const id = fields.get('id')
  const version = fields.get('version')
  if (
    !id ||
    !version ||
    !/^[a-z][a-z0-9-]{1,62}$/.test(id) ||
    !/^\d+\.\d+\.\d+$/.test(version)
  ) {
    throw packError(`${kind} manifest is invalid`)
  }
  return { kind, packId: id, version }
}

function packInstallPath(
  dataDirectory: string,
  kind: PackKind,
  packId: string,
): string {
  const folder =
    kind === 'employee'
      ? 'employees'
      : kind === 'world'
        ? 'worlds'
        : 'characters'
  return join(dataDirectory, folder, packId)
}

function toPreviewView(record: PackPreviewRecord): PackPreviewView {
  const validation = record.validation as { ok?: boolean; errors?: string[] }
  const summary = record.fileSummary as {
    files?: number
    totalBytes?: number
    names?: string[]
  }
  return {
    id: record.id,
    kind: record.kind,
    packId: record.packId,
    version: record.version,
    sourceKind: record.sourceKind,
    sourceDisplay: record.sourceDisplay,
    validation: {
      ok: Boolean(validation.ok),
      errors: validation.errors ?? [],
    },
    fileSummary: {
      files: summary.files ?? 0,
      totalBytes: summary.totalBytes ?? 0,
      names: summary.names ?? [],
    },
    gitCommit: record.gitCommit,
    gitChanges: record.gitChanges,
    createdAt: record.createdAt,
  }
}
