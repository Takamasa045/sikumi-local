import { closeSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
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

  let stat
  try {
    stat = lstatSync(input.artifact.storagePath)
  } catch {
    throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
  }

  if (stat.isSymbolicLink()) {
    throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
  }
  if (stat.isDirectory() || !stat.isFile()) {
    throw new AppError('VALIDATION_FAILED', '成果の本文を読めません', 400)
  }

  let realFile: string
  let realRoot: string
  try {
    realFile = realpathSync(input.artifact.storagePath)
    realRoot = realpathSync(input.dataDirectory)
  } catch {
    throw new AppError('NOT_FOUND', '成果の本文が見つかりません', 404)
  }

  if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) {
    throw new AppError('PATH_TRAVERSAL', '成果の保存場所が不正です', 400)
  }

  const sizeBytes = stat.size
  const toRead = Math.min(sizeBytes, MAX_ARTIFACT_CONTENT_BYTES)
  const buffer = Buffer.alloc(toRead)
  const fd = openSync(realFile, 'r')
  try {
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
