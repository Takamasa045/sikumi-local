import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  AppError,
  artifactTypes,
  employeeSchema,
  growthRecordSchema,
  jobSchema,
  persistedEventSchema,
  providerIds,
  redactSensitiveText,
  sanitizeEventPayload,
  worldFeatureUnlockSchema,
} from '@sikumi-local/core'
import { IMPORT_CONFIRM_TOKEN, confirmMatches } from './args.js'
import {
  backupDataDirectory,
  restoreDataDirectoryFromBackup,
  type DirectoryBackupResult,
} from './backup.js'
import {
  assertNoSymlinkAncestors,
  assertNoSymlinkAlongPath,
  assertSafeDataDirectoryInput,
  ensureDataLayout,
  inspectDataDirectory,
  resolveRequestedDataDirectory,
} from './paths.js'
import { hideSecrets, portableValueLooksUnsafe } from './redact-cli.js'
import { openDatabase } from '../storage/database.js'
import { databaseFilePath } from '../storage/data-directory.js'
import { createStore } from '../storage/store.js'

export const PORTABLE_FORMAT = 'shikumi-local-portable'
export const PORTABLE_SCHEMA_VERSION = 1
export const PORTABLE_INCLUDES_OBSERVER_HISTORY = false
export const MAX_PORTABLE_BYTES = 8 * 1024 * 1024
export const PORTABLE_MANIFEST_NAME = 'shikumi-portable.json'

const portableWorkspaceSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  worldPackId: z.string().min(1).max(128),
  defaultProviderId: z.enum(providerIds).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  repository: z.object({
    displayName: z.string().min(1).max(200),
    currentBranch: z.string().min(1).max(200).nullable(),
    remoteName: z.string().min(1).max(200).nullable(),
    readable: z.boolean(),
  }),
})

const portablePackSchema = z.object({
  kind: z.enum(['employee', 'character', 'world']),
  packId: z.string().min(1).max(128),
  version: z.string().min(1).max(32),
  sourceKind: z.enum(['builtin', 'folder', 'zip', 'git']).nullable(),
  sourceDisplay: z.string().min(1).max(200).nullable(),
  builtin: z.boolean(),
  installedAt: z.string().min(1),
})

const portableArtifactSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  type: z.enum(artifactTypes),
  title: z.string().min(1),
  createdAt: z.string().min(1),
})

export const portableSnapshotSchema = z.object({
  format: z.literal(PORTABLE_FORMAT),
  schemaVersion: z.literal(PORTABLE_SCHEMA_VERSION),
  exportedAt: z.string().min(1),
  product: z.literal('Shikumi Local'),
  workspaces: z.array(portableWorkspaceSchema),
  employees: z.array(
    employeeSchema.omit({ defaultProviderId: true }).extend({
      defaultProviderId: z.enum(providerIds).nullable(),
    }),
  ),
  jobs: z.array(jobSchema),
  events: z.array(persistedEventSchema),
  artifacts: z.array(portableArtifactSchema),
  growthRecords: z.array(growthRecordSchema),
  worldUnlocks: z.array(
    z.object({
      id: z.string().min(1),
      workspaceId: z.string().min(1),
      worldPackId: z.string().min(1),
      unlockedAt: z.string().min(1),
    }),
  ),
  worldFeatureUnlocks: z.array(worldFeatureUnlockSchema),
  packs: z.array(portablePackSchema),
})

export type PortableSnapshot = z.infer<typeof portableSnapshotSchema>

export interface PortablePreview {
  readonly format: typeof PORTABLE_FORMAT
  readonly schemaVersion: typeof PORTABLE_SCHEMA_VERSION
  readonly workspaces: number
  readonly employees: number
  readonly jobs: number
  readonly events: number
  readonly artifacts: number
  readonly growthRecords: number
  readonly packs: number
  readonly bytes: number
}

export interface ExportResult {
  readonly destination: string
  readonly preview: PortablePreview
}

export interface ImportPreviewResult {
  readonly mode: 'preview'
  readonly source: string
  readonly preview: PortablePreview
  readonly confirmToken: typeof IMPORT_CONFIRM_TOKEN
}

