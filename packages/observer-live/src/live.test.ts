import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OBSERVER_LIVE_SESSION_MAX_AGE_MS } from '@sikumi-local/observer-core'
import { discoverLiveSessions } from './discover.js'
import { identifyLiveAgent } from './identify.js'
import { isBindableCwd, matchRegisteredRoot } from './match.js'
import { encodeClaudeProjectDir } from './session-files.js'
import { acceptStoredTitle } from './titles.js'
import type { LiveProcessRow, RegisteredLiveRoot } from './types.js'

const NOW = Date.parse('2026-08-19T00:10:00.000Z')
const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('identifyLiveAgent', () => {
  it('maps known binaries and ignores helpers', () => {
    expect(
      identifyLiveAgent({ command: '/opt/homebrew/bin/codex', args: 'codex' }),
    ).toEqual({ source: 'codex', surface: 'cli' })
    expect(
      identifyLiveAgent({ command: 'claude', args: 'claude --resume' }),
    ).toEqual({ source: 'claude-code', surface: 'cli' })
    expect(
      identifyLiveAgent({ command: 'Cursor', args: '/Applications/Cursor.app/Contents/MacOS/Cursor' }),
    ).toEqual({ source: 'cursor', surface: 'ide' })
    expect(
      identifyLiveAgent({ command: 'cursor-agent', args: 'cursor-agent' }),
    ).toEqual({ source: 'cursor', surface: 'cursor-agent' })
    expect(identifyLiveAgent({ command: 'grok', args: 'grok' })).toEqual({
      source: 'grok-build',
      surface: 'cli',
    })
    expect(
      identifyLiveAgent({
        command: 'Cursor Helper',
        args: 'Cursor Helper (GPU)',
      }),
    ).toBeNull()
    expect(
      identifyLiveAgent({
        command: 'node',
        args: 'node sikumi-observer-codex.mjs',
      }),
    ).toBeNull()
    expect(
      identifyLiveAgent({
        command: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
        args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
      }),
    ).toEqual({ source: 'codex', surface: 'desktop-app' })
    expect(
      identifyLiveAgent({
        command: 'ChatGPT Helper',
        args: 'ChatGPT Helper (GPU)',
      }),
    ).toBeNull()
    expect(
      identifyLiveAgent({
        command: 'node',
        args: 'node /Users/takamasa/Projects/*開発/hataraki/packages/provider-claude/fixtures/fake-claude.mjs',
      }),
    ).toBeNull()
    expect(
      identifyLiveAgent({
        command: 'node',
        args: 'node packages/provider-codex/fixtures/fake-codex.mjs',
      }),
    ).toBeNull()
    expect(
      identifyLiveAgent({
        command: 'node',
        args: 'node packages/process-runtime/fixtures/linger-child.mjs',
      }),
    ).toBeNull()
  })
})

describe('acceptStoredTitle', () => {
  it('keeps an explicit short title and refuses invented or prompt-like text', () => {
    expect(acceptStoredTitle('ログイン画面の直し')).toBe('ログイン画面の直し')
    expect(acceptStoredTitle('作業中')).toBeNull()
    expect(acceptStoredTitle('Codexの作業が始まりました')).toBeNull()
    expect(acceptStoredTitle('Claude Codeがファイルを扱っています')).toBeNull()
    expect(acceptStoredTitle('Codexがファイルを扱っています')).toBeNull()
    expect(acceptStoredTitle('/Users/me/project')).toBeNull()
    expect(acceptStoredTitle(`${'長い依頼文です。'.repeat(20)}`)).toBeNull()
    expect(acceptStoredTitle('first line\nsecond line')).toBeNull()
  })
})

