import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = parseArgs(process.argv.slice(2))
const lingerChild = join(
  dirname(fileURLToPath(import.meta.url)),
  'linger-child.mjs',
)

process.on('SIGTERM', () => {
  write({
    type: 'run.cancelled',
    summary: '仕事を中止しました',
  })
  process.exit(143)
})

if (args.scenario === 'print-env') {
  write({
    type: 'env.snapshot',
    keys: Object.keys(process.env).sort(),
    hasAwsSecret: Boolean(process.env.AWS_SECRET_ACCESS_KEY),
    hasGithubToken: Boolean(process.env.GITHUB_TOKEN),
    hasNodeOptions: Boolean(process.env.NODE_OPTIONS),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  })
  process.exit(0)
}

if (args.scenario === 'echo-arg') {
  write({
    type: 'arg.echo',
    value: args.value ?? '',
  })
  process.exit(0)
}

if (args.scenario === 'spawn-child') {
  if (!args.pidFile) {
    process.exit(2)
  }
  spawn(process.execPath, [lingerChild, args.pidFile], {
    stdio: 'ignore',
    shell: false,
  })
  write({
    type: 'run.started',
    summary: '子プロセスを起動しました',
  })
  await hang()
}

if (args.scenario === 'hang') {
  write({
    type: 'run.started',
    summary: '仕事を始めます',
  })
  await hang()
}

if (args.scenario === 'fail') {
  write({
    type: 'run.started',
    summary: '仕事を始めます',
  })
  process.stderr.write('reasoning: should-not-persist-on-stderr\n')
  write({
    type: 'run.failed',
    summary: '調査を完了できませんでした',
    error: 'deterministic-failure',
    reasoning: 'INTERNAL_REASONING_MUST_NOT_PERSIST',
    token: 'FAKE_SECRET_TOKEN',
  })
  process.exit(1)
}

write({
  type: 'run.started',
  summary: '仕事を始めます',
})
process.stderr.write('reasoning: should-not-persist-on-stderr\n')
write({
  type: 'run.state_changed',
  state: 'reading_repository',
  summary: 'この工房の資料を読んでいます',
  reasoning: 'INTERNAL_REASONING_MUST_NOT_PERSIST',
  token: 'FAKE_SECRET_TOKEN',
})
write({
  type: 'repository.read',
  summary: 'この工房の資料を読んでいます',
  path: 'README.md',
})
write({
  type: 'run.state_changed',
  state: 'searching_web',
  summary: '公式情報を探しています',
})
write({
  type: 'web.search',
  summary: '公式情報を探しています',
  query: 'documentation',
})
const approvalRequestId =
  args.approvalRequestId ??
  (args.runId ? `${args.runId}:web-search` : 'fake:web-search')

write({
  type: 'approval.requested',
  requestId: approvalRequestId,
  risk: 'medium',
  summary: '外部サイトへアクセスします',
})

const decision = await readDecision()
write({
  type: 'approval.resolved',
  requestId: approvalRequestId,
  decision,
})

if (decision === 'denied') {
  write({
    type: 'run.failed',
    summary: '確認が拒否されたため仕事を止めました',
  })
  process.exit(1)
}

write({
  type: 'run.state_changed',
  state: 'organizing',
  summary: '調査結果を整理しています',
})
write({
  type: 'artifact.created',
  artifactType: 'report',
  title: '調査メモ',
  summary: '調査結果を整理しています',
})
write({
  type: 'run.state_changed',
  state: 'delivering',
  summary: '成果を届けています',
})
write({
  type: 'run.completed',
  summary: '調査が完了しました',
})
process.exit(0)

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function hang() {
  return new Promise(() => {
    setInterval(() => {
      // Wait for cancel/timeout.
    }, 1000)
  })
}

async function readDecision() {
  const lines = createInterface({ input: process.stdin })
  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue
    }
    const parsed = JSON.parse(line)
    if (parsed && typeof parsed.decision === 'string') {
      lines.close()
      return parsed.decision
    }
  }
  return 'denied'
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--scenario' && value) {
      parsed.scenario = value
      index += 1
    } else if (key === '--pid-file' && value) {
      parsed.pidFile = value
      index += 1
    } else if (key === '--value' && value) {
      parsed.value = value
      index += 1
    } else if (key === '--run-id' && value) {
      parsed.runId = value
      index += 1
    } else if (key === '--approval-request-id' && value) {
      parsed.approvalRequestId = value
      index += 1
    }
  }
  return parsed
}
