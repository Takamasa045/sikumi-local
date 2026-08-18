import { describe, expect, it } from 'vitest'
import { AsyncQueue } from './queue.js'

describe('AsyncQueue', () => {
  it('ignores pushes and extra closes after the queue is closed', async () => {
    const queue = new AsyncQueue<number>()
    queue.push(1)
    queue.close()
    queue.push(2)
    queue.close()

    const values: number[] = []
    for await (const value of queue) {
      values.push(value)
    }

    expect(values).toEqual([1])
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
