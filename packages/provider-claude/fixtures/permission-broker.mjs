import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const controlDir = readArg('--control-dir') ?? process.cwd()
mkdirSync(controlDir, { recursive: true })

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  drain()
})

function drain() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) {
      return
    }
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const start = headerEnd + 4
    if (buffer.length < start + length) {
      return
    }
    const body = buffer.slice(start, start + length).toString('utf8')
    buffer = buffer.slice(start + length)
    void handleMessage(JSON.parse(body))
  }
}

async function handleMessage(message) {
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'shikumi-permission-broker', version: '0.1.0' },
      },
    })
    return
  }
  if (message.method === 'notifications/initialized') {
    return
  }
  if (message.method === 'tools/list') {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'request_permission',
            description: 'Ask the Shikumi Local user to approve a tool',
            inputSchema: {
              type: 'object',
              additionalProperties: true,
            },
          },
        ],
      },
    })
    return
  }
  if (message.method === 'tools/call') {
    const requestId = randomUUID()
    writeAtomicJson(join(controlDir, 'request.json'), {
      requestId,
      toolName: message.params?.name ?? 'request_permission',
      input: message.params?.arguments ?? {},
    })
    const decision = await waitForDecision(requestId)
    const allowed = decision === 'approved'
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              allowed
                ? { behavior: 'allow' }
                : { behavior: 'deny', message: 'User denied' },
            ),
          },
        ],
      },
    })
  }
}

function waitForDecision(requestId) {
  const decisionPath = join(controlDir, 'decision.json')
  const requestPath = join(controlDir, 'request.json')
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!existsSync(decisionPath)) {
        return
      }
      try {
        const parsed = JSON.parse(readFileSync(decisionPath, 'utf8'))
        if (parsed.requestId !== requestId) {
          return
        }
        const decision = parsed.decision === 'approved' ? 'approved' : 'denied'
        clearInterval(timer)
        rmSync(decisionPath, { force: true })
        rmSync(requestPath, { force: true })
        resolve(decision)
      } catch {
        // Decision file is still being written.
      }
    }, 20)
  })
}

function writeAtomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value), {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(temporary, path)
}

function writeMessage(payload) {
  const body = JSON.stringify(payload)
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  )
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
