import { describe, expect, it } from 'vitest'
import { parseCodexDeepLink } from './codexDeepLink'

const THREAD_ID = '0193c0de-5a11-7abc-9def-0123456789ab'
const THREAD_URL = `codex://threads/${THREAD_ID}`

describe('parseCodexDeepLink', () => {
  it('accepts a canonical UUID and returns the installed-app thread URL', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: THREAD_ID,
      }),
    ).toEqual({ threadId: THREAD_ID, url: THREAD_URL })
  })

  it('accepts live:codex:<UUID> and returns the installed-app thread URL', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `live:codex:${THREAD_ID}`,
      }),
    ).toEqual({ threadId: THREAD_ID, url: THREAD_URL })
  })

  it('rejects live:codex:<repo>:pid:<pid> identities', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: 'live:codex:repo-hataraki:pid:248',
      }),
    ).toBeNull()
  })

  it('rejects malformed UUID values', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: 'not-a-uuid',
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: 'live:codex:sess-wait',
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: '0193c0de5a117abc9def0123456789ab',
      }),
    ).toBeNull()
  })

  it('rejects extra path, query, and fragment content', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `${THREAD_ID}/extra`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `${THREAD_ID}?x=1`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `${THREAD_ID}#frag`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `live:codex:${THREAD_ID}?x=1`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `https://example.test/threads/${THREAD_ID}`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `javascript:${THREAD_ID}`,
      }),
    ).toBeNull()
  })

  it('rejects non-Codex providers and internal session ids', () => {
    expect(
      parseCodexDeepLink({
        source: 'claude-code',
        externalSessionId: THREAD_ID,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'cursor',
        externalSessionId: `live:codex:${THREAD_ID}`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: null,
        id: THREAD_ID,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        id: THREAD_ID,
      }),
    ).toBeNull()
  })
})
