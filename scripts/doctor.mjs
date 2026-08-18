import { execFileSync } from 'node:child_process'

function commandVersion(command, args = ['--version']) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')[0]
  } catch {
    return null
  }
}

const checks = [
  ['Node.js', process.version, true],
  ['pnpm', commandVersion('pnpm'), true],
  ['Git', commandVersion('git'), true],
  ['Codex', commandVersion('codex'), false],
  ['Grok Build', commandVersion('grok'), false],
  ['Claude Code', commandVersion('claude'), false],
]

console.log('Shikumi Local doctor')
console.log('Bind policy: 127.0.0.1 only')
console.log(
  'Phase 5-7: Codex app-server / Grok ACP / Claude stream-json adapters are registered.',
)
console.log(
  'Regular tests use fixtures and do not start live model runs. Fake requires SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1.',
)
console.log('Read-only live CLI probe: node scripts/live-provider-probe.mjs')

let requiredMissing = false
for (const [label, version, required] of checks) {
  const ok = version !== null
  console.log(
    `${ok ? '✓' : required ? '×' : '△'} ${label}: ${version ?? 'not found'}`,
  )
  if (required && !ok) requiredMissing = true
}

if (requiredMissing) {
  process.exitCode = 1
} else {
  console.log('Required foundation tools are available.')
}
