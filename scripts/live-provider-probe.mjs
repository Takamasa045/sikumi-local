import { execFileSync } from 'node:child_process'

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8_000,
    }).trim()
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr)
        : ''
    const stdout =
      error && typeof error === 'object' && 'stdout' in error
        ? String(error.stdout)
        : ''
    return redact(`${stdout}\n${stderr}`.trim() || 'unavailable')
  }
}

function redact(text) {
  return text
    .replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      '[redacted-email]',
    )
    .replace(
      /(sk-|ghp_|gho_|xai-|claude_)[A-Za-z0-9._-]+/g,
      '[redacted-secret]',
    )
    .split('\n')
    .slice(0, 20)
    .join('\n')
}

console.log('Shikumi Local live provider probe (read-only)')
console.log('This script does not start jobs or send prompts.')
console.log('')
console.log('Codex --version')
console.log(redact(run('codex', ['--version'])))
console.log('Codex app-server --help (first lines)')
console.log(redact(run('codex', ['app-server', '--help'])))
console.log('Codex login status')
console.log(redact(run('codex', ['login', 'status'])))
console.log('')
console.log('Grok version --json')
console.log(redact(run('grok', ['--no-auto-update', 'version', '--json'])))
console.log('Grok agent stdio --help')
console.log(
  redact(run('grok', ['--no-auto-update', 'agent', 'stdio', '--help'])),
)
console.log('')
console.log('Claude --version')
console.log(redact(run('claude', ['--version'])))
console.log('Claude auth status --json')
console.log(redact(run('claude', ['auth', 'status', '--json'])))
