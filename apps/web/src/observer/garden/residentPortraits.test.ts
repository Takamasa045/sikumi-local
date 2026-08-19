import { describe, expect, it } from 'vitest'
import {
  gardenResidentPortraitUrl,
  resolveGardenResidentKind,
} from './residentPortraits'

describe('resolveGardenResidentKind', () => {
  it('binds the tanuki by blog place name or blog-agent-kit', () => {
    expect(resolveGardenResidentKind('ブログ番', 'my-notes')).toBe('blog')
    expect(resolveGardenResidentKind('キット番', 'blog-agent-kit')).toBe('blog')
    expect(gardenResidentPortraitUrl('blog')).toContain('blog-ban')
  })

  it('binds the cat by しくみローカル番 or sikumi/shikumi repo names', () => {
    expect(resolveGardenResidentKind('しくみローカル番', 'notes')).toBe(
      'shikumi',
    )
    expect(resolveGardenResidentKind('キット番', 'sikumi-local')).toBe(
      'shikumi',
    )
    expect(resolveGardenResidentKind('キット番', 'shikumi_local')).toBe(
      'shikumi',
    )
    expect(gardenResidentPortraitUrl('shikumi')).toContain(
      'shikumi-local-ban',
    )
  })

  it('binds the bear by はたらき or the hataraki repo name', () => {
    expect(resolveGardenResidentKind('はたらき', 'office')).toBe('hataraki')
    expect(resolveGardenResidentKind('hataraki番', 'hataraki')).toBe('hataraki')
    expect(resolveGardenResidentKind('キット番', 'hataraki')).toBe('hataraki')
    expect(gardenResidentPortraitUrl('hataraki')).toContain('hataraki')
  })

  it('does not treat a path leaf *開発/hataraki as the hataraki place', () => {
    expect(
      resolveGardenResidentKind('*開発/hataraki番', '*開発/hataraki'),
    ).toBeNull()
    expect(
      resolveGardenResidentKind(
        'notes番',
        '/Users/me/Projects/*開発/hataraki',
      ),
    ).toBeNull()
    expect(resolveGardenResidentKind('はたらき', '*開発/hataraki')).toBe(
      'hataraki',
    )
  })

  it('falls back to the atlas for an unregistered new place', () => {
    expect(resolveGardenResidentKind('notes番', 'notes')).toBeNull()
    expect(resolveGardenResidentKind('ウェブ番', 'my-website')).toBeNull()
    expect(gardenResidentPortraitUrl(null)).toBeNull()
  })
})
