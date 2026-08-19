import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { userInfo } from 'node:os'
import { resolveCommandOnPath } from '@sikumi-local/process-runtime'
import { identifyLiveAgent } from './identify.js'
import { isBindableCwd } from './match.js'
import { parseElapsedToMs } from './sitting.js'
import type { LiveProcessRow } from './types.js'

const PROCESS_TIMEOUT_MS = 3_000
const PROCESS_MAX_BUFFER = 256 * 1024
const MAX_CANDIDATE_PIDS = 80

export function listCurrentUserLiveProcesses(input?: {
  readonly currentUser?: string
  readonly listRaw?: () => readonly LiveProcessRow[]
  readonly platform?: NodeJS.Platform
  readonly hasProcFs?: boolean
}): LiveProcessRow[] {
  const currentUser = input?.currentUser ?? userInfo().username
  const rows =
    input?.listRaw?.() ??
    readOsProcesses(currentUser, {
      platform: input?.platform ?? process.platform,
      hasProcFs: input?.hasProcFs ?? existsSync('/proc'),
    })
  return rows.filter((row) => {
    if (row.user !== currentUser) {
      return false
    }
    return identifyLiveAgent(row) !== null
  })
}

export function liveProcessDiscoveryMode(
  platform: NodeJS.Platform = process.platform,
): 'process-scan' | 'session-files-only' {
  return platform === 'win32' ? 'session-files-only' : 'process-scan'
}

function readOsProcesses(
  currentUser: string,
  input: {
    readonly platform: NodeJS.Platform
    readonly hasProcFs: boolean
  },
): LiveProcessRow[] {
  if (input.platform === 'win32') {
    return []
  }
  if (input.hasProcFs) {
    return readLinuxProcesses(currentUser)
  }
  if (input.platform === 'darwin') {
    return readDarwinProcesses(currentUser)
  }
  return []
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

  const activity = readLinuxProcessActivity(identified.map((row) => row.pid))
  const childCountByParent = countLinuxChildren(listed, identified)
  return identified.map((row) => ({
    ...row,
    childCwds: childCwdsByParent.get(row.pid) ?? [],
    childCount: childCountByParent.get(row.pid) ?? 0,
    ...(activity.get(row.pid) ?? {}),
  }))
}

function readLinuxProcessActivity(pids: readonly number[]): Map<
  number,
  {
    readonly state: string | null
    readonly cpuPercent: number | null
    readonly startedAtMs: number | null
  }
> {
  const found = new Map<
    number,
    {
      readonly state: string | null
      readonly cpuPercent: number | null
      readonly startedAtMs: number | null
    }
  >()
  const bootMs = readLinuxBootMs()
  const hertz = 100
  for (const pid of pids) {
    const parsed = parseLinuxStat(readProcFile(`/proc/${pid}/stat`))
    if (!parsed) {
      continue
    }
    const elapsedTicks = parsed.elapsedTicks
    const cpuPercent =
      elapsedTicks > 0
        ? ((parsed.utime + parsed.stime) / elapsedTicks) * 100
        : 0
    found.set(pid, {
      state: parsed.state,
      cpuPercent,
      startedAtMs:
        bootMs == null ? null : bootMs + (parsed.starttime / hertz) * 1000,
    })
  }
  return found
}

function parseLinuxStat(stat: string | null): {
  readonly state: string
  readonly utime: number
  readonly stime: number
  readonly starttime: number
  readonly elapsedTicks: number
} | null {
  if (!stat) {
    return null
  }
  const close = stat.lastIndexOf(')')
  if (close < 0) {
    return null
  }
  const rest = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/)
  const state = rest[0] ?? ''
  const utime = Number(rest[11] ?? 0)
  const stime = Number(rest[12] ?? 0)
  const starttime = Number(rest[19] ?? 0)
  if (!state) {
    return null
  }
  const uptimeTicks = readLinuxUptimeTicks()
  return {
    state,
    utime,
    stime,
    starttime,
    elapsedTicks:
      uptimeTicks == null ? 0 : Math.max(0, uptimeTicks - starttime),
  }
}

function readLinuxBootMs(): number | null {
  const stat = readProcFile('/proc/stat')
  const match = stat?.match(/^btime\s+(\d+)/m)
  if (!match) {
    return null
  }
  return Number(match[1]) * 1000
}

function readLinuxUptimeTicks(): number | null {
  const uptime = readProcFile('/proc/uptime')
  if (!uptime) {
    return null
  }
  const seconds = Number(uptime.split(/\s+/)[0] ?? '')
  return Number.isFinite(seconds) ? seconds * 100 : null
}

function countLinuxChildren(
  listed: readonly string[],
  parents: readonly { readonly pid: number }[],
): Map<number, number> {
  const parentPids = new Set(parents.map((item) => item.pid))
  const counts = new Map<number, number>()
  for (const pid of parentPids) {
    counts.set(pid, 0)
  }
  for (const entry of listed) {
    if (!/^\d+$/.test(entry)) {
      continue
    }
    const status = readProcFile(`/proc/${entry}/status`)
    const ppid = status ? readLinuxPpid(status) : null
    if (ppid == null || !parentPids.has(ppid)) {
      continue
    }
    counts.set(ppid, (counts.get(ppid) ?? 0) + 1)
  }
  return counts
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
  const allChildPids = childPidsOf(identified, userRows)
  const activity = readDarwinProcessActivity(identified.map((item) => item.pid))
  return identified.map((item) => ({
    ...item,
    cwd: cwdByPid.get(item.pid) ?? null,
    childCwds: childPids
      .filter((pid) => parentPid(userRows, pid) === item.pid)
      .map((pid) => childCwdByPid.get(pid))
      .filter((cwd): cwd is string => isBindableCwd(cwd)),
    childCount: allChildPids.filter(
      (pid) => parentPid(userRows, pid) === item.pid,
    ).length,
    ...(activity.get(item.pid) ?? {}),
  }))
}

function readDarwinProcessActivity(pids: readonly number[]): Map<
  number,
  {
    readonly state: string | null
    readonly cpuPercent: number | null
    readonly startedAtMs: number | null
  }
> {
  const found = new Map<
    number,
    {
      readonly state: string | null
      readonly cpuPercent: number | null
      readonly startedAtMs: number | null
    }
  >()
  if (pids.length === 0) {
    return found
  }
  const ps = resolveCommandOnPath('ps')
  if (!ps) {
    return found
  }
  let stdout: string
  try {
    stdout = execFileSync(
      ps,
      ['-o', 'pid=,stat=,pcpu=,etime=', '-p', pids.join(',')],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: PROCESS_TIMEOUT_MS,
        maxBuffer: PROCESS_MAX_BUFFER,
        windowsHide: true,
      },
    )
  } catch {
    return found
  }
  const now = Date.now()
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)$/)
    if (!match) {
      continue
    }
    const elapsedMs = parseElapsedToMs(match[4])
    const cpu = Number(match[3])
    found.set(Number(match[1]), {
      state: match[2] ?? null,
      cpuPercent: Number.isFinite(cpu) ? cpu : null,
      startedAtMs: elapsedMs == null ? null : now - elapsedMs,
    })
  }
  return found
}

function parsePsLine(
  line: string,
): Omit<LiveProcessRow, 'cwd' | 'childCwds'> | null {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/)
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
