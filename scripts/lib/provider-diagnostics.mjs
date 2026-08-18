import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const PROVIDER_DIAGNOSTIC_COMMANDS = {
  codex: {
    install: { command: 'codex', args: ['--version'] },
    auth: { command: 'codex', args: ['login', 'status'] },
    protocol: [
      {
        command: 'codex',
        args: ['app-server', '--help'],
        needles: ['app-server', 'stdio'],
      },
      {
        command: 'codex',
        args: ['exec', '--help'],
        needles: ['--json', 'sandbox'],
      },
    ],
  },
  grok: {
    install: {
      command: 'grok',
      args: ['--no-auto-update', 'version', '--json'],
    },
    auth: { command: 'grok', args: ['models'] },
    protocol: [
      {
        command: 'grok',
        args: ['--no-auto-update', 'agent', 'stdio', '--help'],
        needles: ['agent', 'stdio'],
      },
      { command: 'grok', args: ['--help'], needles: ['sandbox'] },
    ],
  },
  claude: {
    install: { command: 'claude', args: ['--version'] },
    auth: { command: 'claude', args: ['auth', 'status', '--json'] },
    protocol: [
      {
        command: 'claude',
        args: ['--help'],
        needles: ['stream-json', 'output-format'],
      },
    ],
  },
}