export interface ImportResult {
  readonly mode: 'applied'
  readonly dataDirectory: string
  readonly preview: PortablePreview
  readonly backup: DirectoryBackupResult
}

export function buildPortableSnapshot(dataDirectory: string): PortableSnapshot {
  const resolved = assertSafeDataDirectoryInput(dataDirectory)
  if (!existsSync(databaseFilePath(resolved))) {
    return emptySnapshot()
  }
  const opened = openDatabase(resolved)
  try {
    const store = createStore(opened.db)
    const snapshot: PortableSnapshot = {
      format: PORTABLE_FORMAT,
      schemaVersion: PORTABLE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      product: 'Shikumi Local',
      workspaces: store.listWorkspaces().map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        worldPackId: workspace.worldPackId,
        defaultProviderId: workspace.defaultProviderId,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        repository: {
          displayName: workspace.repository.displayName,
          currentBranch: workspace.repository.currentBranch,
          remoteName: workspace.repository.remoteName,
          readable: workspace.repository.readable,
        },
      })),
      employees: store.listEmployees(),
      jobs: store.listJobs().map((job) => ({
        ...job,
        request: hideSecrets(redactSensitiveText(job.request)),
      })),
      events: store.listAllEvents().map((event) => ({
        ...event,
        payload: sanitizeEventPayload(event.payload),
      })),
      artifacts: store.listArtifacts().map((artifact) => ({
        id: artifact.id,
        jobId: artifact.jobId,
        type: artifact.type,
        title: redactSensitiveText(artifact.title),
        createdAt: artifact.createdAt,
      })),
      growthRecords: store.listGrowthRecords(),
      worldUnlocks: store.listWorldUnlocks(),
      worldFeatureUnlocks: store.listWorldFeatureUnlocks(),
      packs: store.listPacks().map((pack) => ({
        kind: pack.kind,
        packId: pack.packId,
        version: pack.version,
        sourceKind: pack.sourceKind,
        sourceDisplay: pack.sourceDisplay,
        builtin: pack.builtin,
        installedAt: pack.installedAt,
      })),
      // Observer history stays local-only. Absolute paths, hook metadata,
      // and session correlation are not part of the portable archive.
    }
    return portableSnapshotSchema.parse(snapshot)
  } finally {
    opened.sqlite.close()
  }
}

export function previewPortableSnapshot(
  snapshot: PortableSnapshot,
  bytes: number,
): PortablePreview {
  return {
    format: snapshot.format,
    schemaVersion: snapshot.schemaVersion,
    workspaces: snapshot.workspaces.length,
    employees: snapshot.employees.length,
    jobs: snapshot.jobs.length,
    events: snapshot.events.length,
    artifacts: snapshot.artifacts.length,
    growthRecords: snapshot.growthRecords.length,
    packs: snapshot.packs.length,
    bytes,
  }
}

export function exportPortableArchive(input: {
  readonly dataDirectory?: string
  readonly destination: string
  readonly overwrite?: boolean
  readonly env?: NodeJS.ProcessEnv
}): ExportResult {
  const dataDirectory = resolveRequestedDataDirectory(input.env)
  const snapshot = buildPortableSnapshot(input.dataDirectory ?? dataDirectory)
  const serialized = serializePortableSnapshot(snapshot)
  const destination = resolveExportDestination(
    input.destination,
    input.overwrite === true,
  )
  writePortableAtomically(destination, serialized)
  return {
    destination,
    preview: previewPortableSnapshot(snapshot, Buffer.byteLength(serialized)),
  }
}

export function previewPortableArchive(source: string): ImportPreviewResult {
  const snapshot = readPortableArchive(source)
  const serialized = serializePortableSnapshot(snapshot)
  return {
    mode: 'preview',
    source,
    preview: previewPortableSnapshot(snapshot, Buffer.byteLength(serialized)),
    confirmToken: IMPORT_CONFIRM_TOKEN,
  }
}

