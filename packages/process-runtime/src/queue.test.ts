import { describe, expect, it } from 'vitest'
import { AsyncQueue } from './queue.js'

describe('AsyncQueue', () => {
  it('ignores pushes and extra closes after the queue is closed', async () => {
    const queue = new AsyncQueue<number>()
    expect(queue.push(1)).toBe(true)
    queue.close()
    expect(queue.push(2)).toBe(false)
    queue.close()

    const values: number[] = []
    for await (const value of queue) {
      values.push(value)
    }

    expect(values).toEqual([1])
  })

  it('drains items queued before close after a waiter is released', async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    const consume = (async () => {
      const values: number[] = []
      for await (const value of queue) {
        values.push(value)
      }
      return values
    })()
    queue.push(2)
    queue.close()
    await expect(consume).resolves.toEqual([1, 2])
  })

  it('rejects additional items when the bound is reached without shifting', async () => {
    const queue = new AsyncQueue<number>(2)
    expect(queue.push(1)).toBe(true)
    expect(queue.push(2)).toBe(true)
    expect(queue.push(3)).toBe(false)
    expect(queue.size).toBe(2)
    queue.close()
    const values: number[] = []
    for await (const value of queue) {
      values.push(value)
    }
    expect(values).toEqual([1, 2])
    expect(queue.size).toBe(0)
  })

  it('delivers to a waiter even when the stored bound is zero', async () => {
    const queue = new AsyncQueue<number>(0)
    expect(queue.push(1)).toBe(false)
    expect(queue.size).toBe(0)
    const consume = (async () => {
      const values: number[] = []
      for await (const value of queue) {
        values.push(value)
        break
      }
      return values
    })()
    await Promise.resolve()
    expect(queue.push(2)).toBe(true)
    queue.close()
    await expect(consume).resolves.toEqual([2])
  })

  it('wakes a waiting iterator when closed', async () => {
    const queue = new AsyncQueue<string>()
    const consume = (async () => {
      const values: string[] = []
      for await (const value of queue) {
        values.push(value)
      }
      return values
    })()

    await Promise.resolve()
    queue.close()
    await expect(consume).resolves.toEqual([])
  })
})