const SECRET = /(?:sk-|xai-|ghp_|gho_|claude_|Bearer\s+)[A-Za-z0-9._\-/=]+/gi
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const FILE_URL = /\bfile:\/\/[^\s"'`]+/gi
const NON_FILE_URL = /\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s"'`]+/gi

export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(EMAIL, '[redacted-email]')
    .replace(SECRET, '[redacted-secret]')
    .replace(FILE_URL, '[redacted-path]')
    .replace(NON_FILE_URL, '[redacted-url]')
    .replace(/(^|[\s"'`=])(\/(?!\/)[^\s"'`]+)/g, '$1[redacted-path]')
    .replace(/(^|[\s"'`=])([A-Za-z]:[\\/][^\s"'`]+)/g, '$1[redacted-path]')
}

export function classifyCommandResult(result, interpreter) {
  if (!result.commandFound) {
    return {
      kind: 'command_missing',
      label: 'unavailable',
      detail: 'unavailable',
    }
  }
  if (result.timedOut) {
    return {
      kind: 'timeout',
      label: 'unavailable',
      detail: 'unavailable',
    }
  }
  if (typeof interpreter === 'function') {
    return interpreter(result)
  }
  if (result.exitCode === 0) {
    return {
      kind: 'authenticated',
      label: 'authenticated',
      detail: firstSafeLine(result.stdout) || 'authenticated',
    }
  }
  return {
    kind: 'execution_failure',
    label: 'unavailable',
    detail: 'unavailable',
  }
}

export function interpretCodexAuth(result) {
  const text = `${result.stdout}\n${result.stderr}`
  const authenticated = /logged in|chatgpt|api key/i.test(text)
  const unauthenticated = /not logged in|logged out|unauth/i.test(text)
  if (authenticated && !unauthenticated) {
    return {
      kind: 'authenticated',
      label: 'authenticated',
      detail: 'authenticated',
    }
  }
  if (result.exitCode === 0 || unauthenticated || result.commandFound) {
    return {
      kind: 'unauthenticated',
      label: 'login required',
      detail: 'login required',
    }
  }
  return {
    kind: 'execution_failure',
    label: 'unavailable',
    detail: 'unavailable',
  }
}

export function interpretGrokAuth(result) {
  if (result.timedOut) {
    return {
      kind: 'timeout',
      label: 'unavailable',
      detail: 'unavailable',
    }
  }
  if (!result.commandFound) {
    return {
      kind: 'command_missing',
      label: 'unavailable',
      detail: 'unavailable',
    }
  }
  if (result.exitCode === 0) {
    return {
      kind: 'authenticated',
      label: 'authenticated',
      detail: 'authenticated',
    }
  }
  if (result.exitCode === null) {
    return {
      kind: 'execution_failure',
      label: 'unavailable',
      detail: 'unavailable',
    }
  }
  return {
    kind: 'unauthenticated',
    label: 'login required',
    detail: 'login required',
  }
}

export function interpretClaudeAuth(result) {
  const text = `${result.stdout}\n${result.stderr}`
  if (/"loggedIn"\s*:\s*true/i.test(text)) {
    return {
      kind: 'authenticated',
      label: 'authenticated',
      detail: 'authenticated',
    }
  }
  if (/"loggedIn"\s*:\s*false/i.test(text) || result.commandFound) {
    return {
      kind: 'unauthenticated',
      label: 'login required',
      detail: 'login required',
    }
  }
  return {
    kind: 'execution_failure',
    label: 'unavailable',
    detail: 'unavailable',
  }
}

export function interpretProtocol(results) {
  const unsupported = results.some(
    (item) =>
      !item.matched && item.result.commandFound && !item.result.timedOut,
  )
  const missing = results.every((item) => !item.result.commandFound)
  if (missing) {
    return {
      kind: 'command_missing',
      label: 'unavailable',
      detail: 'unavailable',
    }
  }
  if (results.every((item) => item.matched)) {
    return {
      kind: 'authenticated',
      label: 'protocol available',
      detail: 'protocol available',
    }
  }
  if (unsupported || results.some((item) => item.result.commandFound)) {
    return {
      kind: 'protocol_unsupported',
      label: 'protocol unsupported',
      detail: 'protocol unsupported',
    }
  }
  return {
    kind: 'execution_failure',
    label: 'unavailable',
    detail: 'unavailable',
  }
}

export function publicCommandResult(result) {
  return {
    commandFound: result.commandFound,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: redactDiagnosticText(result.stdout)
      .split('\n')
      .slice(0, 8)
      .join('\n'),
    stderr: redactDiagnosticText(result.stderr)
      .split('\n')
      .slice(0, 8)
      .join('\n'),
  }
}

export async function runDiagnosticCommand(command, args, options = {}) {
  const run = options.run ?? defaultRun
  return run(command, args, {
    timeoutMs: options.timeoutMs ?? 4_000,
  })
}

export async function diagnoseProvider(id, options = {}) {
  const spec = PROVIDER_DIAGNOSTIC_COMMANDS[id]
  if (!spec) {
    throw new Error(`Unknown provider diagnostic: ${id}`)
  }
  const install = await runDiagnosticCommand(
    spec.install.command,
    spec.install.args,
    options,
  )
  const auth = await runDiagnosticCommand(
    spec.auth.command,
    spec.auth.args,
    options,
  )
  const protocolRuns = []
  for (const check of spec.protocol) {
    const result = await runDiagnosticCommand(
      check.command,
      check.args,
      options,
    )
    const haystack = `${result.stdout}\n${result.stderr}`.toLowerCase()
    protocolRuns.push({
      result,
      matched:
        result.commandFound &&
        !result.timedOut &&
        result.exitCode === 0 &&
        check.needles.some((needle) => haystack.includes(needle.toLowerCase())),
    })
  }

  const installStatus = !install.commandFound
    ? { kind: 'command_missing', label: 'unavailable', detail: 'unavailable' }
    : install.timedOut
      ? { kind: 'timeout', label: 'unavailable', detail: 'unavailable' }
      : install.exitCode === 0
        ? {
            kind: 'authenticated',
            label: 'installed',
            detail: firstSafeLine(install.stdout) || 'installed',
          }
        : {
            kind: 'execution_failure',
            label: 'unavailable',
            detail: 'unavailable',
          }

  const authStatus = classifyCommandResult(
    auth,
    id === 'codex'
      ? interpretCodexAuth
      : id === 'grok'
        ? interpretGrokAuth
        : interpretClaudeAuth,
  )
  const protocolStatus = interpretProtocol(protocolRuns)

  return {
    id,
    installed: installStatus,
    authenticated: authStatus,
    protocol: protocolStatus,
    raw: {
      install: publicCommandResult(install),
      auth: publicCommandResult(id === 'grok' ? omitModelList(auth) : auth),
      protocol: protocolRuns.map((item) => publicCommandResult(item.result)),
    },
  }
}

export function formatProviderDoctorLines(diagnosis) {
  const names = {
    codex: {
      installed: 'Codex installed',
      auth: 'Codex auth',
      protocol: 'Codex protocol',
    },
    grok: {
      installed: 'Grok Build installed',
      auth: 'Grok auth',
      protocol: 'Grok protocol',
    },
    claude: {
      installed: 'Claude Code installed',
      auth: 'Claude auth',
      protocol: 'Claude protocol',
    },
  }
  const labels = names[diagnosis.id]
  return [
    [labels.installed, diagnosis.installed.detail, false],
    [labels.auth, diagnosis.authenticated.detail, false],
    [labels.protocol, diagnosis.protocol.detail, false],
  ]
}

function omitModelList(result) {
  return {
    ...result,
    stdout: '',
    stderr: redactDiagnosticText(result.stderr).replace(
      /model[^\n]*/gi,
      '[omitted]',
    ),
  }
}

function firstSafeLine(text) {
  const line = redactDiagnosticText(text).split('\n')[0]?.trim() ?? ''
  return line.length > 0 ? line : ''
}

async function defaultRun(command, args, options) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 64 * 1024,
    })
    return {
      commandFound: true,
      exitCode: 0,
      timedOut: false,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  } catch (error) {
    const err = error && typeof error === 'object' ? error : {}
    const code = 'code' in err ? err.code : undefined
    const timedOut =
      code === 'ETIMEDOUT' ||
      Boolean('killed' in err && err.killed && 'signal' in err)
    const commandFound = code !== 'ENOENT'
    return {
      commandFound,
      exitCode: typeof err.status === 'number' ? err.status : null,
      timedOut,
      stdout: 'stdout' in err ? String(err.stdout ?? '') : '',
      stderr: 'stderr' in err ? String(err.stderr ?? '') : '',
    }
  }
}
