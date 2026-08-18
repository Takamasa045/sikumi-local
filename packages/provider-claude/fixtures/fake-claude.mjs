import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rawArgv = process.argv.slice(2)
const protocolVariant = readProtocolVariant(rawArgv)
const protocol = loadProtocolFixture(protocolVariant)
const argv = stripProtocolVariant(rawArgv)

if (argv.includes('bypassPermissions')) {
  process.stderr.write('bypassPermissions is forbidden in fixture\n')
  process.exit(3)
}

if (argv.includes('--version') || argv.includes('-v')) {
  writeVersion()
  process.exit(0)
}

if (argv[0] === 'auth' && argv[1] === 'status') {
  if (process.env.SIKUMI_FAKE_CLAUDE_AUTH === '0') {
    write({ loggedIn: false })
    process.exit(1)
  }
  write({ loggedIn: true, authMethod: 'claude.ai' })
  process.exit(0)
}

if (argv.includes('doctor')) {
  write({ ok: true })
  process.exit(0)
}

const prompt = readPrompt(argv)
const resume = readArg(argv, '-r') ?? readArg(argv, '--resume')
const jsonSchema = readArg(argv, '--json-schema')
const outputFormat = readArg(argv, '--output-format') ?? 'text'
const mcpConfig = readArg(argv, '--mcp-config')

if (jsonSchema && resume) {
  assertSafeSchemaFinalization(argv)
}

if (prompt.includes('[hang]')) {
  write({
    type: 'system',
    subtype: 'init',
    session_id: 'claude-sess-1',
    protocolVersion: protocol.protocolVersion,
  })
  await hang()
}

if (prompt.includes('[approvals]') || prompt.includes('[approval]')) {
  const controlDir = mcpConfig ? controlDirFromConfig(mcpConfig) : undefined
  if (!controlDir) {
    write({ type: 'result', subtype: 'error', session_id: 'claude-sess-1' })
    process.exit(1)
  }
  const ids = prompt.includes('[approvals]')
    ? ['claude-apr-1', 'claude-apr-2']
    : ['claude-apr-1']
  for (const requestId of ids) {
    writeFileSync(
      join(controlDir, 'request.json'),
      JSON.stringify({ requestId, toolName: 'WebSearch' }),
    )
    await waitForMatchingDecision(controlDir, requestId)
  }
}

if (outputFormat === 'json') {
  const body =
    prompt.includes('[invalid-schema]') && !prompt.includes('指定Schema')
      ? 'not-json'
      : JSON.stringify({ title: '調査メモ', summary: '完了' })
  write({
    type: 'result',
    subtype: 'success',
    session_id: resume ?? 'claude-sess-1',
    result: body,
  })
  process.exit(0)
}

if (protocolVariant === 'malformed') {
  write({
    type: 'system',
    subtype: 'init',
    session_id: resume ?? 'claude-sess-1',
    protocolVersion: protocol.protocolVersion,
  })
  writeMalformedFrame()
  process.exit(1)
}

