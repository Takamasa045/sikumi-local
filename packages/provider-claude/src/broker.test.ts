import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePermissionBrokerPath } from './adapter.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('permission broker MCP', () => {
  it('lists the request_permission tool and returns an allow decision', async () => {
    const controlDir = mkdtempSync(join(tmpdir(), 'sikumi-broker-'))
    directories.push(controlDir)
    const child = spawn(
      process.execPath,
      [resolvePermissionBrokerPath(), '--control-dir', controlDir],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const listed = await rpc(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })
    expect(JSON.stringify(listed)).toContain('request_permission')

    const call = rpc(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'request_permission', arguments: { tool: 'WebSearch' } },
    })
    await waitForFile(join(controlDir, 'request.json'))
    const firstRequest = JSON.parse(
      readFileSync(join(controlDir, 'request.json'), 'utf8'),
    ) as { requestId: string }
    expect(firstRequest.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    writeFileSync(
      join(controlDir, 'decision.json'),
      JSON.stringify({
        requestId: firstRequest.requestId,
        decision: 'approved',
      }),
    )
    const result = await call
    expect(JSON.stringify(result)).toContain('allow')
    expect(existsSync(join(controlDir, 'decision.json'))).toBe(false)
    expect(existsSync(join(controlDir, 'request.json'))).toBe(false)
    child.kill('SIGTERM')
  })

  it('ignores leftover decisions and refuses to reuse the same decision', async () => {
    const controlDir = mkdtempSync(join(tmpdir(), 'sikumi-broker-'))
    directories.push(controlDir)
    const child = spawn(
      process.execPath,
      [resolvePermissionBrokerPath(), '--control-dir', controlDir],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    writeFileSync(
      join(controlDir, 'decision.json'),
      JSON.stringify({ requestId: 'stale-request', decision: 'approved' }),
    )

    const firstCall = rpc(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'request_permission', arguments: { tool: 'Bash' } },
    })
    await waitForFile(join(controlDir, 'request.json'))
    const firstRequest = JSON.parse(
      readFileSync(join(controlDir, 'request.json'), 'utf8'),
    ) as { requestId: string }
    expect(firstRequest.requestId).not.toBe('stale-request')
    await sleep(80)
    expect(existsSync(join(controlDir, 'request.json'))).toBe(true)

    writeFileSync(
      join(controlDir, 'decision.json'),
      JSON.stringify({ requestId: firstRequest.requestId, decision: 'denied' }),
    )
    const firstResult = await firstCall
    expect(JSON.stringify(firstResult)).toContain('deny')
    expect(existsSync(join(controlDir, 'decision.json'))).toBe(false)

    const secondCall = rpc(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'request_permission', arguments: { tool: 'Write' } },
    })
    await waitForFile(join(controlDir, 'request.json'))
    const secondRequest = JSON.parse(
      readFileSync(join(controlDir, 'request.json'), 'utf8'),
    ) as { requestId: string }
    expect(secondRequest.requestId).not.toBe(firstRequest.requestId)

    writeFileSync(
      join(controlDir, 'decision.json'),
      JSON.stringify({ requestId: firstRequest.requestId, decision: 'denied' }),
    )
    await sleep(80)
    expect(existsSync(join(controlDir, 'request.json'))).toBe(true)

    writeFileSync(
      join(controlDir, 'decision.json'),
      JSON.stringify({
        requestId: secondRequest.requestId,
        decision: 'approved',
      }),
    )
    const secondResult = await secondCall
    expect(JSON.stringify(secondResult)).toContain('allow')
    child.kill('SIGTERM')
  })
})

function rpc(
  child: ReturnType<typeof spawn>,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const body = JSON.stringify(payload)
  child.stdin?.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  )
  return readOne(child)
}

function readOne(child: ReturnType<typeof spawn>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }
      const header = buffer.slice(0, headerEnd).toString('utf8')
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        return
      }
      const length = Number(match[1])
      const start = headerEnd + 4
      if (buffer.length < start + length) {
        return
      }
      child.stdout?.off('data', onData)
      resolve(JSON.parse(buffer.slice(start, start + length).toString('utf8')))
    }
    child.stdout?.on('data', onData)
    child.once('error', reject)
  })
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return
    }
    await sleep(20)
  }
  throw new Error(`missing ${path}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
