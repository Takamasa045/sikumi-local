export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  constructor(private readonly maxItems?: number) {}

  get size(): number {
    return this.items.length
  }

  push(item: T): boolean {
    if (this.closed) {
      return false
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return true
    }
    if (this.maxItems !== undefined && this.items.length >= this.maxItems) {
      return false
    }
    this.items.push(item)
    return true
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const queued = this.items.shift()
      if (queued !== undefined) {
        yield queued
        continue
      }
      if (this.closed) {
        return
      }
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiters.push(resolve)
      })
      if (next.done) {
        continue
      }
      yield next.value
    }
  }
}
