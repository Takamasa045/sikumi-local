import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { extname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  AppError,
  isGardenStationId,
  isShikumiEventType,
  type EmployeeSource,
  type GardenStationId,
  type ShikumiEventType,
} from '@sikumi-local/core'
import {
  FORBIDDEN_PACK_EXTENSIONS,
  FORBIDDEN_PACK_NAMES,
  MAX_PACK_DEPTH,
  MAX_PACK_FILE_BYTES,
  MAX_PACK_FILES,
  MAX_PACK_TOTAL_BYTES,
} from './limits.js'
import {
  employeeGrowthSchema,
  employeeManifestSchema,
  employeeStateMapSchema,
  type EmployeeGrowthDefinition,
  type EmployeeManifest,
  type EmployeeStateMap,
} from './manifest.js'
import {
  assertRealPathInside,
  assertRelativePackPath,
  isInsideResolvedRoot,
  isSymlink,
  packError,
  resolveContainedPath,
} from './paths.js'
import { compilePackPrompts, type CompiledEmployeePrompts } from './prompts.js'
import { coreCompatibilitySatisfied } from './semver.js'

export interface LoadedEmployeePack {
  readonly root: string
  readonly source: EmployeeSource
  readonly manifest: EmployeeManifest
  readonly compiled: CompiledEmployeePrompts
  readonly resultSchema: Record<string, unknown>
  readonly stateMap: EmployeeStateMap
  readonly growth: EmployeeGrowthDefinition
}

export interface EmployeePackValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly pack?: LoadedEmployeePack
}

export function loadEmployeePack(
  packDirectory: string,
  source: EmployeeSource,
  allowedRoot?: string,
): LoadedEmployeePack {
  const root = resolvePackRoot(packDirectory, allowedRoot)
  inspectPackTree(root)
  const manifest = readManifest(root)
  if (!coreCompatibilitySatisfied(manifest.compatibility.core)) {
    throw new AppError(
      'EMPLOYEE_INCOMPATIBLE',
      `Employee pack ${manifest.id} is not compatible with this Core`,
      400,
    )
  }
  const system = readTextFile(root, manifest.prompts.system, 'system prompt')
  const job = readTextFile(root, manifest.prompts.job, 'job prompt')
  const resultSchema = readJsonObject(
    root,
    manifest.resultSchema,
    'result schema',
  )
  const stateMap = readStateMap(root, manifest.stateMap)
  const growth = readGrowth(root, manifest.growth)
  return {
    root,
    source,
    manifest,
    compiled: compilePackPrompts({ system, job }),
    resultSchema,
    stateMap,
    growth,
  }
}

export function validateEmployeePack(
  packDirectory: string,
  source: EmployeeSource = 'installed',
  allowedRoot?: string,
): EmployeePackValidation {
  try {
    const pack = loadEmployeePack(packDirectory, source, allowedRoot)
    return { ok: true, errors: [], pack }
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error ? error.message : 'Employee pack is invalid',
      ],
    }
  }
}

function resolvePackRoot(packDirectory: string, allowedRoot?: string): string {
  if (!existsSync(packDirectory)) {
    throw packError('Employee pack was not found')
  }
  if (isSymlink(packDirectory)) {
    throw packError('Employee pack root must not be a symlink')
  }
  let realRoot: string
  try {
    realRoot = realpathSync(packDirectory)
  } catch {
    throw packError('Employee pack was not found')
  }
  const stat = statSync(realRoot)
  if (!stat.isDirectory()) {
    throw packError('Employee pack must be a directory')
  }
  if (allowedRoot) {
    const realAllowed = assertRealPathInside(
      allowedRoot,
      allowedRoot,
      'installed employees root',
    )
    if (!isInsideResolvedRoot(realRoot, realAllowed)) {
      throw packError('Employee pack is outside the installed employees root')
    }
  }
  return realRoot
}

