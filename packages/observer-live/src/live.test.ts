import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OBSERVER_LIVE_MAX_FILE_BYTES,
  OBSERVER_LIVE_SESSION_MAX_AGE_MS,
} from '@sikumi-local/observer-core'
import { discoverLiveSessions } from './discover.js'
import { identifyLiveAgent } from './identify.js'
import {
  isLiveProcessExternalSessionId,
  liveProcessExternalSessionId,
} from './locate.js'
import { resetPlaceIdentityCache, sameRepoIdentity } from './identity.js'
import { isBindableCwd, matchRegisteredRoot } from './match.js'
import {
  listCurrentUserLiveProcesses,
  liveProcessDiscoveryMode,
} from './processes.js'
import { encodeClaudeProjectDir, sessionHomeRoots } from './session-files.js'
import { acceptGoalText, acceptStoredTitle } from './titles.js'
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
    expect(
      acceptGoalText(`${'あ'.repeat(40)}。${'い'.repeat(40)}。続きは出さない`),
    ).toBe(`${'あ'.repeat(40)}`)
    expect(acceptGoalText('あ'.repeat(120))).toBe('あ'.repeat(80))
    expect(acceptGoalText('作業中')).toBeNull()
    expect(acceptGoalText('Codexの作業が始まりました')).toBeNull()
    expect(acceptGoalText('Claude Codeがファイルを扱っています')).toBeNull()
  })
})

