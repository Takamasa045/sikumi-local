#!/usr/bin/env node
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataDirectory =
  process.env.SIKUMI_LOCAL_DATA_DIR &&
  process.env.SIKUMI_LOCAL_DATA_DIR.trim().length > 0
    ? process.env.SIKUMI_LOCAL_DATA_DIR
    : join(homedir(), '.shikumi-local')

try {
  const mod = await import(new URL('./cli.js', import.meta.url).href)
  const code = await mod.runClaudeDesktopMcpServer(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: { ...process.env, SIKUMI_LOCAL_DATA_DIR: dataDirectory },
  })
  process.exit(code ?? 0)
} catch (error) {
  process.stderr.write(
    String(error instanceof Error ? error.message : error ?? 'mcp server failed') +
      '\n',
  )
  process.exit(0)
}
