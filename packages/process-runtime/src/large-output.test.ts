import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLineBuffer } from './jsonl.js'
import {
  OUTPUT_OVERFLOW_DIAGNOSTIC,
  createOutputOverflowDiagnostic,
  toJsonlRecord,
  type OutputOverflowDiagnostic,
} from './output-limit.js'
import { spawnManagedProcess } from './spawn.js'
import { sliceUtf8Bytes } from './utf8.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('large output byte limits', () => {
  it('truncates on UTF-8 byte boundaries and never splits a character', () => {
    const yen = Buffer.from('円')
    expect(yen.length).toBe(3)
    expect(sliceUtf8Bytes(yen, 2).toString('utf8')).toBe('')
    expect(sliceUtf8Bytes(Buffer.from('あいう'), 5).toString('utf8')).toBe('あ')
    expect(sliceUtf8Bytes(Buffer.from('あいう'), 5).includes(0xff)).toBe(false)
  })

  it('emits a diagnostic event when a JSONL line exceeds the byte cap', () => {
    const lines: string[] = []
    const diagnostics: OutputOverflowDiagnostic[] = []
    const buffer = createLineBuffer(
      (line) => {
        lines.push(line)
      },
      {
        maxLineBytes: 8,
        onOverflow: (diagnostic) => {
          diagnostics.push(diagnostic)
        },
      },
    )

    buffer.push('{"ok":1}\n')
    buffer.push(Buffer.from('{"too":"円円"}\n'))
    buffer.push('{"ok":2}\n')

    expect(lines).toEqual(['{"ok":1}', '{"ok":2}'])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      type: OUTPUT_OVERFLOW_DIAGNOSTIC,
      diagnostic: 'output_overflow',
      maxBytes: 8,
    })
    expect(createOutputOverflowDiagnostic({ maxBytes: 8 }).summary).toContain(
      '上限',
    )
    const event: Record<string, unknown> = toJsonlRecord(
      createOutputOverflowDiagnostic({ maxBytes: 8, observedBytes: 12 }),
    )
    expect(event).toMatchObject({
      type: OUTPUT_OVERFLOW_DIAGNOSTIC,
      diagnostic: 'output_overflow',
      maxBytes: 8,
      observedBytes: 12,
    })
  })

  it('puts overflow on the managed JSONL stream as a diagnostic event', async () => {
    const cwd = track(mkdtempSync(join(tmpdir(), 'sikumi-large-output-')))
    const oversized = `${'x'.repeat(80)}\n{"type":"run.started","summary":"仕事を始めます"}\n`
    const child = spawnManagedProcess({
      executable: process.execPath,
      args: ['-e', `process.stdout.write(${JSON.stringify(oversized)})`],
      cwd,
      allowedCwdRoots: [cwd],
      maxJsonlLineBytes: 64,
    })
    const events: Array<Record<string, unknown>> = []
    const consume = (async () => {
      for await (const event of child.jsonl) {
        events.push(event)
      }
    })()
    const exit = await child.wait()
    await consume

    expect(exit.outputOverflowed).toBe(true)
    expect(
      events.some(
        (event) =>
          event.diagnostic === 'output_overflow' &&
          event.type === OUTPUT_OVERFLOW_DIAGNOSTIC,
      ),
    ).toBe(true)
    expect(events.some((event) => event.type === 'run.started')).toBe(false)
  })
})

function track(directory: string): string {
  directories.push(directory)
  return directory
}
