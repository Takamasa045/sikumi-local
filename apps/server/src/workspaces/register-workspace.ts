import { AppError, type Workspace } from '@sikumi-local/core'
import { resolveRegisteredPath } from '../security/local-path.js'
import type { AppStore } from '../storage/store.js'
import { inspectGitRepository, type GitInspection } from './git-repository.js'

export function registerWorkspace(
  store: AppStore,
  pathInput: string,
  employeeName?: string,
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

  return store.createWorkspace(
    inspection,
    employeeName?.trim() || deriveEmployeeName(inspection.displayName),
  )
}

export function deriveEmployeeName(repositoryName: string): string {
  const normalized = repositoryName.toLowerCase()
  if (normalized.includes('shikumi') || normalized.includes('sikumi')) {
    return 'しくみローカル番'
  }
  if (normalized.includes('blog')) return 'ブログ番'
  if (normalized.includes('content')) return 'コンテンツ番'
  if (normalized.includes('web')) return 'ウェブ番'
  if (normalized.includes('app')) return 'アプリ番'
  if (normalized === 'project') return 'プロジェクト番'
  return `${repositoryName.slice(0, 36)}番`
}