describe('live process session ids', () => {
  it('keys a living process by pid, not by place alone', () => {
    expect(liveProcessExternalSessionId('grok-build', 'repo-tsugite', 248)).toBe(
      'live:grok-build:repo-tsugite:pid:248',
    )
    expect(liveProcessExternalSessionId('grok-build', 'repo-tsugite', 26794)).toBe(
      'live:grok-build:repo-tsugite:pid:26794',
    )
    expect(
      isLiveProcessExternalSessionId('live:grok-build:repo-tsugite:pid:248'),
    ).toBe(true)
    expect(isLiveProcessExternalSessionId('live:grok-build:repo-tsugite')).toBe(
      false,
    )
    expect(isLiveProcessExternalSessionId('live:grok-build:sess-old')).toBe(
      false,
    )
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

  it('uses a complete first user request when no thread name is stored', () => {
    const home = track(createTempDir('home-'))
    const blog = track(createTempDir('blog-'))
    writeCodexSession(home, {
      id: 'sess-request',
      cwd: blog,
      mtime: NOW - 20_000,
      userMessage: 'ログイン画面の直しと確認の仕組みを見て',
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', blog)],
      listProcesses: () => [],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]?.title).toBe('ログイン画面の直しと確認の仕組みを見て')
    expect(JSON.stringify(sightings)).not.toContain('base_instructions')
  })

  it('clips a long first request and ignores a truncated one', () => {
    const home = track(createTempDir('home-'))
    const blog = track(createTempDir('blog-'))
    writeCodexSession(home, {
      id: 'sess-long',
      cwd: blog,
      mtime: NOW - 15_000,
      userMessage: `${'あ'.repeat(40)}。${'い'.repeat(40)}。続きは出さない`,
    })
    writeCodexSession(home, {
      id: 'sess-cut',
      cwd: blog,
      mtime: NOW - 40_000,
      dayOffset: -1,
      truncatedUserMessage: true,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-blog', 'ws-blog', blog)],
      listProcesses: () => [],
    })

    const titled = sightings.find((item) => item.title)
    expect(titled?.title).toBe(`${'あ'.repeat(40)}`)
    expect(titled?.title?.length).toBeLessThanOrEqual(80)
    expect(JSON.stringify(sightings)).not.toContain('do not invent this')
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

  it('binds grok --cwd and Codex --cd even when the process cwd is elsewhere', () => {
    const home = track(createTempDir('home-'))
    const hataraki = track(createTempDir('hataraki-'))
    const tsugite = track(createTempDir('tsugite-'))
    const launch = track(createTempDir('launch-'))
    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [
        root('repo-hataraki', 'ws-hataraki', hataraki),
        root('repo-tsugite', 'ws-tsugite', tsugite),
      ],
      listProcesses: () => [
        processRow({
          pid: 51,
          user: 'mei',
          command: 'grok',
          args: `grok --cwd ${hataraki}`,
          cwd: launch,
        }),
        processRow({
          pid: 52,
          user: 'mei',
          command: 'grok',
          args: 'grok',
          cwd: tsugite,
        }),
        processRow({
          pid: 53,
          user: 'mei',
          command: 'codex',
          args: `codex --cd ${hataraki}`,
          cwd: launch,
        }),
        processRow({
          pid: 54,
          user: 'mei',
          command: 'claude',
          args: `claude --cwd ${tsugite}`,
          cwd: launch,
        }),
      ],
    })

    const grokHataraki = sightings.find(
      (item) =>
        item.source === 'grok-build' && item.repositoryId === 'repo-hataraki',
    )
    const grokTsugite = sightings.find(
      (item) =>
        item.source === 'grok-build' && item.repositoryId === 'repo-tsugite',
    )
    const codexHataraki = sightings.find(
      (item) =>
        item.source === 'codex' && item.repositoryId === 'repo-hataraki',
    )
    const claudeTsugite = sightings.find(
      (item) =>
        item.source === 'claude-code' && item.repositoryId === 'repo-tsugite',
    )
    expect(grokHataraki).toMatchObject({
      kind: 'process',
      cwd: hataraki,
      ingestionMethod: 'process-scan',
    })
    expect(grokTsugite).toMatchObject({
      kind: 'process',
      cwd: tsugite,
    })
    expect(codexHataraki).toMatchObject({
      kind: 'process',
      cwd: hataraki,
    })
    expect(claudeTsugite).toMatchObject({
      kind: 'process',
      cwd: tsugite,
    })
  })

  it('keeps two live grok processes at the same registered folder as two sightings', () => {
    const home = track(createTempDir('home-'))
    const tsugite = track(createTempDir('tsugite-'))
    writeGrokSession(home, {
      id: 'sess-tsugite',
      cwd: tsugite,
      mtime: NOW - 8_000,
      title: '作業中',
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-tsugite', 'ws-tsugite', tsugite)],
      listProcesses: () => [
        processRow({
          pid: 248,
          user: 'mei',
          command: 'grok',
          args: 'grok',
          cwd: tsugite,
        }),
        processRow({
          pid: 26794,
          user: 'mei',
          command: 'grok',
          args: 'grok',
          cwd: tsugite,
        }),
        processRow({
          pid: 99,
          user: 'mei',
          command: 'fake-claude',
          args: 'fake-claude',
          cwd: tsugite,
        }),
      ],
    })

    const groks = sightings.filter((item) => item.source === 'grok-build')
    expect(groks).toHaveLength(2)
    expect(groks.map((item) => item.pid).sort((left, right) => left! - right!)).toEqual([
      248,
      26794,
    ])
    expect(new Set(groks.map((item) => item.externalSessionId)).size).toBe(2)
    expect(groks.every((item) => item.kind === 'process')).toBe(true)
    expect(sightings.some((item) => item.source === 'claude-code')).toBe(false)
    expect(JSON.stringify(sightings)).not.toContain('fake-claude')
  })

  it('prefers a readable session title over a generic live 作業中 title', () => {
    const home = track(createTempDir('home-'))
    const hataraki = track(createTempDir('hataraki-'))
    writeGrokSession(home, {
      id: 'sess-hataraki',
      cwd: hataraki,
      mtime: NOW - 8_000,
      title: '働きの画面を直している',
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', hataraki)],
      listProcesses: () => [
        processRow({
          pid: 61,
          user: 'mei',
          command: 'grok',
          args: `grok --cwd ${hataraki}`,
          cwd: home,
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      kind: 'process',
      title: '働きの画面を直している',
    })
  })
})

function writeGrokSession(
  home: string,
  input: {
    readonly id: string
    readonly cwd: string
    readonly mtime: number
    readonly title?: string
  },
): string {
  const folder = join(home, '.grok', 'sessions')
  mkdirSync(folder, { recursive: true })
  const file = join(folder, `${input.id}.jsonl`)
  writeFileSync(
    file,
    `${JSON.stringify({
      id: input.id,
      cwd: input.cwd,
      title: input.title ?? '作業中',
    })}\n`,
  )
  touch(file, input.mtime)
  return file
}

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

  it('discovers a Codex Desktop session when the first jsonl line exceeds the bounded read', () => {
    const home = track(createTempDir('home-'))
    const hataraki = '/Users/takamasa/Projects/hataraki'
    const file = writeCodexSession(home, {
      id: '01a01863-16b8-7972-b137-89bc593e6a40',
      cwd: hataraki,
      mtime: NOW - 20_000,
      originator: 'Codex Desktop',
      clientSource: 'vscode',
      firstLineBytes: 48_000,
    })
    expect(firstJsonlLineLength(file)).toBeGreaterThan(
      OBSERVER_LIVE_MAX_FILE_BYTES,
    )

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', hataraki)],
      listProcesses: () => [],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      surface: 'desktop-app',
      kind: 'session-file',
      cwd: hataraki,
      repositoryId: 'repo-hataraki',
      ingestionMethod: 'session-file',
    })
  })

  it('recovers a thread name from the same 16KB prefix as cwd', () => {
    const home = track(createTempDir('home-'))
    const hataraki = '/Users/takamasa/Projects/hataraki'
    const file = writeCodexSession(home, {
      id: '01a01863-16b8-7972-b137-89bc593e6a41',
      cwd: hataraki,
      mtime: NOW - 20_000,
      originator: 'Codex Desktop',
      clientSource: 'vscode',
      firstLineBytes: 48_000,
      threadName: '確認の仕組みを直している',
    })
    expect(firstJsonlLineLength(file)).toBeGreaterThan(
      OBSERVER_LIVE_MAX_FILE_BYTES,
    )

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', hataraki)],
      listProcesses: () => [],
    })

    expect(sightings[0]?.title).toBe('確認の仕組みを直している')
  })

  it('binds Desktop at / through a huge session file when child cwds are not unique', () => {
    const home = track(createTempDir('home-'))
    const hataraki = '/Users/takamasa/Projects/hataraki'
    writeCodexSession(home, {
      id: '01a01863-16b8-7972-b137-89bc593e6a40',
      cwd: hataraki,
      mtime: NOW - 20_000,
      originator: 'Codex Desktop',
      clientSource: 'vscode',
      firstLineBytes: 48_000,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', hataraki)],
      listProcesses: () => [
        processRow({
          pid: 91,
          user: 'mei',
          command: 'ChatGPT',
          args: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
          cwd: '/',
          childCwds: ['/', '/tmp', '/Users/takamasa'],
        }),
      ],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      surface: 'desktop-app',
      kind: 'process',
      cwd: hataraki,
      repositoryId: 'repo-hataraki',
      ingestionMethod: 'process-scan',
    })
  })

  it('still counts a vscode Codex session file when originator is not Desktop', () => {
    const home = track(createTempDir('home-'))
    const hataraki = '/Users/takamasa/Projects/hataraki'
    writeCodexSession(home, {
      id: 'sess-vscode',
      cwd: hataraki,
      mtime: NOW - 12_000,
      clientSource: 'vscode',
      firstLineBytes: 48_000,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', hataraki)],
      listProcesses: () => [],
    })

    expect(sightings).toHaveLength(1)
    expect(sightings[0]).toMatchObject({
      source: 'codex',
      surface: 'ide',
      kind: 'session-file',
      cwd: hataraki,
      repositoryId: 'repo-hataraki',
    })
  })

  it('does not invent a cwd from a truncated session file that has no cwd field', () => {
    const home = track(createTempDir('home-'))
    const hataraki = '/Users/takamasa/Projects/hataraki'
    writeCodexSession(home, {
      id: 'sess-trunc',
      cwd: hataraki,
      mtime: NOW - 10_000,
      originator: 'Codex Desktop',
      clientSource: 'vscode',
      truncatedWithoutCwd: true,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', hataraki)],
      listProcesses: () => [],
    })

    expect(sightings).toHaveLength(0)
  })

  it('does not bind a huge Codex session in an older same-leaf checkout of another repo', () => {
    const home = track(createTempDir('home-'))
    const registered = '/Users/takamasa/Projects/hataraki'
    const olderSikumi = '/Users/takamasa/Projects/*開発/hataraki'
    writeCodexSession(home, {
      id: 'sess-old-leaf',
      cwd: olderSikumi,
      mtime: NOW - 15_000,
      originator: 'Codex Desktop',
      clientSource: 'vscode',
      firstLineBytes: 48_000,
    })

    const sightings = discoverLiveSessions({
      homeDir: home,
      currentUser: 'mei',
      now: NOW,
      roots: [root('repo-hataraki', 'ws-hataraki', registered)],
      listProcesses: () => [],
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
    readonly originator?: string
    readonly clientSource?: string
    readonly firstLineBytes?: number
    readonly truncatedWithoutCwd?: boolean
    readonly userMessage?: string
    readonly truncatedUserMessage?: boolean
    readonly threadName?: string
  },
): string {
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
  if (input.truncatedWithoutCwd) {
    writeFileSync(
      file,
      `{"type":"session_meta","payload":{"id":"${input.id}","originator":"${input.originator ?? 'Codex Desktop'}","source":"${input.clientSource ?? 'vscode'}","base_instructions":"${'X'.repeat(20_000)}`,
    )
    touch(file, input.mtime)
    return file
  }
  const followUp = input.truncatedUserMessage
    ? '{"type":"event_msg","payload":{"type":"user_message","message":"do not invent this'
    : input.userMessage
      ? `${JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: input.userMessage },
        })}\n`
      : ''
  writeFileSync(
    file,
    `${JSON.stringify({
      type: 'session_meta',
      payload: {
        id: input.id,
        cwd: input.cwd,
        timestamp: new Date(input.mtime).toISOString(),
        ...(input.originator ? { originator: input.originator } : {}),
        ...(input.clientSource ? { source: input.clientSource } : {}),
        ...(input.threadName ? { thread_name: input.threadName } : {}),
        ...(input.firstLineBytes
          ? { base_instructions: 'X'.repeat(input.firstLineBytes) }
          : {}),
      },
    })}\n${followUp}`,
  )
  touch(file, input.mtime)
  return file
}

function firstJsonlLineLength(path: string): number {
  return readFileSync(path, 'utf8').split(/\r?\n/, 1)[0]?.length ?? 0
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