function inspectPackTree(root: string): void {
  let files = 0
  let totalBytes = 0

  function walk(directory: string, depth: number): void {
    if (depth > MAX_PACK_DEPTH) {
      throw packError('Employee pack exceeds the maximum directory depth')
    }
    if (isSymlink(directory) && directory !== root) {
      throw packError('Employee pack must not contain directory symlinks')
    }
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(directory, entry.name)
      if (entry.name === '.' || entry.name === '..') {
        continue
      }
      if (entry.isSymbolicLink() || isSymlink(fullPath)) {
        const real = (() => {
          try {
            return realpathSync(fullPath)
          } catch {
            throw packError('Employee pack symlink could not be resolved')
          }
        })()
        if (!isInsideResolvedRoot(real, root)) {
          throw packError('Employee pack symlink escapes the pack root')
        }
        throw packError('Employee pack must not contain symlinks')
      }
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) {
        throw packError('Employee pack contains an unsupported file type')
      }
      files += 1
      if (files > MAX_PACK_FILES) {
        throw packError('Employee pack has too many files')
      }
      const extension = extname(entry.name).toLowerCase()
      if (
        FORBIDDEN_PACK_EXTENSIONS.has(extension) ||
        FORBIDDEN_PACK_NAMES.has(entry.name.toLowerCase())
      ) {
        throw packError(
          `Employee pack must be data-only (forbidden file: ${entry.name})`,
        )
      }
      const stat = statSync(fullPath)
      if (stat.size > MAX_PACK_FILE_BYTES) {
        throw packError(`Employee pack file is too large: ${entry.name}`)
      }
      totalBytes += stat.size
      if (totalBytes > MAX_PACK_TOTAL_BYTES) {
        throw packError('Employee pack exceeds the maximum total size')
      }
      assertRealPathInside(fullPath, root, entry.name)
    }
  }

  walk(root, 1)
}

function readManifest(root: string): EmployeeManifest {
  const raw = readTextFile(root, 'employee.yaml', 'employee.yaml')
  const parsed = parseYamlDocument(raw, 'employee.yaml')
  const result = employeeManifestSchema.safeParse(parsed)
  if (!result.success) {
    throw packError(
      `employee.yaml is invalid: ${result.error.issues[0]?.message ?? 'unknown'}`,
    )
  }
  assertRelativePackPath(result.data.prompts.system, 'prompts.system')
  assertRelativePackPath(result.data.prompts.job, 'prompts.job')
  assertRelativePackPath(result.data.resultSchema, 'resultSchema')
  assertRelativePackPath(result.data.stateMap, 'stateMap')
  assertRelativePackPath(result.data.growth, 'growth')
  return result.data
}

function readTextFile(
  root: string,
  relativePath: string,
  label: string,
): string {
  const fullPath = resolveContainedPath(root, relativePath, label)
  if (!existsSync(fullPath)) {
    throw packError(`Missing ${label}`)
  }
  if (isSymlink(fullPath)) {
    throw packError(`${label} must not be a symlink`)
  }
  assertRealPathInside(fullPath, root, label)
  const stat = statSync(fullPath)
  if (!stat.isFile()) {
    throw packError(`${label} must be a file`)
  }
  if (stat.size > MAX_PACK_FILE_BYTES) {
    throw packError(`${label} is too large`)
  }
  return readFileSync(fullPath, 'utf8')
}

function readJsonObject(
  root: string,
  relativePath: string,
  label: string,
): Record<string, unknown> {
  const raw = readTextFile(root, relativePath, label)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw packError(`${label} is not valid JSON`)
  }
  if (!isPlainObject(parsed)) {
    throw packError(`${label} must be a JSON object`)
  }
  return parsed
}

function readStateMap(root: string, relativePath: string): EmployeeStateMap {
  const raw = readTextFile(root, relativePath, 'state-map')
  const parsed = parseYamlDocument(raw, 'state-map')
  const result = employeeStateMapSchema.safeParse(parsed)
  if (!result.success) {
    throw packError(
      `state-map is invalid: ${result.error.issues[0]?.message ?? 'unknown'}`,
    )
  }
  const states: Record<string, EmployeeStateMap['states'][string]> = {}
  for (const [name, state] of Object.entries(result.data.states)) {
    if (!isGardenStationId(state.station)) {
      throw packError(`unknown garden station: ${state.station}`)
    }
    states[name] = {
      station: state.station as GardenStationId,
      pose: state.pose,
      summary: state.summary,
    }
  }
  const eventBindings: Partial<Record<ShikumiEventType, string>> = {}
  for (const [eventType, stateName] of Object.entries(
    result.data.eventBindings,
  )) {
    if (!isShikumiEventType(eventType)) {
      throw packError(`unknown event type: ${eventType}`)
    }
    if (!(stateName in states)) {
      throw packError(
        `state-map event ${eventType} references missing ${stateName}`,
      )
    }
    eventBindings[eventType] = stateName
  }
  return { states, eventBindings }
}

function readGrowth(
  root: string,
  relativePath: string,
): EmployeeGrowthDefinition {
  const raw = readTextFile(root, relativePath, 'growth')
  const parsed = parseYamlDocument(raw, 'growth')
  const result = employeeGrowthSchema.safeParse(parsed)
  if (!result.success) {
    throw packError(
      `growth is invalid: ${result.error.issues[0]?.message ?? 'unknown'}`,
    )
  }
  return result.data
}

function parseYamlDocument(raw: string, label: string): unknown {
  try {
    return parseYaml(raw, { uniqueKeys: true, maxAliasCount: 0 })
  } catch {
    throw packError(`${label} is not valid YAML`)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
