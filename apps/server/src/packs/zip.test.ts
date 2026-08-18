import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_PACK_TOTAL_BYTES } from '@sikumi-local/employee-sdk'
import { createTemporaryDirectory } from '../test/git-fixture.js'
import { extractZipSafely } from './zip.js'
import { buildZip } from './zip-fixture.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('safe zip extraction', () => {
  it('extracts a data-only zip and rejects zip slip, executables, and bombs', () => {
    const dest = track(createTemporaryDirectory())
    const ok = buildZip([
      { name: 'world.yaml', content: 'id: night\nversion: 1.0.0\n' },
    ])
    const extracted = extractZipSafely(ok, dest)
    expect(extracted.names).toEqual(['world.yaml'])
    expect(readFileSync(join(dest, 'world.yaml'), 'utf8')).toContain('night')

    expect(() =>
      extractZipSafely(
        buildZip([{ name: '../escape.yaml', content: 'nope' }]),
        dest,
      ),
    ).toThrow(/not safe/)
    expect(() =>
      extractZipSafely(
        buildZip([{ name: 'run.sh', content: '#!/bin/sh\n' }]),
        dest,
      ),
    ).toThrow(/data-only/)
    expect(() =>
      extractZipSafely(
        buildZip([{ name: 'link.txt', content: 'x', symlink: true }]),
        dest,
      ),
    ).toThrow(/symlink/)
    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'bomb.txt',
            content: 'a'.repeat(2000),
            pretendCompressedSize: 1,
          },
        ]),
        dest,
      ),
    ).toThrow(/ratio|large|unsafe/)
    expect(() => extractZipSafely(Buffer.from('not-a-zip'), dest)).toThrow(
      /end of central|invalid/i,
    )
  })

  it('rejects zip-slip and forged local headers that disagree with central', () => {
    const dest = track(createTemporaryDirectory())
    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'safe.yaml',
            localName: '../escape.yaml',
            content: 'escaped',
          },
        ]),
        dest,
      ),
    ).toThrow(/local header|match/)
    expect(existsSync(join(dest, '..', 'escape.yaml'))).toBe(false)

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            method: 0,
            localMethod: 8,
          },
        ]),
        dest,
      ),
    ).toThrow(/local header|match/)

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            localCompressedSize: 1,
          },
        ]),
        dest,
      ),
    ).toThrow(/local header|match/)
  })

  it('rejects stored payload length, CRC, and central bound forgeries', () => {
    const dest = track(createTemporaryDirectory())
    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'hello',
            payload: Buffer.from('hi'),
            compressedSize: 2,
            uncompressedSize: 10,
          },
        ]),
        dest,
      ),
    ).toThrow(/payload length|uncompressed|CRC|local header|match/)

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: night\n',
            crc: 1,
          },
        ]),
        dest,
      ),
    ).toThrow(/CRC/)

    expect(() =>
      extractZipSafely(
        buildZip([{ name: 'world.yaml', content: 'id: night\n' }], {
          centralOffset: 0xffff,
        }),
        dest,
      ),
    ).toThrow(/central|bounds|invalid/)

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            uncompressedSize: 0xffffffff,
          },
        ]),
        dest,
      ),
    ).toThrow(/Zip64|too large|unsafe/)
  })

  it('rejects git metadata and hidden secret files inside the archive', () => {
    const dest = track(createTemporaryDirectory())
    expect(() =>
      extractZipSafely(
        buildZip([{ name: '.git/config', content: 'bad' }]),
        dest,
      ),
    ).toThrow(/git metadata|data-only|forbidden/)
    expect(() =>
      extractZipSafely(buildZip([{ name: '.env', content: 'SECRET=1' }]), dest),
    ).toThrow(/data-only|forbidden/)
    expect(() =>
      extractZipSafely(
        buildZip([{ name: '.npmrc', content: '//token' }]),
        dest,
      ),
    ).toThrow(/data-only|forbidden/)
  })

  it('covers remaining fail-closed zip branches', () => {
    const dest = track(createTemporaryDirectory())
    const raw = Buffer.from('id: night\nversion: 1.0.0\n')
    const compressed = deflateRawSync(raw)
    const inflated = extractZipSafely(
      buildZip([
        {
          name: 'world.yaml',
          content: raw.toString('utf8'),
          method: 8,
          payload: compressed,
          compressedSize: compressed.length,
          uncompressedSize: raw.length,
          crc: crc32(raw),
        },
      ]),
      dest,
    )
    expect(inflated.names).toEqual(['world.yaml'])

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'docs/readme.txt',
            content: 'x',
          },
          {
            name: 'docs/',
            content: '',
          },
        ]),
        dest,
      ),
    ).not.toThrow()

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            method: 8,
            payload: Buffer.from('not-deflate'),
            compressedSize: 11,
            uncompressedSize: 6,
          },
        ]),
        dest,
      ),
    ).toThrow(/inflation|CRC|local header|match/)

    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            method: 99,
          },
        ]),
        dest,
      ),
    ).toThrow(/Unsupported zip compression/)

    expect(() =>
      extractZipSafely(
        buildZip([{ name: 'dir\\file.yaml', content: 'x' }]),
        dest,
      ),
    ).toThrow(/not safe/)
    expect(() =>
      extractZipSafely(buildZip([{ name: 'C:abs.yaml', content: 'x' }]), dest),
    ).toThrow(/not safe/)
    expect(() =>
      extractZipSafely(
        buildZip([{ name: 'foo//bar.yaml', content: 'x' }]),
        dest,
      ),
    ).toThrow(/not safe/)
    expect(() =>
      extractZipSafely(buildZip([{ name: 'secret.pem', content: 'k' }]), dest),
    ).toThrow(/data-only|forbidden/)
    expect(() =>
      extractZipSafely(
        buildZip([{ name: 'world.yaml', content: 'id: x\n' }], {
          diskEntries: 0,
        }),
        dest,
      ),
    ).toThrow(/Split zip/)
    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            localHeaderOffset: 0xffffffff,
          },
        ]),
        dest,
      ),
    ).toThrow(/Zip64|local header|invalid/)
    expect(() =>
      extractZipSafely(Buffer.alloc(MAX_PACK_TOTAL_BYTES * 2 + 1), dest),
    ).toThrow(/too large/)
    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            flags: 0x0001,
          },
        ]),
        dest,
      ),
    ).toThrow(/Encrypted zip/)
    expect(() =>
      extractZipSafely(
        buildZip([
          {
            name: 'world.yaml',
            content: 'id: x\n',
            flags: 0x0008,
          },
        ]),
        dest,
      ),
    ).toThrow(/data descriptors/)
  })
})

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
