import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { userInfo } from 'node:os'
import { resolveCommandOnPath } from '@sikumi-local/process-runtime'
import { identifyLiveAgent } from './identify.js'
import type { LiveProcessRow } from './types.js'

const PROCESS_TIMEOUT_MS = 3_000
const PROCESS_MAX_BUFFER = 256 * 1024
const MAX_CANDIDATE_PIDS = 80

export function listCurrentUserLiveProcesses(input?: {
  readonly currentUser?: string
  readonly listRaw?: () => readonly LiveProcessRow[]
}): LiveProcessRow[] {
  const currentUser = input?.currentUser ?? userInfo().username
  const rows = input?.listRaw?.() ?? readOsProcesses(currentUser)
  return rows.filter((row) => {
    if (row.user !== currentUser) {
      return false
    }
    return identifyLiveAgent(row) !== null
  })
}

function readOsProcesses(currentUser: string): LiveProcessRow[] {
  if (existsSync('/proc')) {
    return readLinuxProcesses(currentUser)
  }
  return readDarwinProcesses(currentUser)
}

function readLinuxProcesses(currentUser: string): LiveProcessRow[] {
  const uid = String(userInfo().uid)
  const rows: LiveProcessRow[] = []
  let listed: string[]
  try {
    listed = readdirSync('/proc')
  } catch {
    return []
  }
  for (const entry of listed) {
    if (!/^\d+$/.test(entry)) {
      continue
    }
    const pid = Number(entry)
    const cmdline = readProcFile(`/proc/${pid}/cmdline`)
    if (!cmdline) {
      continue
    }
    const args = cmdline.replaceAll('\0', ' ').trim()
    const command = args.split(/\s+/)[0] ?? args
    if (!identifyLiveAgent({ command, args })) {
      continue
    }
    const status = readProcFile(`/proc/${pid}/status`)
    if (!status || !status.includes(`Uid:\t${uid}`)) {
      continue
    }
    rows.push({
      pid,
      user: currentUser,
      command,
      args,
      cwd: readLinuxCwd(pid),
    })
    if (rows.length >= MAX_CANDIDATE_PIDS) {
      break
    }
  }
  return rows
}

function readDarwinProcesses(currentUser: string): LiveProcessRow[] {
  const ps = resolveCommandOnPath('ps')
  if (!ps) {
    return []
  }
  let stdout: string
  try {
    stdout = execFileSync(ps, ['-axo', 'pid=,user=,comm=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
      windowsHide: true,
    })
  } catch {
    return []
  }

  const candidates: Omit<LiveProcessRow, 'cwd'>[] = []
  for (const line of stdout.split('\n')) {
    const parsed = parsePsLine(line)
    if (!parsed || parsed.user !== currentUser) {
      continue
    }
    if (!identifyLiveAgent(parsed)) {
      continue
    }
    candidates.push(parsed)
    if (candidates.length >= MAX_CANDIDATE_PIDS) {
      break
    }
  }
  const cwdByPid = readDarwinCwds(candidates.map((item) => item.pid))
  return candidates.map((item) => ({
    ...item,
    cwd: cwdByPid.get(item.pid) ?? null,
  }))
}

function parsePsLine(
  line: string,
): Omit<LiveProcessRow, 'cwd'> | null {
  const match = line
    .trim()
    .match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/)
  if (!match) {
    return null
  }
  return {
    pid: Number(match[1]),
    user: match[2] ?? '',
    command: match[3] ?? '',
    args: (match[4] ?? '').trim(),
  }
}

function readDarwinCwds(pids: readonly number[]): Map<number, string> {
  const found = new Map<number, string>()
  if (pids.length === 0) {
    return found
  }
  const lsof = resolveCommandOnPath('lsof')
  if (!lsof) {
    return found
  }
  try {
    const stdout = execFileSync(
      lsof,
      ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fn'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: PROCESS_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER,
        windowsHide: true,
      },
    )
    let currentPid: number | null = null
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        currentPid = Number(line.slice(1))
        continue
      }
      if (line.startsWith('n') && currentPid !== null) {
        found.set(currentPid, line.slice(1))
      }
    }
  } catch {
    return found
  }
  return found
}

function readLinuxCwd(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

function readProcFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}
