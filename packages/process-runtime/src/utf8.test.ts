import { describe, expect, it } from 'vitest'
import { sliceUtf8Bytes, utf8SafeEnd } from './utf8.js'

describe('utf8 byte bounds', () => {
  it('keeps complete characters and drops a trailing partial sequence', () => {
    const euro = Buffer.from('€')
    expect(utf8SafeEnd(euro)).toBe(3)
    expect(utf8SafeEnd(euro.subarray(0, 2))).toBe(0)
    expect(sliceUtf8Bytes(Buffer.from('あいう'), 5).toString('utf8')).toBe('あ')
    expect(sliceUtf8Bytes(Buffer.from('ok'), 8).toString('utf8')).toBe('ok')
  })
})
