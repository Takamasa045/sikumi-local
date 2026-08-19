import { execFileSync } from 'node:child_process'
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
import { resetPlaceIdentityCache, sameRepoIdentity } from './identity.js'
import { isBindableCwd, matchRegisteredRoot } from './match.js'
import {
  listCurrentUserLiveProcesses,
  liveProcessDiscoveryMode,
} from './processes.js'
import { encodeClaudeProjectDir, sessionHomeRoots } from './session-files.js'
import { acceptStoredTitle } from './titles.js'
import type { LiveProcessRow, RegisteredLiveRoot } from './types.js'

const NOW = Date.parse('2026-08-19T00:10:00.000Z')
const tempDirectories: string[] = []

afterEach(() => {
  resetPlaceIdentityCache()
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
      identifyLiveAgent({
        command: 'Cursor',
        args: '/Applications/Cursor.app/Contents/MacOS/Cursor',
      }),
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

  it('binds a session file to a Windows-style registered folder from the home sessions dir', () => {
    const home = track(createTempDir('home-'))
    const registered = 'C:\\Users\\mei\\Projects\\blog'
    writeCodexSession(home, {
      id: 'sess-win',
      cwd: 'C:/Users/mei/Projects/blog',
      mtime: NOW - 10_000,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', registered)],
      listProcesses: () => [],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      kind: 'session-file',
      repositoryId: 'repo-blog',
      cwd: 'C:/Users/mei/Projects/blog',
      ingestionMethod: 'session-file',
    })
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

describe('same-repo identity', () => {
  it('treats https and ssh remotes as the same repo and refuses a different package', () => {
    const projects = track(createTempDir('id-'))
    const hataraki = join(projects, 'hataraki')
    const twin = join(projects, '*開発', 'hataraki')
    const other = join(projects, 'work', 'hataraki')
    writeIdentifiedRepo(hataraki, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(twin, {
      packageName: 'hataraki',
      remoteUrl: 'git@github.com:example/hataraki.git',
    })
    writeIdentifiedRepo(other, {
      packageName: 'sikumi-local',
      remoteUrl: 'https://github.com/Takamasa045/sikumi-local.git',
    })
    expect(sameRepoIdentity(hataraki, twin)).toBe(true)
    expect(sameRepoIdentity(hataraki, other)).toBe(false)
    expect(sameRepoIdentity(hataraki, '/Users/missing/hataraki')).toBe(false)
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

  it('does not treat a same-leaf nested folder as the registered place without the same repo', () => {
    const roots = [root('repo', 'ws', '/Users/takamasa/Projects/hataraki')]
    expect(
      matchRegisteredRoot('/Users/takamasa/Projects/*開発/hataraki', roots),
    ).toBeNull()
    expect(
      matchRegisteredRoot('/Users/takamasa/Projects/*開発/hataraki/src', roots),
    ).toBeNull()
    expect(matchRegisteredRoot('/Users/other/hataraki', roots)).toBeNull()
    expect(
      matchRegisteredRoot('/Users/takamasa/Documents/hataraki', roots),
    ).toBeNull()
    expect(isBindableCwd('/')).toBe(false)
    expect(matchRegisteredRoot('/', roots)).toBeNull()
  })

  it('aliases a same-leaf nested twin only when remote or package name match', () => {
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const olderSikumi = join(projects, '*開発', 'hataraki')
    const trueTwin = join(projects, 'work', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(olderSikumi, {
      packageName: 'sikumi-local',
      remoteUrl: 'https://github.com/Takamasa045/sikumi-local.git',
    })
    writeIdentifiedRepo(trueTwin, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    const roots = [root('repo', 'ws', registered)]
    expect(matchRegisteredRoot(olderSikumi, roots)).toBeNull()
    expect(matchRegisteredRoot(join(olderSikumi, 'src'), roots)).toBeNull()
    expect(matchRegisteredRoot(trueTwin, roots)?.repositoryId).toBe('repo')
    expect(
      matchRegisteredRoot(join(trueTwin, 'src'), roots)?.repositoryId,
    ).toBe('repo')
  })

  it('matches Windows drive paths in both slash styles and refuses a sibling', () => {
    const roots = [root('repo', 'ws', 'C:\\Users\\mei\\project')]
    expect(
      matchRegisteredRoot('C:\\Users\\mei\\project', roots)?.repositoryId,
    ).toBe('repo')
    expect(
      matchRegisteredRoot('C:/Users/mei/project/src', roots)?.repositoryId,
    ).toBe('repo')
    expect(
      matchRegisteredRoot('C:\\Users\\mei\\project-other', roots),
    ).toBeNull()
    expect(isBindableCwd('C:\\')).toBe(false)
    expect(isBindableCwd('C:')).toBe(false)
    expect(matchRegisteredRoot('C:\\', roots)).toBeNull()
  })

  it('does not treat a Windows * nested folder as the registered place', () => {
    const roots = [root('repo', 'ws', 'C:\\Users\\mei\\Projects\\hataraki')]
    expect(
      matchRegisteredRoot('C:\\Users\\mei\\Projects\\*開発\\hataraki', roots),
    ).toBeNull()
    expect(matchRegisteredRoot('C:/Users/other/hataraki', roots)).toBeNull()
  })
})

describe('session home roots', () => {
  it('joins Codex, Claude, and Cursor folders under a Windows home', () => {
    expect(sessionHomeRoots('C:\\Users\\mei')).toEqual({
      codexSessions: 'C:\\Users\\mei\\.codex\\sessions',
      claudeProjects: 'C:\\Users\\mei\\.claude\\projects',
      cursorChats: 'C:\\Users\\mei\\.cursor\\chats',
      grokSessions: 'C:\\Users\\mei\\.grok\\sessions',
    })
    expect(sessionHomeRoots('C:/Users/mei').codexSessions).toBe(
      'C:\\Users\\mei\\.codex\\sessions',
    )
  })

  it('still joins POSIX homes with path.join semantics', () => {
    expect(sessionHomeRoots('/Users/mei').codexSessions).toBe(
      '/Users/mei/.codex/sessions',
    )
  })
})

describe('Windows process discovery', () => {
  it('does not scan Unix process tables on Windows', () => {
    expect(liveProcessDiscoveryMode('win32')).toBe('session-files-only')
    expect(liveProcessDiscoveryMode('darwin')).toBe('process-scan')
    expect(
      listCurrentUserLiveProcesses({
        platform: 'win32',
        currentUser: 'mei',
        hasProcFs: true,
      }),
    ).toEqual([])
  })
})

describe('desktop and alias discovery', () => {
  it('does not bind a Codex process in an older same-leaf checkout of another repo', () => {
    const home = track(createTempDir('home-'))
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const olderSikumi = join(projects, '*開発', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(olderSikumi, {
      packageName: 'sikumi-local',
      remoteUrl: 'https://github.com/Takamasa045/sikumi-local.git',
    })
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
          cwd: olderSikumi,
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

    expect(sightings).toHaveLength(0)
  })

  it('binds a Codex process in a same-leaf twin that is the same repo', () => {
    const home = track(createTempDir('home-'))
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const live = join(projects, '*開発', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(live, {
      packageName: 'hataraki',
      remoteUrl: 'git@github.com:example/hataraki.git',
    })
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

  it('ignores leftover fixture processes and does not treat an older same-leaf checkout as hataraki', () => {
    const home = track(createTempDir('home-'))
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const live = join(projects, '*開発', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(live, {
      packageName: 'sikumi-local',
      remoteUrl: 'https://github.com/Takamasa045/sikumi-local.git',
    })
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

    expect(sightings).toHaveLength(0)
    expect(sightings.some((item) => item.source === 'claude-code')).toBe(false)
  })

  it('uses a same-repo child cwd when Codex Desktop is alive at /', () => {
    const home = track(createTempDir('home-'))
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const live = join(projects, '*開発', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(live, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
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

  it('does not bind Desktop at / through an older same-leaf checkout of another repo', () => {
    const home = track(createTempDir('home-'))
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const live = join(projects, '*開発', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(live, {
      packageName: 'sikumi-local',
      remoteUrl: 'https://github.com/Takamasa045/sikumi-local.git',
    })
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

    expect(sightings).toHaveLength(0)
  })

  it('binds Desktop at / through a same-repo * twin session', () => {
    const home = track(createTempDir('home-'))
    const projects = track(createTempDir('projects-'))
    const registered = join(projects, 'hataraki')
    const live = join(projects, '*開発', 'hataraki')
    writeIdentifiedRepo(registered, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
    writeIdentifiedRepo(live, {
      packageName: 'hataraki',
      remoteUrl: 'https://github.com/example/hataraki.git',
    })
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

  it('does not invent a place when Desktop children sit in several registered folders', () => {
    const home = track(createTempDir('home-'))
    const hataraki = track(createTempDir('hataraki-'))
    const blog = track(createTempDir('blog-'))
    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [
        root('repo-hataraki', 'ws-hataraki', hataraki),
        root('repo-blog', 'ws-blog', blog),
      ],
      listProcesses: () => [
        processRow({
          pid: 81,
          user: 'mei',
          command: 'codex',
          args: 'codex',
          cwd: '/',
          childCwds: [hataraki, blog],
        }),
      ],
    })

    expect(sightings).toHaveLength(0)
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

function writeIdentifiedRepo(
  directory: string,
  identity: {
    readonly packageName: string
    readonly remoteUrl: string
  },
): string {
  mkdirSync(directory, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory })
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: identity.packageName }, null, 2)}\n`,
  )
  execFileSync('git', ['remote', 'add', 'origin', identity.remoteUrl], {
    cwd: directory,
  })
  return directory
}
