import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const rawArgv = process.argv.slice(2)
const protocolVariant = readProtocolVariant(rawArgv)
const protocol = loadProtocolFixture(protocolVariant)
const argv = stripProtocolVariant(rawArgv)

if (argv.includes('--always-approve') || argv.includes('--worktree')) {
  process.stderr.write('forbidden flag\n')
  process.exit(3)
}

if (argv[0] === 'version' || argv.includes('version')) {
  writeVersion()
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
      if (protocolVariant === 'malformed') {
        writeMalformedFrame()
        process.exit(1)
      }
      reply(message.id, {
        protocolVersion:
          protocolVariant === 'unknown' ? 99 : (protocol.protocolVersion ?? 1),
        agentCapabilities: {
          loadSession: true,
          ...(protocolVariant === 'future-unknown'
            ? { alwaysApprove: true, bypassPermissions: true }
            : {}),
        },
        agentInfo: {
          name: 'grok-fixture',
          version:
            protocolVariant === 'future-unknown' ? '99.0.0-future' : '1.0.5',
        },
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
      if (
        protocolVariant === 'future' ||
        protocolVariant === 'future-unknown'
      ) {
        emitFutureEvents(sessionId)
      }
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
  if (protocolVariant === 'malformed') {
    writeMalformedFrame()
    process.exit(1)
  }
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

function emitFutureEvents(sessionId) {
  emit({
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'future_unknown_chunk',
        reasoning: 'FUTURE_REASONING_MUST_NOT_PERSIST',
        token: 'FUTURE_SECRET_TOKEN',
        content: { type: 'text', text: 'FUTURE_SECRET_TOKEN' },
      },
    },
  })
  emit({
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: {
          type: 'text',
          text: 'FUTURE_REASONING_MUST_NOT_PERSIST',
        },
      },
    },
  })
  emitRequest('future-sudo', {
    method: 'session/request_always_allow',
    params: {
      sessionId,
      privilege: 'unrestricted',
      reasoning: 'FUTURE_REASONING_MUST_NOT_PERSIST',
    },
  })
}

function writeVersion() {
  if (protocolVariant === 'malformed') {
    writeMalformedFrame()
    return
  }
  if (protocolVariant === 'future-unknown') {
    process.stdout.write(
      '{"currentVersion":"99.0.0-future","channel":"canary","protocolVersion":99}\n',
    )
    return
  }
  process.stdout.write(
    '{"currentVersion":"1.0.5-fixture","channel":"unknown"}\n',
  )
}

function writeMalformedFrame() {
  process.stdout.write('not-a-protocol-frame\n{broken\n')
}

function readProtocolVariant(args) {
  return (
    normalizeProtocolVariant(readFlag(args, '--protocol-variant')) ||
    normalizeProtocolVariant(readFlag(args, '--sikumi-protocol')) ||
    normalizeProtocolVariant(process.env.SIKUMI_FAKE_GROK_PROTOCOL) ||
    normalizeProtocolVariant(process.env.SHIKUMI_FIXTURE_PROTOCOL) ||
    'supported'
  )
}

function normalizeProtocolVariant(value) {
  if (value === 'malformed') {
    return 'malformed'
  }
  if (value === 'future') {
    return 'future'
  }
  if (value === 'unknown') {
    return 'unknown'
  }
  if (value === 'future-unknown') {
    return 'future-unknown'
  }
  if (value === 'supported') {
    return 'supported'
  }
  return undefined
}

function readFlag(args, name) {
  const exact = args.indexOf(name)
  if (exact >= 0 && args[exact + 1]) {
    return args[exact + 1]
  }
  const prefix = `${name}=`
  const matched = args.find((arg) => arg.startsWith(prefix))
  return matched ? matched.slice(prefix.length) : undefined
}

function stripProtocolVariant(args) {
  const flags = ['--protocol-variant', '--sikumi-protocol']
  const stripped = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (flags.includes(arg)) {
      index += 1
      continue
    }
    if (flags.some((flag) => arg.startsWith(`${flag}=`))) {
      continue
    }
    stripped.push(arg)
  }
  return stripped
}

function loadProtocolFixture(variant) {
  const fileName =
    variant === 'future-unknown' ? 'future.json' : `${variant}.json`
  try {
    return JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'protocol', fileName),
        'utf8',
      ),
    )
  } catch {
    return { protocolVersion: variant === 'malformed' ? 'not-a-version' : 1 }
  }
}
