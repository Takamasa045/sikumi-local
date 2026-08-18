import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError, FAKE_PROVIDER_ID } from '@sikumi-local/core'
import type { CanonicalEvent } from '@sikumi-local/provider-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFakeProvider,
  FAKE_PROVIDER_DISPLAY_NAME,
} from './fake-provider.js'
import { mapFakeProcessEvent } from './map-event.js'
import { scenarioFromPrompt } from './scenario.js'

const tempDirectories: string[] = []

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Fake Provider', () => {
  it('is a harness identity and never claims to be a real engine', async () => {
    const provider = createFakeProvider()
    const probe = await provider.probe()

    expect(provider.id).toBe(FAKE_PROVIDER_ID)
    expect(provider.advertisedAsRealProvider).toBe(false)
    expect(provider.displayName).toBe(FAKE_PROVIDER_DISPLAY_NAME)
    expect(provider.displayName).not.toMatch(/codex|grok|claude/i)
    expect(probe.warnings[0]).toMatch(/harness/i)
    expect(await provider.listModels()).toEqual([])
    expect((await provider.getAuthStatus()).authenticated).toBe(true)
    expect((await provider.getCapabilities()).liveApprovals).toBe(true)
    await expect(
      provider.resumeRun({
        ...baseSpecification(createTempCwd()),
        providerSessionId: 'missing',
      }),
    ).rejects.toBeInstanceOf(AppError)
    await expect(
      provider.respondToQuestion('q', { text: 'no' }),
    ).rejects.toBeInstanceOf(AppError)
    await provider.dispose()
  })

  it('reproduces start, repository read, web search, approval, artifact, and complete', async () => {
    const cwd = createTempCwd()
    const provider = createFakeProvider()
    const handle = await provider.startRun(baseSpecification(cwd))
    const events: string[] = []

    const consume = (async () => {
      for await (const event of handle.events()) {
        events.push(event.type)
        if (event.type === 'approval.requested') {
          await provider.respondToApproval(event.requestId, 'approved')
        }
      }
    })()

    await consume
    await provider.dispose()

    expect(events).toEqual([
      'run.started',
      'run.state_changed',
      'repository.read',
      'run.state_changed',
      'web.search',
      'approval.requested',
      'approval.resolved',
      'run.state_changed',
      'artifact.created',
      'run.state_changed',
      'run.completed',
    ])
  })

  it('reproduces a deterministic failure path', async () => {
    const provider = createFakeProvider()
    const handle = await provider.startRun({
      ...baseSpecification(createTempCwd()),
      prompt: 'これを[fail]させて',
    })
    const events = await collectTypes(handle.events())
    await provider.dispose()

    expect(events.at(0)).toBe('run.started')
    expect(events.at(-1)).toBe('run.failed')
    expect(JSON.stringify(events)).not.toContain('INTERNAL_REASONING')
  })

  it('cancels a hanging run', async () => {
    const provider = createFakeProvider()
    const handle = await provider.startRun({
      ...baseSpecification(createTempCwd()),
      prompt: '[hang]待って',
    })

    const consume = collectTypes(handle.events())
    await provider.cancelRun(handle.runId)
    const events = await consume
    await provider.dispose()

    expect(events.at(-1)).toBe('run.cancelled')
  })

  it('routes reverse-order approvals only to the matching run', async () => {
    const provider = createFakeProvider()
    const first = await provider.startRun({
      ...baseSpecification(createTempCwd()),
      runId: 'run_a',
      prompt: '調べて A',
    })
    const second = await provider.startRun({
      ...baseSpecification(createTempCwd()),
      runId: 'run_b',
      prompt: '調べて B',
    })

    const firstEvents: CanonicalEvent[] = []
    const secondEvents: CanonicalEvent[] = []
    let firstApproval: string | undefined
    let secondApproval: string | undefined

    const consumeFirst = (async () => {
      for await (const event of first.events()) {
        firstEvents.push(event)
        if (event.type === 'approval.requested') {
          firstApproval = event.requestId
        }
      }
    })()
    const consumeSecond = (async () => {
      for await (const event of second.events()) {
        secondEvents.push(event)
        if (event.type === 'approval.requested') {
          secondApproval = event.requestId
        }
      }
    })()

    const deadline = Date.now() + 5_000
    while (
      (firstApproval === undefined || secondApproval === undefined) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })
    }

    expect(firstApproval).toBe('run_a:web-search')
    expect(secondApproval).toBe('run_b:web-search')
    if (!firstApproval || !secondApproval) {
      throw new Error('expected both approval request ids')
    }
    await provider.respondToApproval(secondApproval, 'approved')
    await provider.respondToApproval(firstApproval, 'approved')
    await Promise.all([consumeFirst, consumeSecond])
    await provider.dispose()

    expect(firstEvents.at(-1)?.type).toBe('run.completed')
    expect(secondEvents.at(-1)?.type).toBe('run.completed')
    expect(
      firstEvents.some(
        (event) =>
          event.type === 'approval.resolved' &&
          event.requestId === 'run_a:web-search',
      ),
    ).toBe(true)
    expect(
      secondEvents.some(
        (event) =>
          event.type === 'approval.resolved' &&
          event.requestId === 'run_b:web-search',
      ),
    ).toBe(true)
  })

  it('keeps a registered repository unchanged when spawning a child process', async () => {
    const repository = createTempGitRepository()
    const beforeStatus = gitPorcelain(repository)
    const beforeFiles = gitLsFiles(repository)
    const beforeListing = readdirSync(repository).sort()

    const provider = createFakeProvider()
    const handle = await provider.startRun({
      ...baseSpecification(repository),
      runId: 'run_spawn',
      prompt: '[spawn-child]隔離確認',
    })
    const consume = collectTypes(handle.events())
    await provider.cancelRun(handle.runId)
    await consume
    await provider.dispose()

    expect(gitPorcelain(repository)).toBe(beforeStatus)
    expect(gitLsFiles(repository)).toBe(beforeFiles)
    expect(readdirSync(repository).sort()).toEqual(beforeListing)
    expect(existsSync(join(repository, '.sikumi-fake-child.pid'))).toBe(false)
  })

  it('rejects an unregistered cwd before spawning', async () => {
    const provider = createFakeProvider()
    const registered = createTempCwd()
    const foreign = createTempCwd()

    await expect(
      provider.startRun({
        ...baseSpecification(foreign),
        allowedCwdRoots: [registered],
      }),
    ).rejects.toBeInstanceOf(AppError)
    await provider.dispose()
  })
})

