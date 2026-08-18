import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isInsideResolvedRoot, isSymlink, packError } from './paths.js'

export function findBuiltInEmployeesRoot(
  start: string = fileURLToPath(new URL('.', import.meta.url)),
): string {
  let current = start
  for (let index = 0; index < 10; index += 1) {
    const candidate = join(current, 'employees')
    if (existsSync(join(candidate, 'saguru', 'employee.yaml'))) {
      return candidate
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  throw packError('Built-in employees directory was not found')
}

export function saguruPackDirectory(): string {
  return join(findBuiltInEmployeesRoot(), 'saguru')
}

export function fixtureEmployeesRoot(): string {
  return join(fileURLToPath(new URL('..', import.meta.url)), 'fixtures')
}

export function fixtureEmployeePackDirectory(id: string): string {
  return join(fixtureEmployeesRoot(), id)
}

export function installedEmployeesRoot(dataDirectory: string): string {
  return join(dataDirectory, 'employees')
}

export function resolveSafeInstalledEmployeesRoot(
  dataDirectory: string,
): string | undefined {
  let dataReal: string
  try {
    dataReal = realpathSync(dataDirectory)
  } catch {
    return undefined
  }

  const installedRoot = installedEmployeesRoot(dataDirectory)
  if (isSymlink(installedRoot)) {
    return containedRealPath(installedRoot, dataReal)
  }
  if (!existsSync(installedRoot)) {
    mkdirSync(installedRoot, { recursive: true, mode: 0o700 })
  }
  return containedRealPath(installedRoot, dataReal)
}

function containedRealPath(
  candidate: string,
  dataReal: string,
): string | undefined {
  try {
    const real = realpathSync(candidate)
    if (!isInsideResolvedRoot(real, dataReal)) {
      return undefined
    }
    return real
  } catch {
    return undefined
  }
}
