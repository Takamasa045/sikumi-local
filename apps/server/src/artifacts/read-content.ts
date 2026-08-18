import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { sep } from 'node:path'
import {
  AppError,
  type Artifact,
  type ArtifactContent,
  type ArtifactContentFormat,
  type ArtifactType,
} from '@sikumi-local/core'

export const MAX_ARTIFACT_CONTENT_BYTES = 1_048_576

export function resolveArtifactContentFormat(
  type: ArtifactType,
): ArtifactContentFormat {
  if (type === 'report') {
    return 'json'
  }
  if (type === 'markdown') {
    return 'markdown'
  }
  if (type === 'patch' || type === 'code_diff') {
    return 'patch'
  }
  return 'text'
}

export function readArtifactContent(input: {
  readonly artifact: Artifact
  readonly dataDirectory: string
}): ArtifactContent {
  if (!input.artifact.storagePath) {
    throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
  }

  let pathStat
  try {
    pathStat = lstatSync(input.artifact.storagePath)
  } catch {
    throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
  }

  if (pathStat.isSymbolicLink()) {
    throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
  }
  if (pathStat.isDirectory() || !pathStat.isFile()) {
    throw new AppError('VALIDATION_FAILED', '成果の本文を読めません', 400)
  }

  const realRoot = safeRealpath(input.dataDirectory)
  const realFile = safeRealpath(input.artifact.storagePath)
  assertInsideDataDirectory(realFile, realRoot)

  const fd = openRegularFileNoFollow(realFile)
  try {
    const opened = fstatSync(fd)
    if (opened.isSymbolicLink() || opened.isDirectory() || !opened.isFile()) {
      throw new AppError('VALIDATION_FAILED', '成果の本文を読めません', 400)
    }

    const currentPath = safeRealpath(input.artifact.storagePath)
    assertInsideDataDirectory(currentPath, realRoot)
    if (currentPath !== realFile) {
      throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
    }

    let currentStat
    try {
      currentStat = lstatSync(realFile)
    } catch {
      throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
    }
    if (currentStat.isSymbolicLink()) {
      throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
    }
    if (currentStat.dev !== opened.dev || currentStat.ino !== opened.ino) {
      throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
    }

    const sizeBytes = opened.size
    const toRead = Math.min(sizeBytes, MAX_ARTIFACT_CONTENT_BYTES)
    const buffer = Buffer.alloc(toRead)
    let offset = 0
    while (offset < toRead) {
      const bytesRead = readSync(fd, buffer, offset, toRead - offset, offset)
      if (bytesRead === 0) {
        break
      }
      offset += bytesRead
    }
    const truncated = sizeBytes > MAX_ARTIFACT_CONTENT_BYTES
    return {
      artifactId: input.artifact.id,
      title: input.artifact.title,
      type: input.artifact.type,
      format: resolveArtifactContentFormat(input.artifact.type),
      content: decodeUtf8Prefix(buffer.subarray(0, offset), truncated),
      sizeBytes,
      truncated,
    }
  } finally {
    closeSync(fd)
  }
}

function openRegularFileNoFollow(path: string): number {
  const flags =
    constants.O_RDONLY |
    (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)
  try {
    return openSync(path, flags)
  } catch (error) {
    if (isNoFollowRejection(error)) {
      throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
    }
    throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
  }
}

function isNoFollowRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }
  const code = String(error.code)
  return code === 'ELOOP' || code === 'EMLINK' || code === 'EPERM'
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
  }
}

function assertInsideDataDirectory(realFile: string, realRoot: string): void {
  if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) {
    throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
  }
}

function decodeUtf8Prefix(buffer: Buffer, truncated: boolean): string {
  let end = buffer.length
  if (truncated && end > 0) {
    let index = end - 1
    let continuation = 0
    while (index >= 0 && (buffer[index]! & 0xc0) === 0x80) {
      continuation += 1
      index -= 1
    }
    if (index >= 0) {
      const lead = buffer[index]!
      const expected =
        lead < 0x80
          ? 0
          : lead < 0xe0
            ? 1
            : lead < 0xf0
              ? 2
              : lead < 0xf8
                ? 3
                : 0
      if (continuation !== expected) {
        end = index
      }
    }
  }
  return buffer.subarray(0, end).toString('utf8')
}
