import { describe, expect, it } from 'vitest'
import { AppError } from './errors.js'
import {
  payloadContainsSecrets,
  redactRemoteUrl,
  redactSensitiveText,
  sanitizeEventPayload,
  textContainsSecrets,
} from './redact.js'

describe('redactSensitiveText', () => {
  it('masks known secret prefixes, bearer tokens, and assignments', () => {
    expect(
      redactSensitiveText(
        'curl -H "Authorization: Bearer abcdefghijklmnop" TOKEN=sk-live-secret-value KEY=xai-live-secret-value',
      ),
    ).toBe(
      'curl -H "Authorization: Bearer [redacted]" TOKEN=[redacted] KEY=[redacted]',
    )
    expect(redactSensitiveText('PASSWORD: hunter2-extra')).toBe(
      'PASSWORD=[redacted]',
    )
    expect(redactSensitiveText('この工房の資料を読んでいます')).toBe(
      'この工房の資料を読んでいます',
    )
    expect(redactSensitiveText('ask-the-user about a token')).toBe(
      'ask-the-user about a token',
    )
  })

  it('bounds huge inputs and does not keep a secret tail', () => {
    const secret = `sk-${'a'.repeat(24)}`
    const huge = `${'safe '.repeat(2_000)}${secret}`
    const redacted = redactSensitiveText(huge)
    expect(redacted.length).toBeLessThanOrEqual(8_192)
    expect(redacted).not.toContain(secret)
  })
})

describe('textContainsSecrets', () => {
  it('finds secret-like values even after the first window', () => {
    expect(textContainsSecrets('TOKEN=sk-live-secret-value')).toBe(true)
    expect(textContainsSecrets('普通の差分です')).toBe(false)
    const late = `${'x'.repeat(9_000)}TOKEN=sk-live-secret-value`
    expect(textContainsSecrets(late)).toBe(true)
  })
})

describe('redactRemoteUrl', () => {
  it('strips credentials from https remotes', () => {
    expect(
      redactRemoteUrl(
        'https://x-access-token:ghs_super_secret@github.com/example/repo.git',
      ),
    ).toBe('https://github.com/example/repo.git')
  })

  it('leaves ssh remotes without embedded passwords unchanged', () => {
    expect(redactRemoteUrl('git@github.com:example/repo.git')).toBe(
      'git@github.com:example/repo.git',
    )
  })

  it('returns empty input unchanged', () => {
    expect(redactRemoteUrl('   ')).toBe('')
  })
})

describe('sanitizeEventPayload', () => {
  it('drops reasoning and secret keys before persistence', () => {
    expect(
      sanitizeEventPayload({
        summary: 'この工房の資料を読んでいます',
        reasoning: 'internal chain of thought',
        token: 'should-not-persist',
      }),
    ).toEqual({
      summary: 'この工房の資料を読んでいます',
    })
  })

  it('removes nested reasoning and tokens inside objects and arrays', () => {
    expect(
      sanitizeEventPayload({
        summary: '公式情報を探しています',
        details: {
          note: 'keep',
          thinking: 'hidden thought',
          sources: [
            { title: 'docs', authorization: 'Bearer secret' },
            { title: 'readme', excerpt: 'ok' },
          ],
        },
      }),
    ).toEqual({
      summary: '公式情報を探しています',
      details: {
        note: 'keep',
        sources: [{ title: 'docs' }, { title: 'readme', excerpt: 'ok' }],
      },
    })
  })

  it('fails safely on circular payloads', () => {
    const payload: Record<string, unknown> = { summary: 'cycle' }
    payload.self = payload

    expect(() => sanitizeEventPayload(payload)).toThrow(AppError)
    try {
      sanitizeEventPayload(payload)
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('VALIDATION_FAILED')
    }
  })

  it('fails safely on overly deep payloads', () => {
    let deep: Record<string, unknown> = { token: 'deep-secret' }
    for (let index = 0; index < 40; index += 1) {
      deep = { child: deep }
    }

    expect(() => sanitizeEventPayload(deep)).toThrow(AppError)
  })

  it('redacts secrets embedded in string leaves without dropping the field', () => {
    expect(
      sanitizeEventPayload({
        summary: 'コマンド実行の確認が必要です: TOKEN=sk-live-secret-value',
      }),
    ).toEqual({
      summary: 'コマンド実行の確認が必要です: TOKEN=[redacted]',
    })
  })

  it('detects secret-bearing payloads including nested values', () => {
    expect(payloadContainsSecrets({ summary: 'ok' })).toBe(false)
    expect(payloadContainsSecrets({ apiKey: 'abc' })).toBe(true)
    expect(payloadContainsSecrets({ outer: { password: 'abc' } })).toBe(true)
    expect(payloadContainsSecrets({ items: [{ access_token: 'abc' }] })).toBe(
      true,
    )
    expect(
      payloadContainsSecrets({
        summary: 'Bearer abcdefghijklmnop',
      }),
    ).toBe(true)
  })

  it('fails safely when secret detection hits a cycle or excessive depth', () => {
    const cyclic: Record<string, unknown> = { summary: 'ok' }
    cyclic.self = cyclic
    expect(() => payloadContainsSecrets(cyclic)).toThrow(AppError)

    let deep: unknown = 'leaf'
    for (let index = 0; index < 40; index += 1) {
      deep = [deep]
    }
    expect(() => payloadContainsSecrets(deep)).toThrow(AppError)
  })
})
