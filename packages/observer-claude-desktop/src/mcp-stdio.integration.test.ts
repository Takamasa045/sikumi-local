import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeRegisteredRepositoryCatalog } from './catalog.js'
import { SIKUMI_MCP_TOOLS } from './events.js'
import {
  assertArchiveRuntimeComplete,
  packageClaudeDesktopMcpb,
  unpackClaudeDesktopMcpb,
} from './mcpb.js'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('official SDK client against packed MCPB server', () => {
  it('initializes, lists seven tools, calls list/begin/note/complete, and exits', async () => {
    const dataDirectory = track(mkdtempSync(join(tmpdir(), 'mcp-sdk-data-')))
    const repo = track(mkdtempSync(join(tmpdir(), 'mcp-sdk-repo-')))
    mkdirSync(join(repo, 'src/profile'), { recursive: true })
    writeFileSync(join(repo, 'src/profile/avatar.tsx'), 'export const n = 1\n')
    writeRegisteredRepositoryCatalog(dataDirectory, [
      {
        id: 'repo-1',
        displayName: 'demo',
        absolutePath: realpathSync(repo),
      },
    ])

    const archive = join(
      track(mkdtempSync(join(tmpdir(), 'mcp-sdk-pack-'))),
      'sikumi.mcpb',
    )
    const packed = packageClaudeDesktopMcpb(archive)
    expect(packed.ok).toBe(true)
    const extracted = track(mkdtempSync(join(tmpdir(), 'mcp-sdk-extract-')))
    unpackClaudeDesktopMcpb(archive, extracted)
    const root = resolveUnpackedRoot(extracted)
    expect(assertArchiveRuntimeComplete(root)).toEqual([])
    expect(existsSync(join(root, 'server/cli.js'))).toBe(true)
    expect(existsSync(join(root, 'package.json'))).toBe(true)

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'server/index.js')],
      cwd: root,
      env: {
        ...getDefaultEnvironment(),
        SIKUMI_LOCAL_DATA_DIR: dataDirectory,
      },
      stderr: 'pipe',
    })
    const client = new Client({
      name: 'sikumi-observer-test',
      version: '0.1.0',
    })
    await client.connect(transport)
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        ...SIKUMI_MCP_TOOLS,
      ])
      expect(listed.tools).toHaveLength(7)

      const repositories = await client.callTool({
        name: 'sikumi.list_registered_repositories',
        arguments: {},
      })
      expect(repositories.isError).toBeFalsy()
      const listedPayload = toolPayload(repositories)
      expect(listedPayload.ok).toBe(true)
      expect(listedPayload.repositories).toEqual([
        expect.objectContaining({ id: 'repo-1' }),
      ])

      const begun = await client.callTool({
        name: 'sikumi.begin_work',
        arguments: {
          repositoryPath: realpathSync(repo),
          summary: 'SDK integration',
        },
      })
      expect(begun.isError).toBe(false)
      const begunPayload = toolPayload(begun)
      expect(begunPayload.ok).toBe(true)
      expect(typeof begunPayload.sessionId).toBe('string')

      writeFileSync(
        join(repo, 'src/profile/avatar.tsx'),
        'export const n = 2\n',
      )
      const noted = await client.callTool({
        name: 'sikumi.note_resource',
        arguments: {
          sessionId: begunPayload.sessionId,
          resourceType: 'file',
          resourceKey: 'src/profile/avatar.tsx',
          action: 'write',
        },
      })
      expect(noted.isError).toBe(false)
      expect(toolPayload(noted).ok).toBe(true)

      const completed = await client.callTool({
        name: 'sikumi.complete_work',
        arguments: { sessionId: begunPayload.sessionId },
      })
      expect(completed.isError).toBe(false)
      expect(toolPayload(completed).ok).toBe(true)
      expect(toolPayload(completed).status).toBe('completed')
    } finally {
      const pid = transport.pid
      await client.close()
      await waitForProcessExit(pid)
    }
  }, 30_000)
})

function toolPayload(result: unknown): {
  readonly ok?: boolean
  readonly sessionId?: string
  readonly status?: string
  readonly repositories?: ReadonlyArray<{ readonly id: string }>
} {
  if (!result || typeof result !== 'object') {
    return {}
  }
  const record = result as {
    readonly content?: ReadonlyArray<{ readonly text?: string }>
    readonly structuredContent?: unknown
  }
  if (
    record.structuredContent &&
    typeof record.structuredContent === 'object' &&
    !Array.isArray(record.structuredContent)
  ) {
    return record.structuredContent as {
      readonly ok?: boolean
      readonly sessionId?: string
      readonly status?: string
      readonly repositories?: ReadonlyArray<{ readonly id: string }>
    }
  }
  const text = record.content?.[0]?.text
  return text ? (JSON.parse(text) as ReturnType<typeof toolPayload>) : {}
}

function resolveUnpackedRoot(extracted: string): string {
  if (existsSync(join(extracted, 'server/index.js'))) {
    return extracted
  }
  for (const child of readdirSync(extracted)) {
    const candidate = join(extracted, child)
    if (existsSync(join(candidate, 'server/index.js'))) {
      return candidate
    }
  }
  return extracted
}

async function waitForProcessExit(
  pid: number | null,
  timeoutMs = 5000,
): Promise<void> {
  if (!pid) {
    return
  }
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      process.kill(pid, 0)
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
    } catch {
      return
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
  throw new Error(`packed MCP server pid ${pid} did not exit cleanly`)
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
