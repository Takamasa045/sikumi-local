import { describe, expect, it } from 'vitest'
import {
  clipList,
  hookCommandMatches,
  isContainedPath,
  isDeniedObserverKey,
  looksWindowsAbsolutePath,
  normalizeComparablePath,
  OBSERVER_MAX_BATCH_BYTES,
  OBSERVER_MAX_BATCH_COUNT,
  OBSERVER_MAX_EVENT_BYTES,
  OBSERVER_MAX_SNAPSHOT_FILES,
  OBSERVER_MAX_SPOOL_FILE_BYTES,
  OBSERVER_MAX_SPOOL_FILE_LINES,
  OBSERVER_MAX_SPOOL_FILES_PER_SWEEP,
  OBSERVER_CONSISTENCY_INTERVAL_MS,
  OBSERVER_HUB_RECENT_LIMIT,
  OBSERVER_SCAN_DEBOUNCE_MS,
  OBSERVER_SCAN_THROTTLE_MS,
  OBSERVER_STALE_AFTER_MS,
  OBSERVER_UI_MAX_FILES,
  pickAllowlistedPayload,
  projectInboundEvent,
  quoteTomlString,
  sanitizeObserverSummary,
  toRepoRelativePath,
  toSafeHookCommand,
} from './index.js'

const SECRET_SHAPES = [
  {
    name: 'codex hook',
    raw: {
      hook_event_name: 'UserPromptSubmit',
      session_id: 's1',
      prompt: 'do not store this prompt',
      transcript_path: '/tmp/transcript.jsonl',
      authorization: 'Bearer sk-live-secret-value',
      api_key: 'sk-live-secret-value',
      cookie: 'session=abc',
      env: { HOME: '/Users/hidden', OPENAI_API_KEY: 'sk-live-secret-value' },
      tool_input: { file_path: 'src/a.ts', patch: '*** Begin Patch' },
    },
  },
  {
    name: 'cursor hook',
    raw: {
      hook_event_name: 'afterAgentResponse',
      conversation_id: 'c1',
      prompt: 'hidden prompt',
      response: 'hidden response',
      oauth_token: 'ya29.hidden',
      set_cookie: 'sid=1',
      fileContents: 'const secret = 1',
    },
  },
  {
    name: 'grok plugin',
    raw: {
      type: 'SessionStart',
      thought: 'hidden reasoning',
      text: 'full model text',
      client_secret: 'grok-secret',
      private_key: '-----BEGIN PRIVATE KEY-----',
    },
  },
  {
    name: 'claude code',
    raw: {
      hook_event_name: 'PostToolUse',
      tool_output: 'stdout body',
      hidden_reasoning: 'cot',
      x_api_key: 'sk-ant-secret',
    },
  },
  {
    name: 'claude desktop',
    raw: {
      type: 'sikumi.begin_work',
      prompt: 'user asked this',
      conversationHistory: [{ role: 'user', content: 'hi' }],
      dotenv: 'API_KEY=sk-live-secret-value',
    },
  },
] as const

const SECRET_VALUES = [
  'sk-live-secret-value',
  'xai-live-secret-value',
  'Bearer sk-live-secret-value',
  'do not store this prompt',
  'hidden response',
  'hidden reasoning',
  'full model text',
  'ya29.hidden',
  '-----BEGIN PRIVATE KEY-----',
  'API_KEY=sk-live-secret-value',
]

describe('phase 8 limits', () => {
  it('exposes explicit observer bounds', () => {
    expect(OBSERVER_MAX_EVENT_BYTES).toBe(16_384)
    expect(OBSERVER_MAX_BATCH_COUNT).toBe(50)
    expect(OBSERVER_MAX_BATCH_BYTES).toBe(256 * 1024)
    expect(OBSERVER_MAX_SPOOL_FILE_BYTES).toBe(256 * 1024)
    expect(OBSERVER_MAX_SPOOL_FILE_LINES).toBe(500)
    expect(OBSERVER_MAX_SPOOL_FILES_PER_SWEEP).toBe(5_000)
    expect(OBSERVER_HUB_RECENT_LIMIT).toBe(200)
    expect(OBSERVER_MAX_SNAPSHOT_FILES).toBe(2_000)
    expect(OBSERVER_UI_MAX_FILES).toBe(40)
    expect(OBSERVER_STALE_AFTER_MS).toBe(30 * 60_000)
    expect(OBSERVER_SCAN_DEBOUNCE_MS).toBe(500)
    expect(OBSERVER_SCAN_THROTTLE_MS).toBe(2_000)
    expect(OBSERVER_CONSISTENCY_INTERVAL_MS).toBe(30_000)
  })

  it('clips lists and reports total truthfully', () => {
    const clipped = clipList(['a', 'b', 'c'], 2)
    expect(clipped.items).toEqual(['a', 'b'])
    expect(clipped.total).toBe(3)
    expect(clipped.truncated).toBe(true)
  })
})

