import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rawArgv = process.argv.slice(2)
const protocolVariant = readProtocolVariant(rawArgv)
const protocol = loadProtocolFixture(protocolVariant)
const argv = stripProtocolVariant(rawArgv)
const authEnabled = process.env.SIKUMI_FAKE_CODEX_AUTH !== '0'
const disableAppServer = process.env.SIKUMI_FAKE_CODEX_NO_APP_SERVER === '1'
const disableExec = process.env.SIKUMI_FAKE_CODEX_NO_EXEC === '1'

if (argv.includes('--version') || argv[0] === '-V') {
  writeVersion()
  process.exit(0)
}

if (argv[0] === 'login' && argv[1] === 'status') {
  process.stdout.write(
    authEnabled ? 'Logged in using ChatGPT\n' : 'Not logged in\n',
  )
  process.exit(authEnabled ? 0 : 1)
}

if (argv[0] === 'app-server') {
  if (disableAppServer) {
    process.stderr.write('unknown command app-server\n')
    process.exit(2)
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`Run the app server or related tooling

Usage: codex app-server [OPTIONS] [COMMAND]

Commands:
  generate-json-schema  Generate JSON Schema for the app server protocol

Options:
      --stdio  Use stdio as the transport
`)
    process.exit(0)
  }
  if (argv.includes('generate-json-schema')) {
    const outIndex = argv.findIndex(
      (value) => value === '--out' || value === '-o',
    )
    const outDir = outIndex >= 0 ? argv[outIndex + 1] : undefined
    if (outDir) {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        join(outDir, 'ClientRequest.json'),
        '{"title":"ClientRequest"}\n',
      )
    }
    process.exit(0)
  }
  await runAppServer()
  process.exit(0)
}

if (argv[0] === 'exec') {
  if (disableExec) {
    process.stderr.write('unknown command exec\n')
    process.exit(2)
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`Run Codex non-interactively

Usage: codex exec [OPTIONS] [PROMPT]

Options:
      --json
      --output-schema <FILE>
      --cd <DIR>
      --sandbox <SANDBOX_MODE>
`)
    process.exit(0)
  }
  await runExec(argv)
  process.exit(0)
}

process.stderr.write('fake-codex: unsupported invocation\n')
process.exit(2)

async function runAppServer() {
  const pendingApprovals = new Map()
  let turnId = 'turn-1'
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
    if (message.result && pendingApprovals.has(String(message.id))) {
      pendingApprovals.delete(String(message.id))
      emit({
        method: 'item/completed',
        params: { item: { type: 'commandExecution', id: 'cmd-1' } },
      })
      completeTurn(extractPrompt(globalThis.__lastTurn), turnId)
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
        userAgent: 'codex-fixture',
        platformOs: 'macos',
        platformFamily: 'unix',
        codexHome: process.cwd(),
      })
      continue
    }
    if (message.method === 'account/read') {
      reply(message.id, {
        requiresOpenaiAuth: !authEnabled,
        account: authEnabled
          ? { type: 'chatgpt', email: null, planType: 'plus' }
          : null,
      })
      continue
    }
    if (
      message.method === 'thread/start' ||
      message.method === 'thread/resume'
    ) {
      reply(message.id, {
        thread: { id: message.params?.threadId ?? 'thread-1' },
        cwd: message.params?.cwd ?? process.cwd(),
        model: 'gpt-5.4',
        modelProvider: 'openai',
        sandbox: { type: 'readOnly' },
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      })
      emit({ method: 'thread/started', params: { thread: { id: 'thread-1' } } })
      continue
    }
    if (message.method === 'turn/start') {
      globalThis.__lastTurn = message.params
      turnId = 'turn-1'
      reply(message.id, { turn: { id: turnId, status: 'inProgress' } })
      emit({ method: 'turn/started', params: { turn: { id: turnId }, turnId } })
      const prompt = extractPrompt(message.params)
      if (prompt.includes('[malformed]')) {
        process.stdout.write('this is not json\n')
        process.stdout.write(`${'{"huge":"'.padEnd(32, 'x')}\n`)
      }
      if (prompt.includes('[hang]')) {
        continue
      }
      if (prompt.includes('[fail]')) {
        emit({ method: 'error', params: { message: 'deterministic failure' } })
        continue
      }
      emit({
        method: 'item/started',
        params: {
          item: {
            type: 'commandExecution',
            id: 'cmd-1',
            command: 'git status',
          },
        },
      })
      if (
        protocolVariant === 'future' ||
        protocolVariant === 'future-unknown'
      ) {
        emitFutureEvents()
      }
      if (prompt.includes('[unknown-request]')) {
        emitRequest('u1', {
          method: 'item/tool/requestUserInput',
          params: { itemId: 'tool-1' },
        })
        emitRequest('u2', {
          method: 'mcpItem/elicitation/requestApproval',
          params: { message: 'need input' },
        })
        emitRequest('u3', {
          method: 'item/dynamicTool/requestApproval',
          params: { tool: 'dynamic' },
        })
        emitRequest('u4', {
          method: 'account/token/refresh',
          params: {},
        })
        completeTurn(prompt, turnId)
        continue
      }
      if (prompt.includes('[permissions]')) {
        const approvalId = 'apr-perm'
        pendingApprovals.set(approvalId, true)
        emitRequest(approvalId, {
          method: 'item/permissions/requestApproval',
          params: {
            itemId: 'perm-1',
            approvalId,
            threadId: 'thread-1',
            turnId,
            permissions: { rules: [{ pattern: 'git status' }] },
          },
        })
        continue
      }
      if (prompt.includes('[file-approval]')) {
        const approvalId = 'apr-file'
        pendingApprovals.set(approvalId, true)
        emitRequest(approvalId, {
          method: 'item/fileChange/requestApproval',
          params: {
            itemId: 'file-1',
            approvalId,
            threadId: 'thread-1',
            turnId,
            command: 'apply patch',
          },
        })
        continue
      }
      if (prompt.includes('[approval]')) {
        const approvalId = 'apr-1'
        pendingApprovals.set(approvalId, true)
        emitRequest(approvalId, {
          method: 'item/commandExecution/requestApproval',
          params: {
            itemId: 'cmd-1',
            approvalId,
            threadId: 'thread-1',
            turnId,
            startedAtMs: Date.now(),
            command: 'curl https://example.com',
          },
        })
        continue
      }
      emit({
        method: 'item/completed',
        params: { item: { type: 'commandExecution', id: 'cmd-1' } },
      })
      completeTurn(prompt, turnId)
      continue
    }
    if (message.method === 'turn/interrupt') {
      reply(message.id, {})
      emit({
        method: 'turn/completed',
        params: {
          turn: { id: message.params?.turnId ?? turnId, status: 'interrupted' },
        },
      })
    }
  }
}

