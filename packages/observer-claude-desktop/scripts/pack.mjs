#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundler = join(root, 'dist/mcpb.js')
if (!existsSync(bundler)) {
  process.stderr.write(
    'dist/mcpb.js is missing. Build @sikumi-local/observer-claude-desktop before packing.\n',
  )
  process.exit(1)
}

const { packageClaudeDesktopMcpb } = await import(pathToFileURL(bundler).href)
const output =
  process.argv[2] ?? join(tmpdir(), `sikumi-observer-${process.pid}.mcpb`)

try {
  const packed = packageClaudeDesktopMcpb(output)
  if (!packed.ok || !existsSync(packed.path)) {
    throw new Error('authoritative MCPB bundler did not produce an archive')
  }
  process.stdout.write(`${packed.path}\n`)
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
}
