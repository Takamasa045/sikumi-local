import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

  it('prefers README.ja.md over an English README.md', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.md'),
      ['# Tsugite', '', 'A local video-production workshop.', ''].join('\n'),
    )
    writeFileSync(
      join(root, 'README.ja.md'),
      ['# 継', '', 'ローカルで動画を作る工房です。', ''].join('\n'),
    )
    expect(readPlaceIntro(root)).toBe('継。ローカルで動画を作る工房です。')
    expect(readPlaceIntro(root)).not.toContain('README')
    expect(readPlaceIntro(root)).not.toContain('video-production')
  })

  it('turns a readable English-only README into short everyday Japanese', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.md'),
      ['# Tsugite', '', 'A local video-production workshop.', ''].join('\n'),
    )
    expect(readPlaceIntro(root)).toBe('動画を作る場所')
    expect(readPlaceIntro(root)).not.toContain('README.md')
    expect(readPlaceIntro(root)).not.toContain('Tsugite')

    const observe = createTemp()
    writeFileSync(
      join(observe, 'readme.md'),
      ['# sikumi-local', '', 'An observer garden for local work.', ''].join(
        '\n',
      ),
    )
    expect(readPlaceIntro(observe)).toBe('観測する場所')
  })

  it('returns null when the README is missing or the English cannot be spoken', () => {
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

  it('reads a long Japanese README after language-switch lines and keeps the work words', () => {
    const root = createTemp()
    const workshop =
      'AI動画を作って終わりにせず、素材、制作ログ、判断、好みを次の制作へ継いでいくローカル動画制作工房です。'
    writeFileSync(
      join(root, 'README.md'),
      ['# Tsugite', '', 'A local video-production workshop.', ''].join('\n'),
    )
    writeFileSync(
      join(root, 'README.ja.md'),
      [
        '# Tsugite',
        '（言語切替リンク: English | 日本語 | 中文 | 한국어）',
        workshop,
        '',
        '## 詳細',
        'あ'.repeat(12_000),
        '',
      ].join('\n'),
    )
    const intro = readPlaceIntro(root)
    expect(statSync(join(root, 'README.ja.md')).size).toBeGreaterThan(16 * 1024)
    expect(intro).toBe(workshop)
    expect(intro).toContain('動画')
    expect(intro).toContain('工房')
    expect(intro).not.toContain('English | 日本語')
    expect(intro).not.toContain('Tsugite')
    expect(intro).not.toContain('README')
    expect(intro).not.toContain('言語切替')
  })

  it('skips markdown language tabs and heading-only proper names', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.ja.md'),
      [
        '# Tsugite',
        '',
        '[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md) | [한국어](README.ko.md)',
        '',
        'AI動画を作って終わりにせず、素材、制作ログ、判断、好みを次の制作へ継いでいくローカル動画制作工房です。',
        '',
      ].join('\n'),
    )
    const intro = readPlaceIntro(root)
    expect(intro).toContain('動画')
    expect(intro).toContain('ローカル動画制作工房')
    expect(intro).not.toContain('Tsugite')
    expect(intro).not.toContain('English')
    expect(intro).not.toContain('README')
  })

  it('keeps a work word when the 80-character clip would otherwise drop it', () => {
    const root = createTemp()
    const prefix = `${'あ'.repeat(70)}。`
    const work = 'ローカル動画制作工房です。'
    writeFileSync(
      join(root, 'README.md'),
      ['# はたらき', '', `${prefix}${work}`, ''].join('\n'),
    )
    const intro = readPlaceIntro(root)
    expect(intro).toContain('動画')
    expect(intro).not.toContain('README')
    expect(intro?.length).toBeLessThanOrEqual(80)
  })

  it('does not make an intro from leftover confirmation areas or porch copy', () => {
    const root = createTemp()
    writeFileSync(
      join(root, 'README.md'),
      ['# 作業中のファイル', '', '確認用の仕組み', ''].join('\n'),
    )
    expect(readPlaceIntro(root)).toBeNull()

    const porch = createTemp()
    writeFileSync(join(porch, 'README.md'), '縁側にいます\n')
    expect(readPlaceIntro(porch)).toBeNull()
  })
})

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-place-intro-'))
  tempDirectories.push(directory)
  return directory
}
