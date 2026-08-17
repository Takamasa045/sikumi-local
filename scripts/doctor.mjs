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