describe('phase 8 redaction table', () => {
  it.each(SECRET_SHAPES)(
    'allowlists $name and drops secrets in keys and values',
    ({ raw }) => {
      const picked = pickAllowlistedPayload(raw)
      const serialized = JSON.stringify(picked)
      for (const secret of SECRET_VALUES) {
        expect(serialized).not.toContain(secret)
      }
      expect(picked.prompt).toBeUndefined()
      expect(picked.response).toBeUndefined()
      expect(picked.env).toBeUndefined()
      expect(sanitizeObserverSummary('TOKEN=sk-live-secret-value')).toBeNull()
    },
  )

  it('denies secret-like key names including nested aliases', () => {
    expect(isDeniedObserverKey('oauthToken')).toBe(true)
    expect(isDeniedObserverKey('x-api-key')).toBe(true)
    expect(isDeniedObserverKey('file_contents')).toBe(true)
    expect(isDeniedObserverKey('client-secret')).toBe(true)
    expect(isDeniedObserverKey('toolName')).toBe(false)
  })

  it('projects adapter-like payloads without storing prompt or body', () => {
    const event = projectInboundEvent({
      source: 'codex',
      hook_event_name: 'UserPromptSubmit',
      session_id: 's-redact',
      prompt: 'do not store this prompt',
      authorization: 'Bearer sk-live-secret-value',
      tool_name: 'Edit',
      file_path: 'src/a.ts',
    })
    const dumped = JSON.stringify(event)
    expect(event.payload.toolName).toBe('Edit')
    expect(dumped).not.toContain('do not store this prompt')
    expect(dumped).not.toContain('sk-live-secret-value')
    expect(dumped).not.toContain('Bearer')
  })
})

describe('phase 8 cross-platform paths', () => {
  it('does not treat repo-other as inside repo on POSIX or Windows forms', () => {
    expect(isContainedPath('/Users/me/repo-other/src', '/Users/me/repo')).toBe(
      false,
    )
    expect(isContainedPath('/Users/me/repo/src', '/Users/me/repo')).toBe(true)
    expect(isContainedPath('C:\\repo-other\\src', 'C:\\repo')).toBe(false)
    expect(isContainedPath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe(true)
    expect(
      isContainedPath(
        '\\\\server\\share\\repo-other',
        '\\\\server\\share\\repo',
      ),
    ).toBe(false)
    expect(
      isContainedPath(
        '\\\\server\\share\\repo\\src',
        '\\\\server\\share\\repo',
      ),
    ).toBe(true)
  })

  it('compares Windows drive and UNC forms without resolving under the current cwd', () => {
    expect(looksWindowsAbsolutePath('C:\\Users\\me\\repo')).toBe(true)
    expect(looksWindowsAbsolutePath('\\\\server\\share\\repo')).toBe(true)
    expect(normalizeComparablePath('C:\\Repo\\Src')).toBe('c:/repo/src')
    expect(toRepoRelativePath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe(
      'src/a.ts',
    )
    expect(toRepoRelativePath('C:\\repo-other\\src\\a.ts', 'C:\\repo')).toBe(
      '/repo-other/src/a.ts',
    )
  })

  it('quotes JSON/TOML hook commands that contain spaces and rejects shell metacharacters', () => {
    const spaced = '/tmp/My Project/sikumi-observer-codex.mjs'
    expect(toSafeHookCommand(spaced)).toBe(spaced)
    expect(quoteTomlString(spaced)).toBe(
      '"/tmp/My Project/sikumi-observer-codex.mjs"',
    )
    expect(hookCommandMatches(`"${spaced}"`, spaced)).toBe(true)
    expect(toSafeHookCommand('/tmp/hook$(reboot)')).toBeNull()
    expect(toSafeHookCommand('/tmp/missing-star*/hook.mjs')).toBeNull()
  })
})
