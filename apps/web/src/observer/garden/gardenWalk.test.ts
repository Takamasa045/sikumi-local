import { describe, expect, it } from 'vitest'
import {
  WORKING_WALK_POINTS,
  WORKING_WALK_STOPS,
  initialWalkIndex,
  nextWalkIndex,
  placeRepoLabel,
  walkStopAt,
  workingWalkPoint,
} from './gardenWalk'

describe('gardenWalk', () => {
  it('cycles working characters through the shelf, bench, and check place', () => {
    expect([...WORKING_WALK_STOPS]).toEqual(['archive', 'workbench', 'waiting'])
    expect(walkStopAt(0)).toBe('archive')
    expect(walkStopAt(1)).toBe('workbench')
    expect(walkStopAt(2)).toBe('waiting')
    expect(nextWalkIndex(0)).toBe(1)
    expect(nextWalkIndex(2)).toBe(0)
    expect(WORKING_WALK_POINTS.archive.y).toBeGreaterThanOrEqual(34)
    expect(WORKING_WALK_POINTS.archive.x).toBeGreaterThan(13)
  })

  it('keeps a stable starting stop and applies jitter on the ground', () => {
    expect(initialWalkIndex('repo_a')).toBe(initialWalkIndex('repo_a'))
    expect(initialWalkIndex('repo_a')).not.toBe(initialWalkIndex('repo_b'))
    const point = workingWalkPoint('workbench', { jitterX: 1, jitterY: -0.5 })
    expect(point).toEqual({ x: 50, y: 37.5 })
  })

  it('shows the repository name only when the place name does not already name it', () => {
    expect(placeRepoLabel('alpha番', 'alpha')).toBeNull()
    expect(placeRepoLabel('ブログ番', 'my-blog')).toBe('my-blog')
    expect(placeRepoLabel('しくみローカル番', 'sikumi-local')).toBe(
      'sikumi-local',
    )
    expect(placeRepoLabel('キット番', 'agent-workflow-kits')).toBe(
      'agent-workflow-kits',
    )
    expect(placeRepoLabel('notes番', '')).toBeNull()
  })
})
