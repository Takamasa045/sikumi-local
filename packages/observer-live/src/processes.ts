import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { userInfo } from 'node:os'
import { resolveCommandOnPath } from '@sikumi-local/process-runtime'
import { identifyLiveAgent } from './identify.js'
import { isBindableCwd } from './match.js'
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
  let listed: string[]
  try {
    listed = readdirSync('/proc')
  } catch {
    return []
  }
  const identified: LiveProcessRow[] = []
  for (const entry of listed) {
    if (!/^\d+$/.test(entry)) {
      continue
    }
    const pid = Number(entry)
    const status = readProcFile(`/proc/${pid}/status`)
    if (!status || !status.includes(`Uid:\t${uid}`)) {
      continue
    }
    const cmdline = readProcFile(`/proc/${pid}/cmdline`)
    if (!cmdline) {
      continue
    }
    const args = cmdline.replaceAll('\0', ' ').trim()
    const command = args.split(/\s+/)[0] ?? args
    if (!identifyLiveAgent({ command, args })) {
      continue
    }
    identified.push({
      pid,
      user: currentUser,
      command,
      args,
      cwd: readLinuxCwd(pid),
      ppid: readLinuxPpid(status),
    })
    if (identified.length >= MAX_CANDIDATE_PIDS) {
      break
    }
  }

  const childCwdsByParent = new Map<number, string[]>()
  const needsChildren = identified.filter((row) => !isBindableCwd(row.cwd))
  if (needsChildren.length > 0) {
    const parentPids = new Set(needsChildren.map((row) => row.pid))
    for (const entry of listed) {
      if (!/^\d+$/.test(entry)) {
        continue
      }
      const pid = Number(entry)
      if (identified.some((item) => item.pid === pid)) {
        continue
      }
      const status = readProcFile(`/proc/${pid}/status`)
      const ppid = status ? readLinuxPpid(status) : null
      if (ppid == null || !parentPids.has(ppid)) {
        continue
      }
      const cwd = readLinuxCwd(pid)
      if (!cwd || !isBindableCwd(cwd)) {
        continue
      }
      const current = childCwdsByParent.get(ppid) ?? []
      current.push(cwd)
      childCwdsByParent.set(ppid, current)
    }
  }

  return identified.map((row) => ({
    ...row,
    childCwds: childCwdsByParent.get(row.pid) ?? [],
  }))
}

function readDarwinProcesses(currentUser: string): LiveProcessRow[] {
  const ps = resolveCommandOnPath('ps')
  if (!ps) {
    return []
  }
  let stdout: string
  try {
    stdout = execFileSync(ps, ['-axo', 'pid=,ppid=,user=,comm=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
      windowsHide: true,
    })
  } catch {
    return []
  }

  const userRows: Omit<LiveProcessRow, 'cwd' | 'childCwds'>[] = []
  const identified: Omit<LiveProcessRow, 'cwd' | 'childCwds'>[] = []
  for (const line of stdout.split('\n')) {
    const parsed = parsePsLine(line)
    if (!parsed || parsed.user !== currentUser) {
      continue
    }
    userRows.push(parsed)
    if (!identifyLiveAgent(parsed)) {
      continue
    }
    identified.push(parsed)
    if (identified.length >= MAX_CANDIDATE_PIDS) {
      break
    }
  }
  const cwdByPid = readDarwinCwds(identified.map((item) => item.pid))
  const needsChildren = identified.filter(
    (item) => !isBindableCwd(cwdByPid.get(item.pid) ?? null),
  )
  const childPids = childPidsOf(needsChildren, userRows)
  const childCwdByPid = readDarwinCwds(childPids)
  return identified.map((item) => ({
    ...item,
    cwd: cwdByPid.get(item.pid) ?? null,
    childCwds: childPids
      .filter((pid) => parentPid(userRows, pid) === item.pid)
      .map((pid) => childCwdByPid.get(pid))
      .filter((cwd): cwd is string => isBindableCwd(cwd)),
  }))
}

function parsePsLine(
  line: string,
): Omit<LiveProcessRow, 'cwd' | 'childCwds'> | null {
  const match = line
    .trim()
    .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/)
  if (!match) {
    return null
  }
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    user: match[3] ?? '',
    command: match[4] ?? '',
    args: (match[5] ?? '').trim(),
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

function childPidsOf(
  parents: readonly { readonly pid: number }[],
  rows: readonly { readonly pid: number; readonly ppid?: number | null }[],
): number[] {
  const parentPids = new Set(parents.map((item) => item.pid))
  return rows
    .filter((row) => row.ppid != null && parentPids.has(row.ppid))
    .map((row) => row.pid)
}

function parentPid(
  rows: readonly { readonly pid: number; readonly ppid?: number | null }[],
  pid: number,
): number | null {
  return rows.find((row) => row.pid === pid)?.ppid ?? null
}

function readLinuxPpid(status: string): number | null {
  const match = status.match(/^PPid:\s+(\d+)/m)
  if (!match) {
    return null
  }
  return Number(match[1])
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
