import { AppError } from '@sikumi-local/core'
import type { ManagedProcess } from './spawn.js'

export type JsonRpcId = string | number

export interface JsonRpcRequest {
  readonly jsonrpc?: string
  readonly id: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcNotification {
  readonly jsonrpc?: string
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcSuccess {
  readonly jsonrpc?: string
  readonly id: JsonRpcId
  readonly result: unknown
}

export interface JsonRpcFailure {
  readonly jsonrpc?: string
  readonly id: JsonRpcId
  readonly error: {
    readonly code?: number
    readonly message?: string
  }
}

export interface JsonRpcClient {
  request<T>(method: string, params?: unknown): Promise<T>
  notify(method: string, params?: unknown): void
  respond(id: JsonRpcId, result: unknown): void
  respondError(id: JsonRpcId, message: string, code?: number): void
  onRequest(handler: (message: JsonRpcRequest) => void): void
  onNotification(handler: (message: JsonRpcNotification) => void): void
  cancelPending(reason?: string): void
}

export function createJsonRpcClient(
  child: ManagedProcess,
  options: { readonly requestTimeoutMs?: number } = {},
): JsonRpcClient {
  const pending = new Map<
    string,
    {
      readonly resolve: (value: unknown) => void
      readonly reject: (error: unknown) => void
      readonly timer: NodeJS.Timeout
    }
  >()
  let nextId = 1
  let requestHandler: ((message: JsonRpcRequest) => void) | undefined
  let notificationHandler: ((message: JsonRpcNotification) => void) | undefined
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000

  void consume()

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      const id = nextId
      nextId += 1
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(String(id))
          reject(
            new AppError(
              'PROCESS_TIMEOUT',
              `JSON-RPC request timed out: ${method}`,
              504,
            ),
          )
        }, requestTimeoutMs)
        timer.unref()
        pending.set(String(id), {
          resolve: (value) => resolve(value as T),
          reject,
          timer,
        })
        write({
          jsonrpc: '2.0',
          id,
          method,
          ...(params === undefined ? {} : { params }),
        })
      })
    },

    notify(method, params) {
      write({
        jsonrpc: '2.0',
        method,
        ...(params === undefined ? {} : { params }),
      })
    },

    respond(id, result) {
      write({ jsonrpc: '2.0', id, result })
    },

    respondError(id, message, code = -32000) {
      write({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      })
    },

    onRequest(handler) {
      requestHandler = handler
    },

    onNotification(handler) {
      notificationHandler = handler
    },

    cancelPending(reason = 'JSON-RPC client cancelled') {
      for (const [key, waiter] of pending) {
        clearTimeout(waiter.timer)
        waiter.reject(new AppError('PROCESS_SPAWN_REJECTED', reason, 409))
        pending.delete(key)
      }
    },
  }

  async function consume(): Promise<void> {
    try {
      for await (const raw of child.jsonl) {
        dispatch(raw)
      }
    } finally {
      for (const [key, waiter] of pending) {
        clearTimeout(waiter.timer)
        waiter.reject(
          new AppError(
            'PROCESS_SPAWN_REJECTED',
            'Provider process closed',
            500,
          ),
        )
        pending.delete(key)
      }
    }
  }

  function dispatch(raw: Record<string, unknown>): void {
    const id = raw.id
    const method = raw.method
    if (typeof method === 'string' && isJsonRpcId(id)) {
      requestHandler?.({
        method,
        id,
        ...(raw.jsonrpc === undefined ? {} : { jsonrpc: String(raw.jsonrpc) }),
        ...(raw.params === undefined ? {} : { params: raw.params }),
      })
      return
    }
    if (typeof method === 'string') {
      notificationHandler?.({
        method,
        ...(raw.jsonrpc === undefined ? {} : { jsonrpc: String(raw.jsonrpc) }),
        ...(raw.params === undefined ? {} : { params: raw.params }),
      })
      return
    }
    if (!isJsonRpcId(id)) {
      return
    }
    const waiter = pending.get(String(id))
    if (!waiter) {
      return
    }
    pending.delete(String(id))
    clearTimeout(waiter.timer)
    if ('error' in raw && raw.error !== undefined) {
      const message =
        isPlainObject(raw.error) && typeof raw.error.message === 'string'
          ? raw.error.message
          : 'JSON-RPC request failed'
      waiter.reject(new AppError('PROCESS_SPAWN_REJECTED', message, 500))
      return
    }
    waiter.resolve(raw.result)
  }

  function write(payload: Record<string, unknown>): void {
    child.writeStdin(JSON.stringify(payload))
  }
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
