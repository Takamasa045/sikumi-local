import { crc32 } from 'node:zlib'

export interface ZipFixtureEntry {
  readonly name: string
  readonly content: string
  readonly symlink?: boolean
  readonly method?: number
  readonly crc?: number
  readonly compressedSize?: number
  readonly uncompressedSize?: number
  readonly payload?: Buffer
  readonly localName?: string
  readonly localMethod?: number
  readonly localCrc?: number
  readonly localCompressedSize?: number
  readonly localUncompressedSize?: number
  readonly pretendCompressedSize?: number
  readonly localHeaderOffset?: number
  readonly flags?: number
}

export interface ZipBuildOptions {
  readonly centralOffset?: number
  readonly centralSize?: number
  readonly diskEntries?: number
  readonly extraTrailing?: Buffer
}

export function buildZip(
  entries: readonly ZipFixtureEntry[],
  options: ZipBuildOptions = {},
): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8')
    const data = entry.payload ?? Buffer.from(entry.content, 'utf8')
    const checksum = entry.crc ?? crc32(data)
    const compressedSize =
      entry.compressedSize ?? entry.pretendCompressedSize ?? data.length
    const uncompressedSize = entry.uncompressedSize ?? data.length
    const method = entry.method ?? 0
    const unixMode = entry.symlink ? 0o120777 : 0o100644
    const local = Buffer.alloc(30 + localName.length + data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(entry.localMethod ?? method, 8)
    local.writeUInt32LE(entry.localCrc ?? checksum, 14)
    local.writeUInt32LE(entry.localCompressedSize ?? compressedSize, 18)
    local.writeUInt32LE(entry.localUncompressedSize ?? uncompressedSize, 22)
    local.writeUInt16LE(localName.length, 26)
    localName.copy(local, 30)
    data.copy(local, 30 + localName.length)
    locals.push(local)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressedSize, 20)
    central.writeUInt32LE(uncompressedSize, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((unixMode << 16) >>> 0, 38)
    central.writeUInt32LE(entry.localHeaderOffset ?? offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(options.diskEntries ?? entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(options.centralSize ?? centralDir.length, 12)
  eocd.writeUInt32LE(options.centralOffset ?? offset, 16)
  return Buffer.concat([
    ...locals,
    centralDir,
    eocd,
    ...(options.extraTrailing ? [options.extraTrailing] : []),
  ])
}
