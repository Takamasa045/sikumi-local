import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import {
  FORBIDDEN_PACK_EXTENSIONS,
  MAX_PACK_FILE_BYTES,
  MAX_PACK_FILES,
  MAX_PACK_TOTAL_BYTES,
} from '@sikumi-local/employee-sdk'
import { packError } from './inspect-tree.js'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const MAX_RATIO = 100
const UNIX_SYMLINK = 0o120000
const UNIX_EXEC = 0o111
const SENSITIVE_BASENAME =
  /^(\.env(\..*)?|\.npmrc|\.netrc|\.git-credentials|id_rsa|id_ed25519|id_ecdsa|credentials(\..*)?)$/i

export function extractZipSafely(
  archive: Buffer,
  destination: string,
): { files: number; totalBytes: number; names: string[] } {
  if (archive.length > MAX_PACK_TOTAL_BYTES * 2) {
    throw packError('Zip archive is too large')
  }
  const eocd = findEocd(archive)
  if (eocd.centralOffset + eocd.centralSize > eocd.eocdOffset) {
    throw packError('Zip central directory is out of bounds')
  }
  const names: string[] = []
  let files = 0
  let totalBytes = 0
  let offset = eocd.centralOffset
  const destinationRoot = resolve(destination)

  for (let index = 0; index < eocd.entries; index += 1) {
    if (offset + 46 > archive.length) {
      throw packError('Zip central directory is invalid')
    }
    if (archive.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw packError('Zip central directory is invalid')
    }
    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const crc = archive.readUInt32LE(offset + 16)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttr = archive.readUInt32LE(offset + 38)
    const localOffset = archive.readUInt32LE(offset + 42)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd > archive.length) {
      throw packError('Zip central directory is invalid')
    }
    const name = archive.subarray(offset + 46, nameEnd).toString('utf8')
    offset = nameEnd + extraLength + commentLength
    if (offset > eocd.eocdOffset) {
      throw packError('Zip central directory is out of bounds')
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw packError('Zip64 archives are not allowed')
    }
    if (name.endsWith('/')) {
      continue
    }
    if ((flags & 0x0001) !== 0) {
      throw packError('Encrypted zip archives are not allowed')
    }
    if ((flags & 0x0008) !== 0) {
      throw packError('Zip data descriptors are not allowed')
    }
    assertSafeZipName(name)
    const unixMode = (externalAttr >>> 16) & 0xffff
    if ((unixMode & 0o170000) === UNIX_SYMLINK) {
      throw packError('Zip must not contain symlinks')
    }
    if ((unixMode & UNIX_EXEC) !== 0) {
      throw packError(`Zip must not contain executables: ${name}`)
    }
    files += 1
    if (files > MAX_PACK_FILES) {
      throw packError('Zip has too many files')
    }
    if (uncompressedSize > MAX_PACK_FILE_BYTES) {
      throw packError(`Zip file is too large: ${name}`)
    }
    totalBytes += uncompressedSize
    if (totalBytes > MAX_PACK_TOTAL_BYTES) {
      throw packError('Zip exceeds the maximum uncompressed size')
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_RATIO) {
      throw packError('Zip compression ratio is unsafe')
    }
    const content = readLocalFile(archive, localOffset, {
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
    })
    const target = resolve(destinationRoot, name)
    if (!isInsideDestination(target, destinationRoot)) {
      throw packError('Zip path escapes the destination')
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    writeFileSync(target, content, { mode: 0o600 })
    names.push(name)
  }
  return { files, totalBytes, names: names.sort() }
}