async function runExec(args) {
  const prompt = args[args.length - 1] ?? ''
  write({ type: 'thread.started', thread_id: 'thread-exec' })
  write({ type: 'turn.started' })
  if (prompt.includes('[malformed]')) {
    process.stdout.write('not-json\n')
  }
  if (prompt.includes('[hang]')) {
    await hang()
    return
  }
  if (prompt.includes('[fail]')) {
    write({ type: 'error', message: 'deterministic failure' })
    return
  }
  write({
    type: 'item.started',
    item: { type: 'agentMessage', id: 'm1', text: '' },
  })
  write({
    type: 'item.completed',
    item: {
      type: 'agentMessage',
      id: 'm1',
      text: resultText(prompt),
    },
  })
  write({ type: 'turn.completed' })
}

function completeTurn(prompt, turnId) {
  const text = resultText(prompt)
  emit({
    method: 'item/started',
    params: { item: { type: 'agentMessage', id: 'msg-1', text } },
  })
  emit({
    method: 'item/completed',
    params: { item: { type: 'agentMessage', id: 'msg-1', text } },
  })
  emit({
    method: 'turn/completed',
    params: { turn: { id: turnId, status: 'completed' } },
  })
}

function resultText(prompt) {
  if (prompt.includes('[invalid-schema]')) {
    return 'not-json-result'
  }
  return JSON.stringify({ title: '調査メモ', summary: '完了' })
}

function extractPrompt(params) {
  const input = params?.input
  if (Array.isArray(input) && input[0]?.text) {
    return String(input[0].text)
  }
  return ''
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

function emitFutureEvents() {
  emit({
    method: 'item/started',
    params: {
      item: {
        type: 'reasoning_v2',
        text: 'FUTURE_REASONING_MUST_NOT_PERSIST',
        token: 'FUTURE_SECRET_TOKEN',
      },
    },
  })
  emit({
    method: 'future/unknownEvent',
    params: {
      reasoning: 'FUTURE_REASONING_MUST_NOT_PERSIST',
      token: 'FUTURE_SECRET_TOKEN',
      secret: 'FUTURE_SECRET_TOKEN',
    },
  })
  emitRequest('future-sudo', {
    method: 'item/sudo/requestAlways',
    params: {
      approvalId: 'future-sudo',
      command: 'sudo rm -rf /',
      permissions: { bypass: true },
    },
  })
}

function writeVersion() {
  if (protocolVariant === 'malformed') {
    writeMalformedFrame()
    return
  }
  if (protocolVariant === 'future-unknown') {
    process.stdout.write('codex-cli 99.0.0-future\n')
    return
  }
  process.stdout.write('codex-cli 0.144.6-fixture\n')
}

function writeMalformedFrame() {
  process.stdout.write('not-a-protocol-frame\n{broken\n')
}

function readProtocolVariant(args) {
  return (
    normalizeProtocolVariant(readFlag(args, '--protocol-variant')) ||
    normalizeProtocolVariant(readFlag(args, '--sikumi-protocol')) ||
    normalizeProtocolVariant(process.env.SIKUMI_FAKE_CODEX_PROTOCOL) ||
    normalizeProtocolVariant(process.env.SHIKUMI_FIXTURE_PROTOCOL) ||
    'supported'
  )
}

function normalizeProtocolVariant(value) {
  if (value === 'malformed') {
    return 'malformed'
  }
  if (value === 'unknown') {
    return 'unknown'
  }
  if (value === 'future') {
    return 'future'
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
    return {
      protocolVersion:
        variant === 'malformed'
          ? 'not-a-version'
          : variant === 'unknown'
            ? 99
            : 1,
    }
  }
}
