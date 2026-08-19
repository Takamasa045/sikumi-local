import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readPlaceIntro } from './place-intro.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('readPlaceIntro', () => {
  it('reads a Japanese README heading and first paragraph', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.md'),
      ['# はたらき', '', '働きの画面を整えるための場所です。', ''].join('\n'),
    )
    expect(readPlaceIntro(root)).toBe(
      'はたらき。働きの画面を整えるための場所です。',
    )
  })

  it('uses the Japanese paragraph when the heading is only English', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.md'),
      ['# hataraki', '', '働きの画面です。', ''].join('\n'),
    )
    expect(readPlaceIntro(root)).toBe('働きの画面です。')
    expect(readPlaceIntro(root)).not.toContain('README.md')
  })

  it('returns null when the README is English-only or missing', () => {
    const empty = createTemp()
    expect(readPlaceIntro(empty)).toBeNull()

    const english = createTemp()
    writeFileSync(join(english, 'README.md'), '# hataraki\n\nOffice UI.\n')
    expect(readPlaceIntro(english)).toBeNull()
  })

  it('does not invent a title from kit file names or unknown copy', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.md'),
      ['# README.md', '', 'まだ分かっていません', ''].join('\n'),
    )
    expect(readPlaceIntro(root)).toBeNull()
  })
})

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-place-intro-'))
  tempDirectories.push(directory)
  return directory
}