export function importPortableArchive(input: {
  readonly source: string
  readonly confirm: string | undefined
  readonly env?: NodeJS.ProcessEnv
}): ImportResult {
  if (!confirmMatches(input.confirm, IMPORT_CONFIRM_TOKEN)) {
    throw new AppError(
      'IMPORT_CONFLICT',
      `Import requires --confirm ${IMPORT_CONFIRM_TOKEN}`,
      400,
    )
  }
  const dataDirectory = resolveRequestedDataDirectory(input.env)
  const inspection = inspectDataDirectory(dataDirectory)
  if (inspection.isSymlink) {
    throw new AppError(
      'IMPORT_CONFLICT',
      'Refusing to import into a data directory that is a symlink',
      400,
    )
  }
  const snapshot = readPortableArchive(input.source)
  const serialized = serializePortableSnapshot(snapshot)
  const preview = previewPortableSnapshot(
    snapshot,
    Buffer.byteLength(serialized),
  )
  ensureDataLayout(dataDirectory)
  const backup = backupDataDirectory(dataDirectory, 'import')
  try {
    applyPortableSnapshot(dataDirectory, snapshot)
  } catch (error) {
    restoreDataDirectoryFromBackup(dataDirectory, backup.backupDirectory)
    throw error
  }
  return {
    mode: 'applied',
    dataDirectory,
    preview,
    backup,
  }
}

export function readPortableArchive(source: string): PortableSnapshot {
  const filePath = resolvePortableSource(source)
  const stat = statSync(filePath)
  if (stat.size > MAX_PORTABLE_BYTES) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Portable archive exceeds the size limit',
      400,
    )
  }
  const raw = readFileSync(filePath, 'utf8')
  if (Buffer.byteLength(raw) > MAX_PORTABLE_BYTES) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Portable archive exceeds the size limit',
      400,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AppError(
      'PORTABLE_INVALID',
      'Portable archive is not valid JSON',
      400,
    )
  }
  const snapshot = portableSnapshotSchema.safeParse(parsed)
  if (!snapshot.success) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Portable archive failed schema validation',
      400,
    )
  }
  assertPortableSnapshotSafe(snapshot.data)
  return snapshot.data
}

function applyPortableSnapshot(
  dataDirectory: string,
  snapshot: PortableSnapshot,
): void {
  const staging = join(
    dataDirectory,
    'backups',
    `.import-staging-${randomUUID()}`,
  )
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  const opened = openDatabase(staging)
  try {
    const store = createStore(opened.db)
    for (const workspace of snapshot.workspaces) {
      store.importDetachedWorkspace(workspace)
    }
    for (const employee of snapshot.employees) {
      if (!store.getEmployee(employee.id)) {
        store.insertEmployee(employee)
      }
    }
    for (const job of snapshot.jobs) {
      store.insertJob(job)
    }
    for (const event of snapshot.events) {
      store.insertEvent(event)
    }
    for (const artifact of snapshot.artifacts) {
      store.insertArtifact({
        ...artifact,
        storagePath: null,
      })
    }
    for (const record of snapshot.growthRecords) {
      store.insertGrowthRecord(record)
    }
    for (const unlock of snapshot.worldUnlocks) {
      store.insertWorldUnlock(unlock)
    }
    for (const unlock of snapshot.worldFeatureUnlocks) {
      store.insertWorldFeatureUnlock(unlock)
    }
    for (const pack of snapshot.packs) {
      if (!store.findPack(pack.kind, pack.packId)) {
        store.insertPack({
          id: randomUUID(),
          kind: pack.kind,
          packId: pack.packId,
          version: pack.version,
          sourcePath: null,
          sourceKind: pack.sourceKind,
          sourceDisplay: pack.sourceDisplay,
          commitHash: null,
          builtin: pack.builtin,
          installedAt: pack.installedAt,
        })
      }
    }
  } finally {
    opened.sqlite.close()
  }

  const stagedDatabase = databaseFilePath(staging)
  const targetDatabase = databaseFilePath(dataDirectory)
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const leftover = `${targetDatabase}${suffix}`
    if (existsSync(leftover) && !lstatSync(leftover).isSymbolicLink()) {
      rmSync(leftover, { force: true })
    }
  }
  renameSync(stagedDatabase, targetDatabase)
  rmSync(staging, { recursive: true, force: true })
}

