import type { Readable, Writable } from 'node:stream'
import {
  CLAUDE_DESKTOP_INSTRUCTION,
  MAX_MCP_MESSAGE_BYTES,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from './events.js'
import {
  callSikumiTool,
  cooperativeInstructionText,
  listSikumiTools,
  type CooperativeToolContext,
  type CooperativeToolResult,
} from './tools.js'

export interface McpJsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id?: string | number | null
  readonly method?: string
  readonly params?: unknown
}

export interface McpJsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: string | number | null
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

export function serializeMcpMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

export function handleMcpMessage(
  message: unknown,
  context: CooperativeToolContext,
  stderr?: Writable,
): McpJsonRpcResponse | null {
  if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
    writeProtocolNotice(stderr, 'invalid JSON-RPC request')
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    }
  }
  const id =
    typeof message.id === 'string' || typeof message.id === 'number'
      ? message.id
      : message.id === null
        ? null
        : undefined
  const method = typeof message.method === 'string' ? message.method : ''
  if (id === undefined) {
    if (
      method === 'notifications/initialized' ||
      method === 'initialized' ||
      method.startsWith('notifications/')
    ) {
      return null
    }
    writeProtocolNotice(stderr, `ignored notification: ${method || 'unknown'}`)
    return null
  }
  if (method === 'initialize') {
    const requested = readProtocolVersion(message.params)
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requested ?? MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        instructions: cooperativeInstructionText(),
      },
    }
  }
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: listSikumiTools() },
    }
  }
  if (method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id,
      result: callToolResult(message.params, context, stderr),
    }
  }
  writeProtocolNotice(stderr, `method not found: ${method}`)
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}

export async function serveMcpStdio(
  io: {
    readonly stdin: Readable
    readonly stdout: Writable
    readonly stderr: Writable
  },
  context: CooperativeToolContext,
): Promise<void> {
  let leftover: Buffer = Buffer.alloc(0)
  for await (const chunk of io.stdin) {
    leftover = Buffer.concat([
      leftover,
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
    ])
    if (leftover.length > MAX_MCP_MESSAGE_BYTES) {
      writeProtocolNotice(io.stderr, 'stdio message exceeded size limit')
      writeMcpResponse(io.stdout, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Message too large' },
      })
      leftover = Buffer.alloc(0)
      continue
    }
    leftover = drainMcpBuffer(leftover, io.stdout, io.stderr, context)
  }
}

export const CLAUDE_DESKTOP_MCP_INSTRUCTIONS = CLAUDE_DESKTOP_INSTRUCTION

function drainMcpBuffer(
  buffer: Buffer,
  stdout: Writable,
  stderr: Writable,
  context: CooperativeToolContext,
): Buffer {
  let remaining = buffer
  while (remaining.length > 0) {
    const newline = remaining.indexOf(0x0a)
    if (newline < 0) {
      return remaining
    }
    const line = remaining
      .subarray(0, newline)
      .toString('utf8')
      .replace(/\r$/, '')
    remaining = remaining.subarray(newline + 1)
    if (line.length === 0) {
      continue
    }
    if (Buffer.byteLength(line, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
      writeProtocolNotice(stderr, 'stdio line exceeded size limit')
      writeMcpResponse(stdout, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Message too large' },
      })
      continue
    }
    dispatchRaw(line, stdout, stderr, context)
  }
  return remaining
}

function dispatchRaw(
  raw: string,
  stdout: Writable,
  stderr: Writable,
  context: CooperativeToolContext,
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    writeProtocolNotice(stderr, 'JSON-RPC parse error')
    writeMcpResponse(stdout, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
    return
  }
  try {
    const response = handleMcpMessage(parsed, context, stderr)
    if (response) {
      writeMcpResponse(stdout, response)
    }
  } catch (error) {
    writeProtocolNotice(
      stderr,
      error instanceof Error ? error.message : 'mcp handler failed',
    )
    writeMcpResponse(stdout, {
      jsonrpc: '2.0',
      id: readMessageId(parsed),
      error: { code: -32603, message: 'Internal error' },
    })
  }
}

export function writeMcpResponse(
  stdout: Writable,
  response: McpJsonRpcResponse,
): void {
  stdout.write(serializeMcpMessage(response))
}

function callToolResult(
  params: unknown,
  context: CooperativeToolContext,
  stderr?: Writable,
): {
  readonly content: ReadonlyArray<{
    readonly type: 'text'
    readonly text: string
  }>
  readonly isError: boolean
  readonly structuredContent: CooperativeToolResult
} {
  try {
    const record = isPlainObject(params) ? params : {}
    const name = typeof record.name === 'string' ? record.name : ''
    const result = callSikumiTool(name, record.arguments, context)
    if (result.ok === false) {
      writeProtocolNotice(
        stderr,
        `${result.tool}: ${result.code}: ${result.message}`,
      )
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: result.ok === false,
      structuredContent: result,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'tool execution failed'
    writeProtocolNotice(stderr, message)
    const result: CooperativeToolResult = {
      ok: false,
      tool: 'unknown',
      cooperative: true,
      code: 'invalid_input',
      message,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: true,
      structuredContent: result,
    }
  }
}

function readProtocolVersion(params: unknown): string | null {
  if (!isPlainObject(params) || typeof params.protocolVersion !== 'string') {
    return null
  }
  return params.protocolVersion
}

function readMessageId(message: unknown): string | number | null {
  if (!isPlainObject(message)) {
    return null
  }
  return typeof message.id === 'string' || typeof message.id === 'number'
    ? message.id
    : null
}

function writeProtocolNotice(
  stderr: Writable | undefined,
  message: string,
): void {
  stderr?.write(`sikumi-observer-claude-desktop: ${message}\n`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
