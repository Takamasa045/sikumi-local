import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppError,
  type Employee,
  type EmployeeSource,
  type EmployeeSummary,
} from '@sikumi-local/core'
import {
  findBuiltInEmployeesRoot,
  loadEmployeePack,
  resolveSafeInstalledEmployeesRoot,
  type LoadedEmployeePack,
} from '@sikumi-local/employee-sdk'
import type { AppStore } from '../storage/store.js'

export interface EmployeeRegistry {
  refresh(): void
  list(): EmployeeSummary[]
  get(employeeId: string): EmployeeSummary
  getPack(employeeId: string): LoadedEmployeePack
  syncToStore(store: AppStore): Employee[]
}

export function createEmployeeRegistry(options: {
  readonly dataDirectory?: string
  readonly builtInRoot?: string
}): EmployeeRegistry {
  let packs = new Map<string, LoadedEmployeePack>()

  const registry: EmployeeRegistry = {
    refresh() {
      packs = loadAllPacks(options)
    },
    list() {
      if (packs.size === 0) {
        registry.refresh()
      }
      return [...packs.values()].map(toSummary).sort((left, right) => {
        if (left.source !== right.source) {
          return left.source === 'builtin' ? -1 : 1
        }
        return left.id.localeCompare(right.id)
      })
    },
    get(employeeId) {
      const summary = registry
        .list()
        .find((employee) => employee.id === employeeId)
      if (!summary) {
        throw new AppError('NOT_FOUND', 'AI社員が見つかりません', 404)
      }
      return summary
    },
    getPack(employeeId) {
      if (packs.size === 0) {
        registry.refresh()
      }
      const pack = packs.get(employeeId)
      if (!pack) {
        throw new AppError('NOT_FOUND', 'AI社員が見つかりません', 404)
      }
      return pack
    },
    syncToStore(store) {
      const now = new Date().toISOString()
      const synced: Employee[] = []
      for (const summary of registry.list()) {
        const existing = store.getEmployee(summary.id)
        if (existing) {
          synced.push(existing)
          continue
        }
        synced.push(
          store.insertEmployee({
            id: summary.id,
            packId: summary.packId,
            name: summary.name,
            role: summary.role,
            defaultProviderId: null,
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      return synced
    },
  }
  return registry
}

function loadAllPacks(options: {
  readonly dataDirectory?: string
  readonly builtInRoot?: string
}): Map<string, LoadedEmployeePack> {
  const packs = new Map<string, LoadedEmployeePack>()
  const seen = new Map<string, string>()
  const builtInRoot = options.builtInRoot ?? findBuiltInEmployeesRoot()
  loadFromRoot(builtInRoot, 'builtin', packs, seen)
  if (options.dataDirectory) {
    const installedRoot = resolveSafeInstalledEmployeesRoot(
      options.dataDirectory,
    )
    if (installedRoot) {
      loadFromRoot(installedRoot, 'installed', packs, seen, installedRoot)
    }
  }
  return packs
}

function loadFromRoot(
  root: string,
  source: EmployeeSource,
  packs: Map<string, LoadedEmployeePack>,
  seen: Map<string, string>,
  allowedRoot?: string,
): void {
  if (!existsSync(root)) {
    return
  }
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    return
  }
  const entries = readdirSync(realRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const packDirectory = join(realRoot, entry.name)
    try {
      const pack = loadEmployeePack(packDirectory, source, allowedRoot)
      const previous = seen.get(pack.manifest.id)
      if (previous !== undefined) {
        continue
      }
      seen.set(pack.manifest.id, pack.manifest.version)
      packs.set(pack.manifest.id, pack)
    } catch {
      // Fail closed: invalid or escaped packs are not listed.
    }
  }
}

function toSummary(pack: LoadedEmployeePack): EmployeeSummary {
  const now = new Date(0).toISOString()
  return {
    id: pack.manifest.id,
    packId: pack.manifest.id,
    name: pack.manifest.name,
    role: pack.manifest.role,
    defaultProviderId: null,
    createdAt: now,
    updatedAt: now,
    description: pack.manifest.description.trim(),
    version: pack.manifest.version,
    permissionProfile: pack.manifest.permissionProfile,
    supportedJobTypes: pack.manifest.supportedJobTypes,
    defaultProviderOrder: pack.manifest.defaultProviderOrder,
    requiredProviderCapabilities: pack.manifest.requiredProviderCapabilities,
    character: pack.manifest.character,
    source: pack.source,
  }
}
