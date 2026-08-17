import { AppError, type Workspace } from '@sikumi-local/core'
import { resolveRegisteredPath } from '../security/local-path.js'
import type { AppStore } from '../storage/store.js'
import { inspectGitRepository, type GitInspection } from './git-repository.js'

export function registerWorkspace(
  store: AppStore,
  pathInput: string,
  inspect: (absolutePath: string) => GitInspection = inspectGitRepository,
): Workspace {
  const absolutePath = resolveRegisteredPath(pathInput)
  const inspection = inspect(absolutePath)
  const existing =
    store.findRepositoryByAbsolutePath(absolutePath) ??
    store.findRepositoryByAbsolutePath(inspection.absolutePath)

  if (existing) {
    throw new AppError(
      'REPOSITORY_DUPLICATE',
      'このRepositoryはすでに登録されています',
      409,
    )
  }

  return store.createWorkspace(inspection)
}
