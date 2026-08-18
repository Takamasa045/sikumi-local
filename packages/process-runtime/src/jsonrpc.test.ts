import { describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import { AsyncQueue } from './queue.js'
import { createJsonRpcClient } from './jsonrpc.js'
import type { ManagedProcess, ProcessExitResult } from './spawn.js'

describe('createJsonRpcClient', () => {
  it('matches responses to pending requests and routes server requests', async () => {
    const fake = createFakeProcess()
    const client = createJsonRpcClient(fake, { requestTimeoutMs: 1_000 })
    const incoming: string[] = []
    fake.onWrite = (line) => {
      incoming.push(line)
    }

    const seen: string[] = []
    client.onRequest((message) => {
      seen.push(message.method)
      client.respond(message.id, { decision: 'accept' })
    })
    client.onNotification((message) => {
      seen.push(message.method)
    })

    const resultPromise = client.request<{ ok: boolean }>('initialize', {
      clientInfo: { name: 'shikumi-local', version: '0.1.0' },
    })
    await waitFor(() => incoming.length > 0)
    fake.push({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    await expect(resultPromise).resolves.toEqual({ ok: true })

    fake.push({
      jsonrpc: '2.0',
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'ls' },
    })
    fake.push({ method: 'turn/started' })
    await waitFor(() => seen.length === 2)
    expect(seen).toEqual([
      'item/commandExecution/requestApproval',
      'turn/started',
    ])
    expect(incoming.some((line) => line.includes('"decision":"accept"'))).toBe(
      true,
    )

    client.notify('initialized')
    client.respondError('srv-2', 'nope', -32001)
    client.cancelPending()
    fake.close()
    expect(incoming.some((line) => line.includes('"nope"'))).toBe(true)
  })

  it('rejects a JSON-RPC error result', async () => {
    const fake = createFakeProcess()
    const client = createJsonRpcClient(fake, { requestTimeoutMs: 1_000 })
    const pending = client.request('account/read', {})
    fake.push({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'no account' },
    })
    await expect(pending).rejects.toMatchObject({ message: 'no account' })
    fake.close()
  })

  it('rejects pending requests when the process closes', async () => {
    const fake = createFakeProcess()
    const client = createJsonRpcClient(fake, { requestTimeoutMs: 1_000 })
    const pending = client.request('account/read', {})
    fake.close()
    await expect(pending).rejects.toBeInstanceOf(AppError)
  })
})

function createFakeProcess() {
  const events = new AsyncQueue<Record<string, unknown>>()
  let onWrite: ((line: string) => void) | undefined
  const processLike = {
    pid: 1,
    jsonl: events,
    writeStdin(line: string) {
      onWrite?.(line)
    },
    async cancel() {},
    wait(): Promise<ProcessExitResult> {
      return Promise.resolve({
        code: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        outputOverflowed: false,
      })
    },
    push(value: Record<string, unknown>) {
      events.push(value)
    },
    close() {
      events.close()
    },
    set onWrite(handler: (line: string) => void) {
      onWrite = handler
    },
  }
  return processLike as ManagedProcess & {
    push(value: Record<string, unknown>): void
    close(): void
    onWrite: (line: string) => void
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
  throw new Error('timed out')
}
