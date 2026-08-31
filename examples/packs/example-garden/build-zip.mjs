import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const root = dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] ?? join(root, 'example-garden.zip')

writeFileSync(join(root, 'background.png'), solidPng(32, 20, [36, 92, 88]))
writeFileSync(join(root, 'characters.png'), atlasPng())

const entries = [
  { name: 'world.yaml', data: readFileSync(join(root, 'world.yaml')) },
  { name: 'background.png', data: readFileSync(join(root, 'background.png')) },
  { name: 'characters.png', data: readFileSync(join(root, 'characters.png')) },
]

const locals = []
const centrals = []
let offset = 0
for (const entry of entries) {
  const name = Buffer.from(entry.name)
  const local = Buffer.alloc(30 + name.length + entry.data.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(crc32(entry.data) >>> 0, 14)
  local.writeUInt32LE(entry.data.length, 18)
  local.writeUInt32LE(entry.data.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  entry.data.copy(local, 30 + name.length)
  locals.push(local)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(crc32(entry.data) >>> 0, 16)
  central.writeUInt32LE(entry.data.length, 20)
  central.writeUInt32LE(entry.data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
  central.writeUInt32LE(offset, 42)
  name.copy(central, 46)
  centrals.push(central)
  offset += local.length
}

const centralDir = Buffer.concat(centrals)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(entries.length, 8)
eocd.writeUInt16LE(entries.length, 10)
eocd.writeUInt32LE(centralDir.length, 12)
eocd.writeUInt32LE(offset, 16)
writeFileSync(outPath, Buffer.concat([...locals, centralDir, eocd]))
process.stdout.write(`${outPath}\n`)

function solidPng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  return pngFile(width, height, raw)
}

function atlasPng() {
  const cols = 3
  const rows = 4
  const cell = 8
  const width = cols * cell
  const height = rows * cell
  const palette = [
    [220, 96, 72],
    [232, 176, 64],
    [96, 168, 88],
    [72, 140, 200],
    [168, 104, 196],
    [232, 128, 168],
    [88, 188, 176],
    [196, 140, 72],
    [120, 120, 136],
    [240, 208, 120],
    [64, 96, 80],
    [200, 80, 112],
  ]
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const index = Math.floor(y / cell) * cols + Math.floor(x / cell)
      const rgb = palette[index] ?? palette[0]
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  return pngFile(width, height, raw)
}

function pngFile(width, height, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  payload.copy(out, 4)
  out.writeUInt32BE(crc32(payload) >>> 0, 8 + data.length)
  return out
}