describe('scenario and event mapping', () => {
  it('selects scenarios from the prompt and ignores unknown JSONL', () => {
    expect(scenarioFromPrompt('調べて')).toBe('complete')
    expect(scenarioFromPrompt('[fail]')).toBe('fail')
    expect(scenarioFromPrompt('[hang]')).toBe('hang')
    expect(scenarioFromPrompt('[spawn-child]')).toBe('spawn-child')
    expect(
      mapFakeProcessEvent('run_1', { type: 'env.snapshot' }, 't'),
    ).toBeNull()
    expect(
      mapFakeProcessEvent(
        'run_1',
        { type: 'run.state_changed', state: 'reading_repository' },
        't',
      ),
    ).toMatchObject({ state: 'reading_repository' })
    expect(
      mapFakeProcessEvent(
        'run_1',
        { type: 'artifact.created', artifactType: 'markdown', title: 'メモ' },
        't',
      ),
    ).toMatchObject({ artifactType: 'markdown', title: 'メモ' })
    expect(
      mapFakeProcessEvent('run_1', { type: 'approval.requested' }, 't'),
    ).toBeNull()
    expect(
      mapFakeProcessEvent(
        'run_1',
        { type: 'approval.resolved', requestId: 'x', decision: 'maybe' },
        't',
      ),
    ).toBeNull()
    expect(
      mapFakeProcessEvent(
        'run_1',
        {
          type: 'approval.requested',
          requestId: 'x',
          risk: 'high',
          summary: '確認',
        },
        't',
      ),
    ).toMatchObject({ risk: 'high' })
    expect(
      mapFakeProcessEvent('run_1', { type: 'run.started' }, 't'),
    ).toMatchObject({ summary: '仕事を始めます' })
    expect(
      mapFakeProcessEvent('run_1', { type: 'web.search', query: 'docs' }, 't'),
    ).toMatchObject({ query: 'docs' })
    expect(
      mapFakeProcessEvent(
        'run_1',
        { type: 'repository.read', path: 'README.md' },
        't',
      ),
    ).toMatchObject({ path: 'README.md' })
    expect(
      mapFakeProcessEvent('run_1', { type: 'artifact.created' }, 't'),
    ).toMatchObject({ artifactType: 'report', title: '成果' })
  })
})

function baseSpecification(cwd: string) {
  return {
    runId: 'run_fake',
    workspaceId: 'ws_1',
    employeeId: 'saguru',
    cwd,
    prompt: 'このRepositoryの構成を調べて',
    permissionProfile: 'research' as const,
    environment: {},
    allowedCwdRoots: [cwd],
  }
}

function createTempGitRepository(): string {
  const directory = createTempCwd()
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'fake@example.com'], {
    cwd: directory,
  })
  execFileSync('git', ['config', 'user.name', 'fake'], { cwd: directory })
  writeFileSync(join(directory, 'README.md'), '# fake\n')
  execFileSync('git', ['add', 'README.md'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory })
  return directory
}

function gitPorcelain(cwd: string): string {
  return execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  })
}

function gitLsFiles(cwd: string): string {
  return execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
}

function createTempCwd(): string {
  const directory = join(
    tmpdir(),
    `sikumi-fake-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(directory, { recursive: true })
  tempDirectories.push(directory)
  return directory
}

async function collectTypes(
  events: AsyncIterable<{ type: string }>,
): Promise<string[]> {
  const collected: string[] = []
  for await (const event of events) {
    collected.push(event.type)
  }
  return collected
}
