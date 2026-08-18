import { AppError, type PermissionProfileId } from '@sikumi-local/core'

export type CodexSandboxMode = 'read-only' | 'workspace-write'

export interface CodexSandboxMapping {
  readonly threadSandbox: CodexSandboxMode
  readonly execSandbox: CodexSandboxMode
  readonly enableSearch: boolean
  readonly sandboxPolicy: Record<string, unknown>
}

export function mapCodexSandbox(
  profile: PermissionProfileId,
): CodexSandboxMapping {
  if (profile === 'unrestricted' || profile === 'publish') {
    throw new AppError(
      'VALIDATION_FAILED',
      'この権限プロファイルは標準では使えません',
      400,
    )
  }

  if (profile === 'edit-worktree' || profile === 'test-worktree') {
    return {
      threadSandbox: 'workspace-write',
      execSandbox: 'workspace-write',
      enableSearch: false,
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
    }
  }

  const network = profile === 'research'
  return {
    threadSandbox: 'read-only',
    execSandbox: 'read-only',
    enableSearch: network,
    sandboxPolicy: { type: 'readOnly', networkAccess: network },
  }
}

export function classifyCommandRisk(
  command: string | undefined,
): 'low' | 'medium' | 'high' | 'critical' {
  const value = (command ?? '').toLowerCase()
  if (
    /git\s+push|rm\s+-rf|sudo\b|chmod\s+-r|chown\b|npm\s+publish|pnpm\s+publish|docker\s+system\s+prune/.test(
      value,
    )
  ) {
    return 'critical'
  }
  if (/\b(rm|mv|chmod|chown|npm i|pnpm add|yarn add)\b/.test(value)) {
    return 'high'
  }
  if (/\b(curl|wget|http|fetch|ssh)\b/.test(value)) {
    return 'medium'
  }
  return 'low'
}