write({
  type: 'system',
  subtype: 'init',
  session_id: resume ?? 'claude-sess-1',
  protocolVersion:
    protocolVariant === 'unknown'
      ? 99
      : protocolVariant === 'malformed'
        ? 'not-a-version'
        : (protocol.protocolVersion ?? 1),
})
if (protocolVariant === 'future-unknown') {
  write({
    type: 'thinking_v2',
    thinking: 'FUTURE_REASONING_MUST_NOT_PERSIST',
    token: 'FUTURE_SECRET_TOKEN',
  })
  write({
    type: 'permission_mode',
    mode: 'bypassPermissions',
    reasoning: 'FUTURE_REASONING_MUST_NOT_PERSIST',
  })
  write({
    type: 'future_event',
    reasoning: 'FUTURE_REASONING_MUST_NOT_PERSIST',
    token: 'FUTURE_SECRET_TOKEN',
    secret: 'FUTURE_SECRET_TOKEN',
  })
}
if (prompt.includes('[malformed]')) {
  process.stdout.write('not-json\n')
}
if (prompt.includes('[fail]')) {
  write({ type: 'result', subtype: 'error', session_id: 'claude-sess-1' })
  process.exit(1)
}
write({
  type: 'assistant',
  message: {
    content: [
      {
        type: 'text',
        text:
          prompt.includes('[invalid-schema]') && !jsonSchema
            ? 'not-json'
            : JSON.stringify({ title: '調査メモ', summary: '完了' }),
      },
    ],
  },
})
write({
  type: 'result',
  subtype: 'success',
  session_id: resume ?? 'claude-sess-1',
  result:
    prompt.includes('[invalid-schema]') && !jsonSchema
      ? 'not-json'
      : JSON.stringify({ title: '調査メモ', summary: '完了' }),
})
process.exit(0)

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function readPrompt(args) {
  const print = args.indexOf('-p')
  if (print >= 0 && args[print + 1] && !args[print + 1].startsWith('-')) {
    return args[print + 1]
  }
  const single = args.find((value, index) => args[index - 1] === '--print')
  return single ?? args.find((value) => !value.startsWith('-')) ?? ''
}

function readArg(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function controlDirFromConfig(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const args = parsed?.mcpServers?.shikumi_permission_broker?.args
    if (!Array.isArray(args)) {
      return undefined
    }
    const index = args.indexOf('--control-dir')
    return index >= 0 ? args[index + 1] : undefined
  } catch {
    return undefined
  }
}

function waitForMatchingDecision(controlDir, requestId) {
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
        clearInterval(timer)
        rmSync(decisionPath, { force: true })
        rmSync(requestPath, { force: true })
        resolve(undefined)
      } catch {
        // Decision file is still being written.
      }
    }, 20)
  })
}

function assertSafeSchemaFinalization(args) {
  const modeIndex = args.indexOf('--permission-mode')
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : ''
  if (mode !== 'dontAsk') {
    process.stderr.write('schema finalization must use dontAsk\n')
    process.exit(3)
  }
  if (args.includes('bypassPermissions') || args.includes('acceptEdits')) {
    process.stderr.write('schema finalization must not use a dangerous mode\n')
    process.exit(3)
  }
  const allowedIndex = args.indexOf('--allowedTools')
  const allowed = allowedIndex >= 0 ? (args[allowedIndex + 1] ?? '') : ''
  if (/Edit|Write|Bash|WebSearch|WebFetch/.test(allowed)) {
    process.stderr.write('schema finalization must not allow dangerous tools\n')
    process.exit(3)
  }
  const disallowedIndex = args.indexOf('--disallowedTools')
  const disallowed =
    disallowedIndex >= 0 ? (args[disallowedIndex + 1] ?? '') : ''
  for (const tool of ['Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch']) {
    if (!disallowed.split(',').includes(tool)) {
      process.stderr.write(`schema finalization must disallow ${tool}\n`)
      process.exit(3)
    }
  }
}

function hang() {
  return new Promise(() => {
    setInterval(() => {}, 1000)
  })
}

function writeVersion() {
  if (protocolVariant === 'malformed') {
    writeMalformedFrame()
    return
  }
  if (protocolVariant === 'future' || protocolVariant === 'future-unknown') {
    process.stdout.write('99.0.0-future (Claude Code)\n')
    return
  }
  process.stdout.write('2.1.220-fixture (Claude Code)\n')
}

function writeMalformedFrame() {
  process.stdout.write('not-a-protocol-frame\n{broken\n')
}

function readProtocolVariant(args) {
  return (
    normalizeProtocolVariant(readArg(args, '--protocol-variant')) ||
    normalizeProtocolVariant(readArg(args, '--sikumi-protocol')) ||
    normalizeProtocolVariant(process.env.SIKUMI_FAKE_CLAUDE_PROTOCOL) ||
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
  if (value === 'future-unknown' || value === 'future') {
    return 'future-unknown'
  }
  if (value === 'supported') {
    return 'supported'
  }
  return undefined
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
