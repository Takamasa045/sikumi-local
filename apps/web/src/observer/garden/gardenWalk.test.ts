import { describe, expect, it } from 'vitest'
import {
  GARDEN_PLACE_POINTS,
  GARDEN_WORK_GROUND,
} from '../places/placeResidents'
import {
  WORKING_WALK_LANE_X,
  WORKING_WALK_LOOP_RX,
  WORKING_WALK_PACE_X,
  WORKING_WALK_STOPS,
  initialWalkIndex,
  isWorkingWalkStop,
  nextWalkIndex,
  placeRepoLabel,
  walkFacing,
  walkLaneOffset,
  walkOrigin,
  walkStopAt,
  walkStopKind,
  workingWalkPoint,
} from './gardenWalk'

describe('gardenWalk', () => {
  it('sends a working character to a pace turnaround or a small loop point', () => {
    expect([...WORKING_WALK_STOPS]).toEqual([
      'pace-a',
      'pace-b',
      'loop-0',
      'loop-1',
      'loop-2',
      'loop-3',
    ])
    expect(walkStopAt(0)).toBe('pace-a')
    expect(walkStopAt(1)).toBe('pace-b')
    expect(walkStopKind(walkStopAt(0))).toBe('pace')
    expect(walkStopKind(walkStopAt(6))).toBe('loop')
    expect(nextWalkIndex(0)).toBe(1)
    expect(walkStopKind(walkStopAt(nextWalkIndex(0)))).toMatch(/pace|loop/)
    expect(walkStopKind(walkStopAt(nextWalkIndex(1)))).toBe('pace')
    expect(walkStopAt(nextWalkIndex(5))).toBe('loop-0')
    expect(isWorkingWalkStop(walkStopAt(nextWalkIndex(9)))).toBe(true)
  })

  it('keeps a stable starting stop and paces near the walker on the ground', () => {
    expect(initialWalkIndex('repo_a')).toBe(initialWalkIndex('repo_a'))
    expect(initialWalkIndex('repo_a')).not.toBe(initialWalkIndex('repo_b'))
    const actor = {
      jitterX: 1,
      jitterY: -0.5,
      groundX: GARDEN_PLACE_POINTS.workbench.x,
      groundY: GARDEN_PLACE_POINTS.workbench.y,
    }
    const left = workingWalkPoint('pace-a', actor)
    const right = workingWalkPoint('pace-b', actor)
    expect(right.x - left.x).toBeCloseTo(WORKING_WALK_PACE_X * 2, 5)
    expect(Math.hypot(right.x - left.x, right.y - left.y)).toBeLessThan(16)
    expect(
      Math.hypot(
        right.x - (actor.groundX + actor.jitterX),
        right.y - (actor.groundY + actor.jitterY),
      ),
    ).toBeLessThan(8)
    expect(walkFacing(left, actor)).toBe('left')
    expect(walkFacing(right, actor)).toBe('right')
    for (const stop of WORKING_WALK_STOPS) {
      const point = workingWalkPoint(stop, actor)
      expect(point.x).toBeGreaterThanOrEqual(GARDEN_WORK_GROUND.minX)
      expect(point.x).toBeLessThanOrEqual(GARDEN_WORK_GROUND.maxX)
      expect(point.y).toBeGreaterThanOrEqual(GARDEN_WORK_GROUND.minY)
      expect(point.y).toBeLessThanOrEqual(GARDEN_WORK_GROUND.maxY)
    }
  })

  it('keeps the loop small and staggers spin and oval height per character', () => {
    const first = {
      jitterX: 0.2,
      jitterY: 0.1,
      streamIndex: 0,
      slot: 0,
      groundX: GARDEN_PLACE_POINTS.workbench.x,
      groundY: GARDEN_PLACE_POINTS.workbench.y,
    }
    const second = {
      jitterX: -0.2,
      jitterY: -0.14,
      streamIndex: 0,
      slot: 1,
      groundX: GARDEN_PLACE_POINTS.workbench.x,
      groundY: GARDEN_PLACE_POINTS.workbench.y,
    }
    const firstLoop = WORKING_WALK_STOPS.filter(
      (stop) => walkStopKind(stop) === 'loop',
    ).map((stop) => workingWalkPoint(stop, first))
    const origin = walkOrigin(first)
    for (const point of firstLoop) {
      expect(Math.hypot(point.x - origin.x, point.y - origin.y)).toBeLessThan(6)
    }
    expect(walkStopAt(7, first)).toBe('loop-1')
    expect(walkStopAt(7, second)).toBe('loop-3')
    expect(workingWalkPoint('loop-1', first).y).not.toBe(
      workingWalkPoint('loop-1', second).y,
    )
    expect(WORKING_WALK_LOOP_RX).toBeLessThan(WORKING_WALK_PACE_X)
  })

  it('shifts a second live walker off the same stop so they are not hidden', () => {
    expect(walkLaneOffset({ streamIndex: 0, slot: 0 })).toEqual({ x: 0, y: 0 })
    expect(Math.abs(walkLaneOffset({ streamIndex: 1, slot: 1 }).x)).toBe(
      WORKING_WALK_LANE_X,
    )
    for (const stop of WORKING_WALK_STOPS) {
      const first = workingWalkPoint(stop, {
        jitterX: 0.3,
        jitterY: 0.2,
        streamIndex: 0,
        slot: 0,
      })
      const second = workingWalkPoint(stop, {
        jitterX: -0.2,
        jitterY: 0.1,
        streamIndex: 1,
        slot: 1,
      })
      expect(Math.abs(second.x - first.x)).toBeGreaterThanOrEqual(
        WORKING_WALK_LANE_X - 1,
      )
      expect(Math.abs(second.x - first.x)).toBeGreaterThan(2)
      expect(first).not.toEqual(second)
    }
  })

  it('shifts different places on the same stop by slot, even when both are stream 0', () => {
    expect(Math.abs(walkLaneOffset({ streamIndex: 0, slot: 1 }).x)).toBe(
      WORKING_WALK_LANE_X,
    )
    for (const stop of WORKING_WALK_STOPS) {
      const hataraki = workingWalkPoint(stop, {
        jitterX: 0.18,
        jitterY: 0.14,
        streamIndex: 0,
        slot: 0,
      })
      const sikumi = workingWalkPoint(stop, {
        jitterX: -0.18,
        jitterY: -0.14,
        streamIndex: 0,
        slot: 1,
      })
      expect(Math.abs(sikumi.x - hataraki.x)).toBeGreaterThanOrEqual(
        WORKING_WALK_LANE_X - 1,
      )
      expect(Math.abs(sikumi.x - hataraki.x)).toBeGreaterThan(2)
      expect(hataraki).not.toEqual(sikumi)
    }
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
