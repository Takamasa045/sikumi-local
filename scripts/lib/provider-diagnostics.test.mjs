import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PROVIDER_DIAGNOSTIC_COMMANDS,
  classifyCommandResult,
  diagnoseProvider,
  interpretClaudeAuth,
  interpretCodexAuth,
  interpretGrokAuth,
  publicCommandResult,
  redactDiagnosticText,
} from './provider-diagnostics.mjs'

describe('provider diagnostics commands', () => {
  it('uses the exact Grok auth command from the Grok adapter probe', () => {
    assert.deepEqual(PROVIDER_DIAGNOSTIC_COMMANDS.grok.auth, {
      command: 'grok',
      args: ['models'],
    })
    assert.deepEqual(PROVIDER_DIAGNOSTIC_COMMANDS.grok.install, {
      command: 'grok',
      args: ['--no-auto-update', 'version', '--json'],
    })
    assert.deepEqual(PROVIDER_DIAGNOSTIC_COMMANDS.codex.auth.args, [
      'login',
      'status',
    ])
    assert.deepEqual(PROVIDER_DIAGNOSTIC_COMMANDS.claude.auth.args, [
      'auth',
      'status',
      '--json',
    ])
  })
})

describe('Grok auth classification', () => {
  it('treats exit 0 as authenticated', () => {
    const status = interpretGrokAuth(
      result({ exitCode: 0, stdout: '{"models":["secret-model"]}' }),
    )
    assert.equal(status.kind, 'authenticated')
    assert.equal(status.label, 'authenticated')
  })

  it('treats a nonzero exit as login required', () => {
    const status = interpretGrokAuth(
      result({ exitCode: 1, stderr: 'login required' }),
    )
    assert.equal(status.kind, 'unauthenticated')
    assert.equal(status.label, 'login required')
  })

  it('treats a timeout as unavailable', () => {
    const status = interpretGrokAuth(
      result({ timedOut: true, exitCode: null, commandFound: true }),
    )
    assert.equal(status.kind, 'timeout')
    assert.equal(status.label, 'unavailable')
    assert.equal(
      classifyCommandResult(
        result({ timedOut: true, commandFound: true }),
        interpretGrokAuth,
      ).label,
      'unavailable',
    )
  })
})

describe('Codex and Claude auth classification', () => {
  it('detects Codex logged in and logged out', () => {
    assert.equal(
      interpretCodexAuth(result({ stdout: 'Logged in using ChatGPT' })).kind,
      'authenticated',
    )
    assert.equal(
      interpretCodexAuth(result({ stdout: 'Not logged in' })).kind,
      'unauthenticated',
    )
  })

  it('reads Claude loggedIn true and false from JSON', () => {
    assert.equal(
      interpretClaudeAuth(result({ stdout: '{"loggedIn":true}' })).kind,
      'authenticated',
    )
    assert.equal(
      interpretClaudeAuth(result({ stdout: '{"loggedIn":false}' })).kind,
      'unauthenticated',
    )
  })
})

describe('redaction and model omission', () => {
  it('redacts emails, tokens, and paths', () => {
    const hidden = redactDiagnosticText(
      'user@example.com token sk-live-secret-value path /Users/someone/project',
    )
    assert.equal(hidden.includes('user@example.com'), false)
    assert.equal(hidden.includes('sk-live-secret-value'), false)
    assert.equal(hidden.includes('/Users/someone/project'), false)
    assert.match(hidden, /redacted/)
  })

  it('omits model lists and secrets from public results', async () => {
    const calls = []
    const diagnosis = await diagnoseProvider('grok', {
      run: async (command, args) => {
        calls.push({ command, args })
        if (args.includes('models')) {
          return result({
            stdout: 'models:\n- grok-4\nAuthorization: Bearer secret-token\n',
            exitCode: 0,
          })
        }
        return result({ stdout: '{"version":"1.0.0"}', exitCode: 0 })
      },
    })
    assert.deepEqual(calls.find((call) => call.args.includes('models'))?.args, [
      'models',
    ])
    const published = JSON.stringify(diagnosis)
    assert.equal(published.includes('grok-4'), false)
    assert.equal(published.includes('secret-token'), false)
    assert.equal(published.includes('Bearer'), false)
    assert.equal(diagnosis.authenticated.kind, 'authenticated')
  })

  it('keeps secrets out of a failed diagnostic', async () => {
    const diagnosis = await diagnoseProvider('codex', {
      run: async (_command, args) => {
        if (args[0] === 'login') {
          return result({
            commandFound: true,
            exitCode: 1,
            stdout: 'failed for user@example.com token ghp_secretvalue',
            stderr: '/Users/someone/.codex/auth.json',
          })
        }
        return result({ stdout: 'codex 1', exitCode: 0 })
      },
    })
    const published = JSON.stringify(diagnosis)
    assert.equal(published.includes('user@example.com'), false)
    assert.equal(published.includes('ghp_secretvalue'), false)
    assert.equal(published.includes('/Users/someone'), false)
    assert.equal(diagnosis.authenticated.kind, 'unauthenticated')
    const raw = publicCommandResult(
      result({
        stdout: 'ok user@example.com',
        stderr: 'sk-live-secret-value',
      }),
    )
    assert.equal(raw.stdout.includes('user@example.com'), false)
    assert.equal(raw.stderr.includes('sk-live-secret-value'), false)
  })
})

function result(patch = {}) {
  return {
    commandFound: patch.commandFound ?? true,
    exitCode: patch.exitCode ?? 0,
    timedOut: patch.timedOut ?? false,
    stdout: patch.stdout ?? '',
    stderr: patch.stderr ?? '',
  }
}
