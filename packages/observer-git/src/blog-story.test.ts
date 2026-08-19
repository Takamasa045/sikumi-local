import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  looksLikeBlogKit,
  readBlogArticleTitles,
  readBlogWorkStory,
} from './blog-story.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('readBlogWorkStory', () => {
  it('returns null when the place is not a blog kit', () => {
    const root = createTemp()
    writeFileSync(join(root, 'README.md'), '# hataraki\n')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/App.tsx'), 'export {}\n')
    expect(looksLikeBlogKit(root)).toBe(false)
    expect(readBlogWorkStory(root)).toBeNull()
    expect(readBlogWorkStory(root, { changedPaths: ['src/App.tsx'] })).toBeNull()
  })

  it('reads the latest articles.log title without inventing one', () => {
    const root = createBlogKit({
      articlesLog: [
        'date | title | characters | memo',
        '2026-08-01 | 短い下書き | 400 | ',
        '2026-08-15 | AIチームは多いほど強い、ではなかった | 3200 | 公開',
      ].join('\n'),
    })

    expect(looksLikeBlogKit(root)).toBe(true)
    expect(readBlogWorkStory(root)).toBe(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
  })

  it('uses a topic brief title only when that topic is clearly in progress', () => {
    const root = createBlogKit({
      articlesLog: [
        'date | title | characters | memo',
        '2026-08-01 | 短い下書き | 400 |',
      ].join('\n'),
      topics: [
        {
          folder: '2026-08-10_older',
          title: '古い下書き',
        },
        {
          folder: '2026-08-15_ai-agent-wiring',
          title: 'AIエージェントの配線',
        },
      ],
    })

    expect(readBlogWorkStory(root)).toBe(
      'いちばん新しい記事は『短い下書き』です',
    )
    expect(
      readBlogWorkStory(root, {
        changedPaths: [
          'MEMORY.md',
          'topics/2026-08-15_ai-agent-wiring/brief.yml',
        ],
      }),
    ).toBe('『AIエージェントの配線』を書いています')
  })

  it('falls back to the newest topic brief title when the log has no article', () => {
    const root = createBlogKit({
      articlesLog: 'date | title | characters | memo\n',
      topics: [
        { folder: '2026-08-10_older', title: '古い下書き' },
        { folder: '2026-08-15_ai-agent-wiring', title: 'AIエージェントの配線' },
      ],
    })
    expect(readBlogWorkStory(root)).toBe(
      'いちばん新しい記事は『AIエージェントの配線』です',
    )
  })

  it('says 記事の続きがある when kit files exist but no title can be read', () => {
    const root = createBlogKit({
      articlesLog: 'date | title | characters | memo\n',
    })
    expect(readBlogWorkStory(root)).toBe('記事の続きがある')
    expect(readBlogWorkStory(root)).not.toContain('AIチーム')
    expect(readBlogWorkStory(root)).not.toContain('MEMORY.md')
  })

  it('never uses kit file names as an article title', () => {
    const root = createBlogKit({
      articlesLog: [
        'date | title | characters | memo',
        '2026-08-15 | MEMORY.md | 12 |',
        '2026-08-16 | BLOG_WORKSPACE.md | 8 |',
      ].join('\n'),
    })
    expect(readBlogWorkStory(root)).toBe('記事の続きがある')
    expect(readBlogWorkStory(root, { changedPaths: ['MEMORY.md'] })).toBe(
      '記事の続きがある',
    )
  })

  it('lists readable article titles newest first without inventing one', () => {
    const root = createBlogKit({
      articlesLog: [
        'date | title | characters | memo',
        '2026-07-01 | 短い下書き | 400 |',
        '2026-08-01 | 春のメモ | 800 |',
        '2026-08-15 | AIチームは多いほど強い、ではなかった | 3200 | 公開',
        '2026-08-16 | MEMORY.md | 12 |',
      ].join('\n'),
      topics: [
        { folder: '2026-08-10_older', title: '古い下書き' },
        { folder: '2026-08-18_later', title: 'まだ書いていない題' },
      ],
    })

    expect(readBlogArticleTitles(root)).toEqual([
      { title: 'まだ書いていない題', date: '2026-08-18' },
      { title: 'AIチームは多いほど強い、ではなかった', date: '2026-08-15' },
      { title: '古い下書き', date: '2026-08-10' },
      { title: '春のメモ', date: '2026-08-01' },
      { title: '短い下書き', date: '2026-07-01' },
    ])
    expect(readBlogWorkStory(root)).toBe(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
    expect(JSON.stringify(readBlogArticleTitles(root))).not.toContain(
      'MEMORY.md',
    )
  })

  it('omits the history when no article title can be read', () => {
    const root = createBlogKit({
      articlesLog: 'date | title | characters | memo\n',
    })
    expect(readBlogArticleTitles(root)).toEqual([])
  })

  it('does not treat a topics folder without the blog workspace as a kit', () => {
    const root = createTemp()
    mkdirSync(join(root, 'topics', '2026-08-15_ai-agent-wiring'), {
      recursive: true,
    })
    writeFileSync(
      join(root, 'topics', '2026-08-15_ai-agent-wiring', 'brief.yml'),
      'title: 勝手な記事\n',
    )
    expect(looksLikeBlogKit(root)).toBe(false)
    expect(readBlogWorkStory(root)).toBeNull()
  })
})

function createBlogKit(input: {
  readonly articlesLog?: string
  readonly topics?: readonly { readonly folder: string; readonly title: string }[]
}): string {
  const root = createTemp()
  writeFileSync(join(root, 'BLOG_WORKSPACE.md'), '# blog workspace\n')
  writeFileSync(join(root, 'MEMORY.md'), 'memory\n')
  writeFileSync(join(root, 'STYLE.md'), 'style\n')
  if (input.articlesLog !== undefined) {
    writeFileSync(join(root, 'articles.log'), `${input.articlesLog}\n`)
  }
  for (const topic of input.topics ?? []) {
    const folder = join(root, 'topics', topic.folder)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'brief.yml'), `title: ${topic.title}\n`)
  }
  return root
}

function createTemp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-blog-story-'))
  tempDirectories.push(directory)
  return directory
}
