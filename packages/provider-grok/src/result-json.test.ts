import { describe, expect, it } from 'vitest'
import { extractJsonObject } from '@sikumi-local/provider-sdk'
import {
  extractJsonObjectCandidates,
  selectSchemaMatchingJsonObject,
} from './result-json.js'

const outputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'summary'],
  additionalProperties: false,
} as const

const echoedSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'summary'],
  additionalProperties: false,
}

const answer = { title: '調査メモ', summary: '完了 {ok}' }

function repairEchoText(
  extraDescription = '説明文として } や { を含みます。',
): string {
  return (
    'これまでの結果を指定Schemaだけで出力してください。説明文は不要です。\n' +
    JSON.stringify(echoedSchema) +
    `\n${extraDescription}\n` +
    JSON.stringify(answer)
  )
}

describe('selectSchemaMatchingJsonObject', () => {
  it('picks the schema-matching answer after a repair prompt and schema echo', () => {
    const text = repairEchoText()
    expect(extractJsonObject(text)).not.toEqual(answer)
    expect(selectSchemaMatchingJsonObject(text, outputSchema)).toEqual(answer)
  })

  it('does not treat a greedy last-brace slice as the answer', () => {
    const text = repairEchoText('閉じ括弧 } と開き { を説明に混ぜる')
    const lastBrace = text.lastIndexOf('{')
    const greedy = text.slice(lastBrace, text.lastIndexOf('}') + 1)
    expect(() => JSON.parse(greedy)).toThrow()
    expect(selectSchemaMatchingJsonObject(text, outputSchema)).toEqual(answer)
  })

  it('keeps braces and escaped quotes inside string values', () => {
    const tricky = {
      title: 'say "hello" and use {curly}',
      summary: 'path \\tmp\\note',
    }
    const text =
      JSON.stringify(echoedSchema) +
      '\nnote: {"not":"the answer"}\n' +
      JSON.stringify(tricky)
    expect(selectSchemaMatchingJsonObject(text, outputSchema)).toEqual(tricky)
  })

  it('skips invalid and non-matching objects and keeps the last matching one', () => {
    const firstMatch = { title: '途中', summary: 'まだ' }
    const lastMatch = { title: '最終', summary: 'これ' }
    const text = [
      '{not-json}',
      JSON.stringify({ type: 'object', properties: {} }),
      JSON.stringify(firstMatch),
      '{"title":1,"summary":true}',
      JSON.stringify(lastMatch),
    ].join('\n')
    expect(selectSchemaMatchingJsonObject(text, outputSchema)).toEqual(
      lastMatch,
    )
  })

  it('returns null when no candidate matches the schema', () => {
    const text =
      'これまでの結果を指定Schemaだけで出力してください。説明文は不要です。\n' +
      JSON.stringify(echoedSchema) +
      '\nまだ本文はありません\n{"title":"不足"}'
    expect(selectSchemaMatchingJsonObject(text, outputSchema)).toBeNull()
    expect(selectSchemaMatchingJsonObject('', outputSchema)).toBeNull()
  })
})

describe('extractJsonObjectCandidates', () => {
  it('finds complete objects without splitting on braces inside strings', () => {
    const text = repairEchoText()
    expect(extractJsonObjectCandidates(text)).toEqual([echoedSchema, answer])
  })

  it('ignores an unclosed object and still returns later complete ones', () => {
    expect(
      extractJsonObjectCandidates(
        '{"title":"broken"\n{"title":"調査メモ","summary":"完了 {ok}"}',
      ),
    ).toEqual([answer])
  })
})
