import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createClaudeProvider,
  resolveFakeClaudePath,
  resolvePermissionBrokerPath,
} from '@sikumi-local/provider-claude'
import {
  createCodexProvider,
  resolveFakeCodexPath,
} from '@sikumi-local/provider-codex'
import {
  createGrokProvider,
  resolveFakeGrokPath,
} from '@sikumi-local/provider-grok'
import type { RuntimeProviderId } from '@sikumi-local/core'
import type { AgentProviderAdapter } from '@sikumi-local/provider-sdk'
import { openDatabase } from '../storage/database.js'
import { createStore } from '../storage/store.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { createJobManager } from './job-manager.js'

const tempDirectories: string[] = []
const managers: Array<ReturnType<typeof createJobManager>> = []
const databases: Array<ReturnType<typeof openDatabase>> = []
const adapters: AgentProviderAdapter[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await Promise.all(adapters.splice(0).map((adapter) => adapter.dispose()))
  for (const opened of databases.splice(0)) {
    opened.sqlite.close()
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('real adapter approval resolution', () => {
  it('records a single JobManager approval.resolved for Codex', async () => {
    await expectSingleResolvedApproval(
      trackAdapter(
        createCodexProvider({
          executable: process.execPath,
          argsPrefix: [resolveFakeCodexPath()],
          probeCwd: trackDir(),
          parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        }),
      ),
      'codex',
    )
  })

  it('records a single JobManager approval.resolved for Grok', async () => {
    await expectSingleResolvedApproval(
      trackAdapter(
        createGrokProvider({
          executable: process.execPath,
          argsPrefix: [resolveFakeGrokPath()],
          probeCwd: trackDir(),
          parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        }),
      ),
      'grok-build',
    )
  })

  it('persists a Grok fixture report through JobManager events and artifacts', async () => {
    const adapter = trackAdapter(
      createGrokProvider({
        executable: process.execPath,
        argsPrefix: [resolveFakeGrokPath()],
        probeCwd: trackDir(),
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
      }),
    )
    await adapter.probe()
    const { manager, store, dataDirectory, workspaceId } = openManager(adapter)
    const seen: string[] = []
    const unsubscribe = manager.subscribeAll((event) => {
      seen.push(event.type)
    })
    const job = await manager.createJob({
      workspaceId,
      request: '[schema-echo]READMEの見出しを調べて',
      selectedProvider: 'grok-build',
    })
    const finished = await waitForJob(manager, job.id, 'completed')
    unsubscribe()
    expect(finished.status).toBe('completed')
    expect(
      store.listEvents(job.id).some((event) => event.type === 'run.started'),
    ).toBe(true)
    expect(seen).toContain('run.completed')
    expect(seen).toContain('artifact.created')
    const artifact = manager
      .listArtifacts(job.id)
      .find((item) => item.type === 'report')
    expect(artifact).toBeDefined()
    expect(artifact?.storagePath).toBeTruthy()
    const content = manager.getArtifactContent(artifact!.id)
    expect(content.content).toContain('調査メモ')
    expect(content.content).not.toContain('指定Schemaだけで出力')
    expect(JSON.stringify(store.listEvents(job.id))).not.toMatch(
      /thought|chain-of-thought|sk-|BEGIN PRIVATE/i,
    )
    expect(dataDirectory).toBeTruthy()
  })

  it('records a single JobManager approval.resolved for Claude', async () => {
    await expectSingleResolvedApproval(
      trackAdapter(
        createClaudeProvider({
          executable: process.execPath,
          argsPrefix: [resolveFakeClaudePath()],
          brokerPath: resolvePermissionBrokerPath(),
          probeCwd: trackDir(),
          parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
        }),
      ),
      'claude-code',
    )
  })
})

async function expectSingleResolvedApproval(
  adapter: AgentProviderAdapter,
  selectedProvider: RuntimeProviderId,
): Promise<void> {
  await adapter.probe()
  const { manager, store, workspaceId } = openManager(adapter)
  const job = await manager.createJob({
    workspaceId,
    request: '[approval]調べて',
    selectedProvider,
  })
  const approval = await waitForApproval(manager, job.id)
  await manager.resolveApproval(approval.id, 'approved')
  await waitForJob(manager, job.id, 'completed')
  expect(
    store
      .listEvents(job.id)
      .filter((event) => event.type === 'approval.resolved'),
  ).toHaveLength(1)
}

function openManager(adapter: AgentProviderAdapter) {
  const dataDirectory = track(createTemporaryDirectory())
  const repositoryPath = track(createTemporaryGitRepository())
  const opened = openDatabase(dataDirectory)
  databases.push(opened)
  const store = createStore(opened.db)
  const workspace = store.createWorkspace({
    absolutePath: repositoryPath,
    displayName: 'workshop',
    currentBranch: 'main',
    remoteName: null,
    remoteUrl: null,
    readable: true,
  })
  const manager = createJobManager(store, {
    fakeHarnessEnabled: false,
    adapter,
    dataDirectory,
  })
  managers.push(manager)
  return { manager, store, dataDirectory, workspaceId: workspace.id }
}

async function waitForApproval(
  manager: ReturnType<typeof createJobManager>,
  jobId: string,
) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const pending = manager.listApprovals({ jobId, status: 'pending' })[0]
    if (pending) {
      return pending
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  throw new Error(`Timed out waiting for approval on ${jobId}`)
}

async function waitForJob(
  manager: ReturnType<typeof createJobManager>,
  jobId: string,
  status: string,
) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const job = manager.getJob(jobId)
    if (job.status === status) {
      return job
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  throw new Error(`Timed out waiting for job ${jobId} to become ${status}`)
}

function trackAdapter(adapter: AgentProviderAdapter): AgentProviderAdapter {
  adapters.push(adapter)
  return adapter
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}

function trackDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sikumi-real-adapter-'))
  return track(directory)
}
