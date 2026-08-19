import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { serveMcpStdio } from './mcp-protocol.js'

export interface McpIo {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly env: NodeJS.ProcessEnv
}

export async function runClaudeDesktopMcpServer(
  argv: readonly string[],
  io: McpIo,
): Promise<number> {
  try {
    await serveMcpStdio(io, {
      dataDirectory: dataDirectoryFrom(argv, io.env),
    })
  } catch (error) {
    // fail-open: never block Claude, but keep the failure visible
    const message =
      error instanceof Error ? error.message : String(error ?? 'mcp server failed')
    io.stderr.write(`sikumi-observer-claude-desktop: ${message}\n`)
  }
  return 0
}

function dataDirectoryFrom(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string {
  for (let index = 0; index < argv.length; index += 1) {
    if (
      (argv[index] === '--root' || argv[index] === '--data-dir') &&
      argv[index + 1]
    ) {
      return argv[index + 1]!
    }
  }
  return env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')
}