function resolveExportDestination(
  destination: string,
  overwrite: boolean,
): string {
  const trimmed = destination.trim()
  if (trimmed.length === 0) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Export destination is required',
      400,
    )
  }
  if (trimmed.includes('\0') || trimmed.split(/[/\\]/).includes('..')) {
    throw new AppError('PATH_TRAVERSAL', 'Export destination is not safe', 400)
  }
  if (!isAbsolute(trimmed)) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Export destination must be an absolute path',
      400,
    )
  }
  assertNoSymlinkAlongPath(trimmed)
  try {
    if (lstatSync(trimmed).isSymbolicLink()) {
      throw new AppError(
        'PORTABLE_INVALID',
        'Refusing to write a portable archive through a symlink',
        400,
      )
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
  }
  const targetFile = looksLikeDirectory(trimmed)
    ? join(trimmed, PORTABLE_MANIFEST_NAME)
    : trimmed
  if (existsSync(targetFile) && lstatSync(targetFile).isSymbolicLink()) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Refusing to write a portable archive through a symlink',
      400,
    )
  }
  if (existsSync(targetFile) && lstatSync(targetFile).isFile() && !overwrite) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Export destination already exists. Re-run with --overwrite to replace it.',
      409,
    )
  }
  return trimmed
}

function resolvePortableSource(source: string): string {
  const trimmed = source.trim()
  if (trimmed.length === 0) {
    throw new AppError('PORTABLE_INVALID', 'Import source is required', 400)
  }
  if (trimmed.includes('\0') || trimmed.split(/[/\\]/).includes('..')) {
    throw new AppError('PATH_TRAVERSAL', 'Import source is not safe', 400)
  }
  if (!isAbsolute(trimmed)) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Import source must be an absolute path',
      400,
    )
  }
  if (!existsSync(trimmed)) {
    throw new AppError('PORTABLE_INVALID', 'Import source was not found', 400)
  }
  assertNoSymlinkAlongPath(trimmed)
  if (lstatSync(trimmed).isSymbolicLink()) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Refusing to read a portable archive through a symlink',
      400,
    )
  }
  if (lstatSync(trimmed).isDirectory()) {
    const manifest = join(trimmed, PORTABLE_MANIFEST_NAME)
    if (!existsSync(manifest) || lstatSync(manifest).isSymbolicLink()) {
      throw new AppError(
        'PORTABLE_INVALID',
        'Portable directory must contain shikumi-portable.json',
        400,
      )
    }
    assertNoSymlinkAlongPath(manifest)
    if (!lstatSync(manifest).isFile()) {
      throw new AppError(
        'PORTABLE_INVALID',
        'Portable directory must contain a regular shikumi-portable.json',
        400,
      )
    }
    return manifest
  }
  if (!lstatSync(trimmed).isFile()) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Import source is not a regular file',
      400,
    )
  }
  return trimmed
}

function writePortableAtomically(
  destination: string,
  serialized: string,
): void {
  if (Buffer.byteLength(serialized) > MAX_PORTABLE_BYTES) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Portable archive exceeds the size limit',
      400,
    )
  }
  const asDirectory =
    destination.endsWith('/') || looksLikeDirectory(destination)
  const filePath = asDirectory
    ? join(destination, PORTABLE_MANIFEST_NAME)
    : destination
  assertNoSymlinkAncestors(filePath)
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const tempPath = `${filePath}.tmp-${randomUUID()}`
  try {
    writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, filePath)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

function looksLikeDirectory(destination: string): boolean {
  return existsSync(destination) && lstatSync(destination).isDirectory()
}

function serializePortableSnapshot(snapshot: PortableSnapshot): string {
  const parsed = portableSnapshotSchema.parse(snapshot)
  assertPortableSnapshotSafe(parsed)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

function assertPortableSnapshotSafe(snapshot: PortableSnapshot): void {
  if (portableValueLooksUnsafe(snapshot)) {
    throw new AppError(
      'PORTABLE_INVALID',
      'Portable archive contains secrets, reasoning, or absolute paths',
      400,
    )
  }
}

function emptySnapshot(): PortableSnapshot {
  return portableSnapshotSchema.parse({
    format: PORTABLE_FORMAT,
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    product: 'Shikumi Local',
    workspaces: [],
    employees: [],
    jobs: [],
    events: [],
    artifacts: [],
    growthRecords: [],
    worldUnlocks: [],
    worldFeatureUnlocks: [],
    packs: [],
  })
}
