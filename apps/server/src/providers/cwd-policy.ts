import { realpathSync } from 'node:fs'
import { AppError } from '@sikumi-local/core'
import { isInsideRoot } from '@sikumi-local/process-runtime'
import { resolveRegisteredPath } from '../security/local-path.js'
import type { AppStore } from '../storage/store.js'

export function registeredRepositoryRoots(store: AppStore): string[] {
  return store
    .listWorkspaces()
    .map((workspace) => workspace.repository.absolutePath)
}

export function assertRegisteredCwd(store: AppStore, cwd: string): string {
  const resolved = resolveRegisteredPath(cwd)
  let canonical: string
  try {
    canonical = realpathSync(resolved)
  } catch {
    throw new AppError(
      'UNREGISTERED_CWD',
      '登録済みRepository以外では実行できません',
      400,
    )
  }

  const allowed = registeredRepositoryRoots(store)
  if (!allowed.some((root) => isInsideRoot(canonical, root))) {
    throw new AppError(
      'UNREGISTERED_CWD',
      '登録済みRepository以外では実行できません',
      400,
    )
  }
  return canonical
}