describe('discoverLiveSessions', () => {
  it('uses a live process cwd in a registered folder and ignores outsiders', () => {
    const blog = track(createTempDir('blog-'))
    const other = track(createTempDir('other-'))
    const sightings = discoverLiveSessions({
      homeDir: track(createTempDir('home-')),
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', blog)],
      listProcesses: () => [
        processRow({
          pid: 11,
          user: 'mei',
          command: 'codex',
          args: 'codex',
          cwd: blog,
        }),
        processRow({
          pid: 12,
          user: 'other',
          command: 'codex',
          args: 'codex',
          cwd: blog,
        }),
        processRow({
          pid: 13,
          user: 'mei',
          command: 'claude',
          args: 'claude',
          cwd: other,
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      kind: 'process',
      repositoryId: 'repo-blog',
      cwd: blog,
      title: null,
      ingestionMethod: 'process-scan',
      attributionConfidence: 'verified',
    })
  })

  it('reads a recent session record for title and skips stale files', () => {
    const home = track(createTempDir('home-'))
    const blog = track(createTempDir('blog-'))
    const sessionId = '019dabc6-8fef-7681-a054-b5bb75fcb97d'
    writeCodexSession(home, {
      id: sessionId,
      cwd: blog,
      mtime: NOW - 60_000,
    })
    writeFileSync(
      join(home, '.codex', 'session_index.jsonl'),
      `${JSON.stringify({ id: sessionId, thread_name: 'APIを直している' })}\n`,
    )
    writeCodexSession(home, {
      id: 'old-session',
      cwd: blog,
      mtime: NOW - OBSERVER_LIVE_SESSION_MAX_AGE_MS - 5_000,
      dayOffset: -3,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', blog)],
      listProcesses: () => [],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      kind: 'session-file',
      title: 'APIを直している',
      ingestionMethod: 'session-file',
    })
  })

  it('matches Claude Code project folders and Cursor meta.json without reading prompts', () => {
    const home = track(createTempDir('home-'))
    const blog = track(createTempDir('blog-'))
    const encoded = encodeClaudeProjectDir(blog)
    const claudeDir = join(home, '.claude', 'projects', encoded)
    mkdirSync(claudeDir, { recursive: true })
    const claudeFile = join(claudeDir, 'sess-1.jsonl')
    writeFileSync(
      claudeFile,
      `${JSON.stringify({
        cwd: blog,
        sessionId: 'sess-1',
        customTitle: '見出しの直し',
        message: { content: 'this prompt must vanish' },
      })}\n`,
    )
    touch(claudeFile, NOW - 30_000)

    const hash = createHash('md5').update(blog).digest('hex')
    const cursorDir = join(home, '.cursor', 'chats', hash, 'chat-1')
    mkdirSync(cursorDir, { recursive: true })
    const meta = join(cursorDir, 'meta.json')
    writeFileSync(
      meta,
      JSON.stringify({
        cwd: blog,
        title: 'Cursorの作業が始まりました',
      }),
    )
    touch(meta, NOW - 20_000)

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', blog)],
      listProcesses: () => [],
    })

    const claude = sightings.find((item) => item.source === 'claude-code')
    const cursor = sightings.find((item) => item.source === 'cursor')
    expect(claude?.title).toBe('見出しの直し')
    expect(cursor?.title).toBeNull()
    expect(JSON.stringify(sightings)).not.toContain('this prompt must vanish')
  })

  it('attaches a session title to a live process without inventing one', () => {
    const home = track(createTempDir('home-'))
    const blog = track(createTempDir('blog-'))
    writeCodexSession(home, {
      id: 'sess-live',
      cwd: blog,
      mtime: NOW - 10_000,
    })
    writeFileSync(
      join(home, '.codex', 'session_index.jsonl'),
      `${JSON.stringify({ id: 'sess-live', thread_name: 'テストを書いている' })}\n`,
    )

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', blog)],
      listProcesses: () => [
        processRow({
          pid: 21,
          user: 'mei',
          command: 'codex',
          args: 'codex',
          cwd: blog,
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      kind: 'process',
      title: 'テストを書いている',
      ingestionMethod: 'process-scan',
    })
  })
})

describe('matchRegisteredRoot', () => {
  it('does not treat a sibling path as the registered folder', () => {
    const roots = [root('repo', 'ws', '/Users/mei/project')]
    expect(matchRegisteredRoot('/Users/mei/project', roots)?.repositoryId).toBe(
      'repo',
    )
    expect(matchRegisteredRoot('/Users/mei/project-other', roots)).toBeNull()
  })

  it('treats a same-leaf nested twin as the registered place', () => {
    const roots = [root('repo', 'ws', '/Users/takamasa/Projects/hataraki')]
    expect(
      matchRegisteredRoot(
        '/Users/takamasa/Projects/*開発/hataraki',
        roots,
      )?.repositoryId,
    ).toBe('repo')
    expect(
      matchRegisteredRoot(
        '/Users/takamasa/Projects/*開発/hataraki/src',
        roots,
      )?.repositoryId,
    ).toBe('repo')
    expect(
      matchRegisteredRoot('/Users/other/hataraki', roots),
    ).toBeNull()
    expect(
      matchRegisteredRoot('/Users/takamasa/Documents/hataraki', roots),
    ).toBeNull()
    expect(isBindableCwd('/')).toBe(false)
    expect(matchRegisteredRoot('/', roots)).toBeNull()
  })
})

describe('desktop and alias discovery', () => {
  it('binds a Codex process in a same-leaf twin folder to the registered place', () => {
    const home = track(createTempDir('home-'))
    const registered = '/Users/takamasa/Projects/hataraki'
    const live = '/Users/takamasa/Projects/*開発/hataraki'
    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', registered)],
      listProcesses: () => [
        processRow({
          pid: 31,
          user: 'mei',
          command: 'codex',
          args: 'codex',
          cwd: live,
        }),
        processRow({
          pid: 32,
          user: 'mei',
          command: 'codex',
          args: 'codex',
          cwd: '/Users/other/hataraki',
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      kind: 'process',
      repositoryId: 'repo-hataraki',
      cwd: live,
    })
  })

  it('ignores leftover fixture processes even inside a registered twin', () => {
    const home = track(createTempDir('home-'))
    const registered = '/Users/takamasa/Projects/hataraki'
    const live = '/Users/takamasa/Projects/*開発/hataraki'
    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', registered)],
      listProcesses: () => [
        processRow({
          pid: 41,
          user: 'mei',
          command: 'node',
          args: `node ${live}/packages/provider-claude/fixtures/fake-claude.mjs`,
          cwd: `${live}/packages/provider-claude/fixtures`,
        }),
        processRow({
          pid: 42,
          user: 'mei',
          command: 'node',
          args: `node ${live}/packages/provider-codex/fixtures/fake-codex.mjs`,
          cwd: live,
        }),
        processRow({
          pid: 43,
          user: 'mei',
          command: 'ChatGPT',
          args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
          cwd: live,
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      surface: 'desktop-app',
      repositoryId: 'repo-hataraki',
    })
    expect(sightings.some((item) => item.source === 'claude-code')).toBe(false)
  })

  it('uses a child cwd when Codex Desktop is alive at /', () => {
    const home = track(createTempDir('home-'))
    const registered = '/Users/takamasa/Projects/hataraki'
    const live = '/Users/takamasa/Projects/*開発/hataraki'
    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', registered)],
      listProcesses: () => [
        processRow({
          pid: 41,
          user: 'mei',
          command: 'ChatGPT',
          args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
          cwd: '/',
          childCwds: [live],
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      surface: 'desktop-app',
      kind: 'process',
      repositoryId: 'repo-hataraki',
      cwd: live,
      attributionConfidence: 'correlated',
    })
  })

  it('uses a recent Codex session cwd when Desktop cwd is / and children do not help', () => {
    const home = track(createTempDir('home-'))
    const registered = '/Users/takamasa/Projects/hataraki'
    const live = '/Users/takamasa/Projects/*開発/hataraki'
    writeCodexSession(home, {
      id: 'sess-hataraki',
      cwd: live,
      mtime: NOW - 20_000,
    })
    writeFileSync(
      join(home, '.codex', 'session_index.jsonl'),
      `${JSON.stringify({ id: 'sess-hataraki', thread_name: '働きの直し' })}\n`,
    )

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', registered)],
      listProcesses: () => [
        processRow({
          pid: 51,
          user: 'mei',
          command: 'ChatGPT',
          args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
          cwd: '/',
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      kind: 'process',
      repositoryId: 'repo-hataraki',
      title: '働きの直し',
      attributionConfidence: 'correlated',
    })
  })

  it('binds Desktop at / through a real temp registered folder and a * twin session', () => {
    const home = track(createTempDir('home-'))
    const registered = track(createTempDir('hataraki-'))
    const live = join(dirname(registered), '*開発', basename(registered))
    writeCodexSession(home, {
      id: 'sess-real',
      cwd: live,
      mtime: NOW - 20_000,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', registered)],
      listProcesses: () => [
        processRow({
          pid: 71,
          user: 'mei',
          command: 'ChatGPT',
          args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
          cwd: '/',
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]?.repositoryId).toBe('repo-hataraki')
    expect(sightings[0]?.kind).toBe('process')
  })

  it('does not invent a place when Desktop cwd is / and two registered folders have recent sessions', () => {
    const home = track(createTempDir('home-'))
    const hataraki = '/Users/takamasa/Projects/hataraki'
    const notes = '/Users/takamasa/Projects/notes'
    writeCodexSession(home, {
      id: 'sess-a',
      cwd: hataraki,
      mtime: NOW - 10_000,
    })
    writeCodexSession(home, {
      id: 'sess-b',
      cwd: notes,
      mtime: NOW - 15_000,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [
        root('repo-hataraki', 'ws-hataraki', hataraki),
        root('repo-notes', 'ws-notes', notes),
      ],
      listProcesses: () => [
        processRow({
          pid: 61,
          user: 'mei',
          command: 'ChatGPT',
          args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
          cwd: '/',
        }),
      ],
    })

    const processSightings = sightings.filter((item) => item.kind === 'process')
    expect(processSightings).toHaveLength(0)
  })
})

function root(
  repositoryId: string,
  workspaceId: string,
  absolutePath: string,
): RegisteredLiveRoot {
  return { repositoryId, workspaceId, absolutePath }
}

function processRow(row: LiveProcessRow): LiveProcessRow {
  return row
}

function writeCodexSession(
  home: string,
  input: {
    readonly id: string
    readonly cwd: string
    readonly mtime: number
    readonly dayOffset?: number
  },
) {
  const day = new Date(NOW + (input.dayOffset ?? 0) * 86_400_000)
  const folder = join(
    home,
    '.codex',
    'sessions',
    String(day.getUTCFullYear()),
    String(day.getUTCMonth() + 1).padStart(2, '0'),
    String(day.getUTCDate()).padStart(2, '0'),
  )
  mkdirSync(folder, { recursive: true })
  const file = join(folder, `rollout-${input.id}.jsonl`)
  writeFileSync(
    file,
    `${JSON.stringify({
      type: 'session_meta',
      payload: {
        id: input.id,
        cwd: input.cwd,
        timestamp: new Date(input.mtime).toISOString(),
      },
    })}\n{"type":"event_msg","payload":{"type":"user_message","message":"do not use this"}}\n`,
  )
  touch(file, input.mtime)
}

function touch(path: string, mtime: number) {
  const at = new Date(mtime)
  utimesSync(path, at, at)
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `sikumi-live-${prefix}`))
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
