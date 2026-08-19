#!/usr/bin/env node
import { runObserverBridge } from '../dist/cli.js'

const code = await runObserverBridge(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
})
process.exit(code)
