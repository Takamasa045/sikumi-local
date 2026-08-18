import { describe, expect, it } from 'vitest'
import { createLineBuffer, parseJsonlLine } from './jsonl.js'

describe('parseJsonlLine', () => {
  it('returns sanitized objects and ignores invalid lines', () => {
    expect(parseJsonlLine('')).toBeNull()
    expect(parseJsonlLine('not-json')).toBeNull()
    expect(parseJsonlLine('["array"]')).toBeNull()
    expect(
      parseJsonlLine(
        JSON.stringify({
          type: 'run.state_changed',
          summary: 'この工房の資料を読んでいます',
          reasoning: 'hidden',
          token: 'secret',
        }),
      ),
    ).toEqual({
      value: {
        type: 'run.state_changed',
        summary: 'この工房の資料を読んでいます',
      },
    })
  })
})

describe('createLineBuffer', () => {
  it('splits chunked JSONL and flushes a trailing line', () => {
    const lines: string[] = []
    const buffer = createLineBuffer((line) => {
      lines.push(line)
    })

    buffer.push('{"a":1}\n\n{"b":')
    buffer.push('2}\n{"c":3}')
    buffer.flush()
    buffer.flush()

    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })

  it('does not emit a trailing carriage return as a line', () => {
    const lines: string[] = []
    const buffer = createLineBuffer((line) => {
      lines.push(line)
    })
    buffer.push('\r')
    buffer.flush()
    expect(lines).toEqual([])
  })

  it('drops oversized lines and keeps later valid JSONL', () => {
    const lines: string[] = []
    const buffer = createLineBuffer(
      (line) => {
        lines.push(line)
      },
      { maxLineBytes: 8 },
    )
    buffer.push('{"ok":1}\n')
    buffer.push('{"too-large":true}\n')
    buffer.push('{"ok":2}\n')
    expect(lines).toEqual(['{"ok":1}', '{"ok":2}'])
  })

  it('reassembles a UTF-8 character split across chunks', () => {
    const lines: string[] = []
    const buffer = createLineBuffer((line) => {
      lines.push(line)
    })
    const yen = Buffer.from('{"c":"円"}')
    buffer.push(yen.subarray(0, yen.length - 2))
    buffer.push(
      Buffer.concat([yen.subarray(yen.length - 2), Buffer.from('\n')]),
    )
    expect(lines).toEqual(['{"c":"円"}'])
  })

  it('does not keep a huge chunk without a newline', () => {
    const lines: string[] = []
    const buffer = createLineBuffer(
      (line) => {
        lines.push(line)
      },
      { maxLineBytes: 8 },
    )
    buffer.push(Buffer.alloc(1024 * 64, 0x61))
    buffer.push(Buffer.from('\n{"ok":1}\n'))
    expect(lines).toEqual(['{"ok":1}'])
  })
})
