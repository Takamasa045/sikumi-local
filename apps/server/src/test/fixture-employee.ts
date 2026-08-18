import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { fixtureEmployeePackDirectory } from '@sikumi-local/employee-sdk'

export function installFixtureEmployee(
  dataDirectory: string,
  id: string,
): string {
  const target = join(dataDirectory, 'employees', id)
  cpSync(fixtureEmployeePackDirectory(id), target, { recursive: true })
  return target
}
