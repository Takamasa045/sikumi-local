import { AppError, type PermissionProfileId } from '@sikumi-local/core'

export const GROK_DENY_RULES = [
  'git push',
  'git push --force',
  'rm -rf',
  'sudo',
  'chmod -R',
  'chown',
  'npm publish',
  'pnpm publish',
  'docker system prune',
] as const

export interface GrokSandboxMapping {
  readonly sandbox: 'read-only' | 'workspace' | 'strict'
  readonly permissionMode?: 'plan' | 'dontAsk' | 'acceptEdits'
  readonly disableWebSearch: boolean
}

export function mapGrokSandbox(
  profile: PermissionProfileId,
): GrokSandboxMapping {
  if (profile === 'unrestricted' || profile === 'publish') {
    throw new AppError(
      'VALIDATION_FAILED',
      'この権限プロファイルは標準では使えません',
      400,
    )
  }
  if (profile === 'edit-worktree') {
    return {
      sandbox: 'workspace',
      permissionMode: 'acceptEdits',
      disableWebSearch: false,
    }
  }
  if (profile === 'test-worktree') {
    return {
      sandbox: 'workspace',
      permissionMode: 'acceptEdits',
      disableWebSearch: true,
    }
  }
  if (profile === 'plan') {
    return {
      sandbox: 'read-only',
      permissionMode: 'plan',
      disableWebSearch: true,
    }
  }
  return {
    sandbox: 'read-only',
    ...(profile === 'observe' ? { permissionMode: 'dontAsk' as const } : {}),
    disableWebSearch: profile === 'observe',
  }
}

export function grokCommonArgs(
  mapping: GrokSandboxMapping,
  cwd: string,
): string[] {
  const args = ['--no-auto-update', '--cwd', cwd, '--sandbox', mapping.sandbox]
  if (mapping.permissionMode) {
    args.push('--permission-mode', mapping.permissionMode)
  }
  if (mapping.disableWebSearch) {
    args.push('--disable-web-search')
  }
  for (const rule of GROK_DENY_RULES) {
    args.push('--deny', rule)
  }
  return args
}

export function assertGrokArgsSafe(args: readonly string[]): void {
  if (args.includes('--always-approve') || args.includes('--worktree')) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Grok --always-approve and native --worktree are forbidden',
      400,
    )
  }
}
