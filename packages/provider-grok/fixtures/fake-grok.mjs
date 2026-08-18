import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)

if (argv.includes('--always-approve') || argv.includes('--worktree')) {
  process.stderr.write('forbidden flag\n')
  process.exit(3)
}

if (argv[0] === 'version' || argv.includes('version')) {
  process.stdout.write(
    '{"currentVersion":"1.0.5-fixture","channel":"unknown"}\n',
  )
  process.exit(0)
}

if (argv[0] === 'models' || argv.includes('models')) {
  if (process.env.SIKUMI_FAKE_GROK_AUTH === '0') {
    process.stderr.write('not logged in\n')
    process.exit(1)
  }
  process.stdout.write('grok-4\n')
  process.exit(0)
}

if (argv.includes('--help') || argv.includes('-h')) {
  if (argv.includes('stdio')) {
    process.stdout.write('Run the agent over stdio\nUsage: grok agent stdio\n')
    process.exit(0)
  }
  process.stdout.write(`Grok Build TUI
Usage: grok [OPTIONS] [PROMPT] [COMMAND]
      --output-format <OUTPUT_FORMAT>
          - streaming-json
      --sandbox <PROFILE>
      --deny <RULE>
      --no-auto-update
  agent        Run Grok without the interactive UI
`)
  process.exit(0)
}

if (argv.includes('inspect')) {
  process.stdout.write(
    JSON.stringify({
      grokVersion: '1.0.5-fixture',
      cwd: process.cwd(),
      projectRoot: null,
    }),
  )
  process.stdout.write('\n')
  process.exit(0)
}

if (argv.includes('agent') && argv.includes('stdio')) {
  await runAcp()
  process.exit(0)
}

if (argv.includes('-p') && argv.includes('streaming-json')) {
  await runStreaming(argv)
  process.exit(0)
}

process.stderr.write('fake-grok: unsupported invocation\n')
process.exit(2)

async function runAcp() {
  let sessionId = 'sess-1'
  let forceInvalid = false
  const pending = new Map()
  const lines = createInterface({ input: process.stdin })
  for await (const line of lines) {
    if (!line.trim()) {
      continue
    }
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.result && pending.has(String(message.id))) {
      pending.delete(String(message.id))
      emit({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: JSON.stringify({ title: '調査メモ', summary: '完了' }),
            },
          },
        },
      })
      reply(pending.get('prompt-id') ?? message.id, { stopReason: 'end_turn' })
      continue
    }
    if (!message.method) {
      continue
    }
    if (message.method === 'initialize') {
      reply(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
        agentInfo: { name: 'grok-fixture', version: '1.0.5' },
        authMethods: [],
      })
      continue
    }
    if (message.method === 'authenticate') {
      reply(message.id, {})
      continue
    }
    if (message.method === 'session/new' || message.method === 'session/load') {
      sessionId = message.params?.sessionId ?? 'sess-1'
      reply(message.id, { sessionId })
      continue
    }
    if (message.method === 'session/cancel') {
      reply(message.id, {})
      continue
    }
    if (message.method === 'session/prompt') {
      const text = message.params?.prompt?.[0]?.text ?? ''
      emit({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            title: 'Read README',
            kind: 'read',
          },
        },
      })
      if (text.includes('[hang]')) {
        continue
      }
      if (text.includes('[fail]')) {
        reply(message.id, { stopReason: 'refusal' })
        continue
      }
      if (text.includes('[approval-allow-only]')) {
        pending.set('perm-1', true)
        pending.set('prompt-id', message.id)
        emitRequest('perm-1', {
          method: 'session/request_permission',
          params: {
            sessionId,
            toolCallId: 'perm-1',
            options: [
              {
                optionId: 'allow_once',
                name: 'Allow once',
                kind: 'allow_once',
              },
            ],
          },
        })
        continue
      }
      if (text.includes('[approval]')) {
        pending.set('perm-1', true)
        pending.set('prompt-id', message.id)
        emitRequest('perm-1', {
          method: 'session/request_permission',
          params: {
            sessionId,
            toolCallId: 'perm-1',
            options: [
              {
                optionId: 'allow_once',
                name: 'Allow once',
                kind: 'allow_once',
              },
              { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
            ],
          },
        })
        continue
      }
      if (text.includes('[invalid-schema]')) {
        forceInvalid = true
      }
      const body = forceInvalid
        ? 'not-json'
        : JSON.stringify({ title: '調査メモ', summary: '完了' })
      emit({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: body },
          },
        },
      })
      emit({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'hidden' },
          },
        },
      })
      reply(message.id, { stopReason: 'end_turn', result: body })
    }
  }
}

async function runStreaming(args) {
  const promptIndex = args.indexOf('-p')
  const prompt = promptIndex >= 0 ? args[promptIndex + 1] : ''
  write({
    sessionId: 'sess-stream',
    update: { sessionUpdate: 'tool_call', title: 'Read README' },
  })
  if (prompt.includes('[malformed]')) {
    process.stdout.write('not-json\n')
  }
  if (prompt.includes('[hang]')) {
    await hang()
    return
  }
  write({
    sessionId: 'sess-stream',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: JSON.stringify({ title: '調査メモ', summary: '完了' }),
      },
    },
  })
}

function emit(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

function emitRequest(id, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, ...message })}\n`,
  )
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function hang() {
  return new Promise(() => {
    setInterval(() => {}, 1000)
  })
}
