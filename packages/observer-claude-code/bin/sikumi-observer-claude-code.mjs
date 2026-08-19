#!/usr/bin/env node
import { runClaudeCodeObserverHook } from '../dist/cli.js'

const code = await runClaudeCodeObserverHook(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
})
process.exit(code)