function readLocalFile(
  archive: Buffer,
  localOffset: number,
  expected: {
    readonly name: string
    readonly method: number
    readonly crc: number
    readonly compressedSize: number
    readonly uncompressedSize: number
  },
): Buffer {
  if (
    localOffset + 30 > archive.length ||
    archive.readUInt32LE(localOffset) !== LOCAL_SIG
  ) {
    throw packError('Zip local header is invalid')
  }
  const localMethod = archive.readUInt16LE(localOffset + 8)
  const localCrc = archive.readUInt32LE(localOffset + 14)
  const localCompressed = archive.readUInt32LE(localOffset + 18)
  const localUncompressed = archive.readUInt32LE(localOffset + 22)
  const nameLength = archive.readUInt16LE(localOffset + 26)
  const extraLength = archive.readUInt16LE(localOffset + 28)
  const nameStart = localOffset + 30
  const nameEnd = nameStart + nameLength
  if (nameEnd > archive.length) {
    throw packError('Zip local header is invalid')
  }
  const localName = archive.subarray(nameStart, nameEnd).toString('utf8')
  if (
    localName !== expected.name ||
    localMethod !== expected.method ||
    localCompressed !== expected.compressedSize ||
    localUncompressed !== expected.uncompressedSize ||
    localCrc !== expected.crc
  ) {
    throw packError('Zip local header does not match the central directory')
  }
  const dataStart = nameEnd + extraLength
  const dataEnd = dataStart + expected.compressedSize
  if (dataStart > archive.length || dataEnd > archive.length) {
    throw packError('Zip local payload is out of bounds')
  }
  const data = archive.subarray(dataStart, dataEnd)
  if (data.length !== expected.compressedSize) {
    throw packError('Zip stored payload length is invalid')
  }
  let output: Buffer
  if (expected.method === 0) {
    if (data.length !== expected.uncompressedSize) {
      throw packError('Zip stored payload length is invalid')
    }
    output = data
  } else if (expected.method === 8) {
    try {
      output = inflateRawSync(data)
    } catch {
      throw packError('Zip inflation failed')
    }
    if (output.length !== expected.uncompressedSize) {
      throw packError('Zip uncompressed size mismatch')
    }
  } else {
    throw packError('Unsupported zip compression method')
  }
  if (crc32(output) >>> 0 !== expected.crc) {
    throw packError('Zip CRC mismatch')
  }
  return output
}

function findEocd(archive: Buffer): {
  entries: number
  centralOffset: number
  centralSize: number
  eocdOffset: number
} {
  for (
    let index = archive.length - 22;
    index >= 0 && archive.length - index < 65_557;
    index -= 1
  ) {
    if (archive.readUInt32LE(index) !== EOCD_SIG) {
      continue
    }
    const commentLength = archive.readUInt16LE(index + 20)
    if (index + 22 + commentLength !== archive.length) {
      continue
    }
    const diskEntries = archive.readUInt16LE(index + 8)
    const entries = archive.readUInt16LE(index + 10)
    const centralSize = archive.readUInt32LE(index + 12)
    const centralOffset = archive.readUInt32LE(index + 16)
    if (diskEntries !== entries) {
      throw packError('Split zip archives are not allowed')
    }
    return { entries, centralOffset, centralSize, eocdOffset: index }
  }
  throw packError('Zip end of central directory was not found')
}

function assertSafeZipName(name: string): void {
  if (
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.split('/').includes('..') ||
    name.split('/').includes('')
  ) {
    throw packError('Zip entry path is not safe')
  }
  if (/^[A-Za-z]:/.test(name)) {
    throw packError('Zip entry path is not safe')
  }
  const parts = name.split('/')
  if (parts.some((part) => part === '.git' || part.startsWith('.git'))) {
    throw packError('Zip must not contain git metadata')
  }
  const base = parts[parts.length - 1] ?? name
  if (SENSITIVE_BASENAME.test(base) || base.toLowerCase().startsWith('.env')) {
    throw packError(`Zip must be data-only (forbidden file: ${name})`)
  }
  const extension = extnameLower(base)
  if (
    FORBIDDEN_PACK_EXTENSIONS.has(extension) ||
    ['.pem', '.key', '.p12', '.pfx', '.asc'].includes(extension)
  ) {
    throw packError(`Zip must be data-only (forbidden file: ${name})`)
  }
}

function extnameLower(name: string): string {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

function isInsideDestination(candidate: string, root: string): boolean {
  if (isAbsolute(candidate) && candidate === root) {
    return false
  }
  return candidate === root || candidate.startsWith(root + sep)
}
