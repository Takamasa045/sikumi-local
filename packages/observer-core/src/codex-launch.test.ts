import { describe, expect, it } from 'vitest'
import { isCodexLaunchUrl, parseCodexDeepLink } from './codex-launch.js'

const THREAD_ID = '0193c0de-5a11-7abc-9def-0123456789ab'
const THREAD_URL = `codex://threads/${THREAD_ID}`

describe('parseCodexDeepLink', () => {
  it('accepts a canonical UUID and live:codex:<UUID>', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: THREAD_ID,
      }),
    ).toEqual({ threadId: THREAD_ID, url: THREAD_URL })
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `live:codex:${THREAD_ID}`,
      }),
    ).toEqual({ threadId: THREAD_ID, url: THREAD_URL })
  })

  it('rejects pid identities, malformed values, extra URI parts, and other providers', () => {
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: `live:codex:${THREAD_ID}:pid:248`,
      }),
    ).toBeNull()
    expect(
      parseCodexDeepLink({
        source: 'codex',
        externalSessionId: 'live:codex:repo-hataraki:pid:248',
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
        source: 'cursor',
        externalSessionId: THREAD_ID,
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

describe('isCodexLaunchUrl', () => {
  it('accepts only the installed-app thread URL', () => {
    expect(isCodexLaunchUrl(THREAD_URL)).toBe(true)
    expect(isCodexLaunchUrl(`${THREAD_URL}?x=1`)).toBe(false)
    expect(isCodexLaunchUrl(`https://example.test/threads/${THREAD_ID}`)).toBe(
      false,
    )
  })
})
