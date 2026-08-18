import { AppError, type PermissionProfileId } from '@sikumi-local/core'

export interface ClaudePermissionMapping {
  readonly permissionMode: 'dontAsk' | 'plan' | 'acceptEdits'
  readonly allowedTools: string
  readonly disallowedTools: string
}

export function mapClaudePermissions(
  profile: PermissionProfileId,
): ClaudePermissionMapping {
  if (profile === 'unrestricted' || profile === 'publish') {
    throw new AppError(
      'VALIDATION_FAILED',
      'bypassPermissions は禁止されています',
      400,
    )
  }
  if (profile === 'plan') {
    return {
      permissionMode: 'plan',
      allowedTools: 'Read,Grep,Glob',
      disallowedTools: 'Edit,Write,Bash',
    }
  }
  if (profile === 'edit-worktree') {
    return {
      permissionMode: 'acceptEdits',
      allowedTools:
        'Read,Edit,Write,Glob,Grep,Bash(git status *),Bash(git diff *),Bash(pnpm test *),Bash(pnpm lint *)',
      disallowedTools: '',
    }
  }
  if (profile === 'test-worktree') {
    return {
      permissionMode: 'acceptEdits',
      allowedTools: 'Read,Grep,Glob,Bash(pnpm test *)',
      disallowedTools: 'Edit,Write',
    }
  }
  if (profile === 'observe') {
    return {
      permissionMode: 'dontAsk',
      allowedTools: 'Read,Grep,Glob',
      disallowedTools: 'Edit,Write,Bash',
    }
  }
  return {
    permissionMode: 'dontAsk',
    allowedTools: 'Read,Grep,Glob,WebSearch,WebFetch',
    disallowedTools: 'Edit,Write',
  }
}

export function assertClaudeArgsSafe(args: readonly string[]): void {
  const modeIndex = args.indexOf('--permission-mode')
  if (modeIndex >= 0 && args[modeIndex + 1] === 'bypassPermissions') {
    throw new AppError(
      'VALIDATION_FAILED',
      'bypassPermissions は禁止されています',
      400,
    )
  }
}

export const PERMISSION_PROMPT_TOOL =
  'mcp__shikumi_permission_broker__request_permission'

export const CLAUDE_SCHEMA_FINALIZATION_DISALLOWED_TOOLS =
  'Edit,Write,Bash,WebSearch,WebFetch'

export function claudeSchemaFinalizationArgs(input: {
  readonly sessionId: string
  readonly schema: Record<string, unknown>
  readonly prompt?: string
}): string[] {
  return [
    '-r',
    input.sessionId,
    '-p',
    input.prompt ?? 'これまでの結果を指定Schemaだけで出力してください',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(input.schema),
    '--permission-mode',
    'dontAsk',
    '--disallowedTools',
    CLAUDE_SCHEMA_FINALIZATION_DISALLOWED_TOOLS,
  ]
}
