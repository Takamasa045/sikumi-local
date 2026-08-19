import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyConfirmedInstallPlan,
  assertConfigPathWritable,
  formatJson,
  isPlainObject,
  previewForFiles,
  readJsonObject,
  toSafeHookCommand,
  type ObserverInstallFilePlan,
  type ObserverInstallOptions,
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import { CLAUDE_CODE_REQUIRED_HOOK_EVENTS, matcherForEvent } from './events.js'

const USER_SETTINGS_SEGMENTS = ['.claude', 'settings.json'] as const
const REPO_SETTINGS_SEGMENTS = ['.claude', 'settings.local.json'] as const

export function resolveClaudeCodeHookCommandPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../bin/sikumi-observer-claude-code.mjs',
  )
}

export function planClaudeCodeHookMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const homeDir = options.homeDir ?? null
  const repoDir = options.repoDir ?? null
  const scope = options.scope ?? 'user'
  if (scope === 'user' && !homeDir) {
    return {
      ok: true,
      changed: false,
      requiresConfirm: true,
      applied: false,
      message:
        '差分を確認しました。実ユーザーの設定へは書き込みません。テスト用の一時ディレクトリだけ適用できます。',
      files: [],
      evidence: ['適用先の一時ディレクトリが無いため preview のみです'],
    }
  }
  if (scope === 'repo' && !repoDir) {
    return {
      ok: false,
      changed: false,
      applied: false,
      message: 'Repository 限定の導入には登録済み repository が必要です',
    }
  }
  const command = toSafeHookCommand(resolveClaudeCodeHookCommandPath())
  if (!command) {
    return {
      ok: false,
      changed: false,
      applied: false,
      message: 'Hookコマンドの絶対pathが安全ではありません',
    }
  }

  const root = scope === 'repo' ? repoDir! : homeDir!
  const relative =
    scope === 'repo' ? REPO_SETTINGS_SEGMENTS : USER_SETTINGS_SEGMENTS
  try {
    const target = assertConfigPathWritable(root, relative)
    const parsed = readJsonObject(target)
    if (!parsed.ok) {
      return {
        ok: false,
        changed: false,
        applied: false,
        message:
          '既存の settings を安全に読めませんでした。壊れた設定は上書きしません。',
        evidence: [target],
      }
    }
    const next =
      action === 'install'
        ? mergeClaudeHooks(parsed.value, command)
        : removeClaudeHooks(parsed.value, command)
    const preview = formatJson(next)
    const previous = parsed.raw ?? undefined
    const file: ObserverInstallFilePlan = {
      path: target,
      action: existsSync(target) ? 'update' : 'create',
      preview,
      ...(previous === undefined ? {} : { previous }),
    }
    return {
      ok: true,
      changed: false,
      requiresConfirm: true,
      applied: false,
      message:
        action === 'install'
          ? 'Claude Code Hooks の導入差分です。既存の設定と未知の項目は残します。'
          : 'Claude Code から Sikumi の設定だけを外す差分です。ほかの設定は残します。',
      preview: previewForFiles([file]),
      files: [file],
      evidence: [`target: ${target}`, `command: ${command}`],
      targetRoot: root,
    }
  } catch {
    return {
      ok: false,
      changed: false,
      applied: false,
      message: '設定pathが安全ではないため、導入差分を作れませんでした',
    }
  }
}

export function applyClaudeCodeHookMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const plan = planClaudeCodeHookMutation(action, options)
  const scope = options.scope ?? 'user'
  const targetRoot =
    scope === 'repo'
      ? (options.repoDir ?? plan.targetRoot ?? null)
      : (options.homeDir ?? plan.targetRoot ?? null)
  return applyConfirmedInstallPlan(plan, options, {
    targetRoot,
    relativeSegments:
      scope === 'repo' ? REPO_SETTINGS_SEGMENTS : USER_SETTINGS_SEGMENTS,
    successMessage: claudeCodeApplySuccessMessage(action, options),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
}

function claudeCodeApplySuccessMessage(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions,
): string {
  if (action === 'install') {
    return options.allowRealUserApply
      ? '表示した対象へ Claude Code Hooks を書きました。Sikumiがeventを受信するまで有効とはしません。'
      : '一時ディレクトリへ Claude Code Hooks を書きました。Sikumiがeventを受信するまで有効とはしません。'
  }
  return options.allowRealUserApply
    ? '表示した対象から Sikumi の Claude Code Hooks を外しました。'
    : '一時ディレクトリから Sikumi の Claude Code Hooks を外しました。'
}

export function mergeClaudeHooks(
  existing: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const next = { ...existing }
  const hooks = isPlainObject(existing.hooks) ? { ...existing.hooks } : {}
  for (const eventName of CLAUDE_CODE_REQUIRED_HOOK_EVENTS) {
    const current = Array.isArray(hooks[eventName]) ? [...hooks[eventName]] : []
    const withoutOurs = current.filter((entry) => !isOurEntry(entry, command))
    const matcher = matcherForEvent(eventName)
    withoutOurs.push({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command }],
    })
    hooks[eventName] = withoutOurs
  }
  next.hooks = hooks
  return next
}

export function removeClaudeHooks(
  existing: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const next = { ...existing }
  if (!isPlainObject(existing.hooks)) {
    return next
  }
  const hooks: Record<string, unknown> = { ...existing.hooks }
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      continue
    }
    const kept = entries.filter((entry) => !isOurEntry(entry, command))
    if (kept.length === 0) {
      delete hooks[eventName]
    } else {
      hooks[eventName] = kept
    }
  }
  next.hooks = hooks
  return next
}

function isOurEntry(entry: unknown, command: string): boolean {
  if (!isPlainObject(entry)) {
    return false
  }
  if (entry.command === command) {
    return true
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => isOurEntry(hook, command))
  }
  return false
}
