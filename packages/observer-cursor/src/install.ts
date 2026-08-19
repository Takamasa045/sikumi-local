import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyConfirmedInstallPlan,
  assertConfigPathWritable,
  formatJson,
  isHookEntryOurs,
  isPlainObject,
  previewForFiles,
  readJsonObject,
  resolveSafeInstallHookCommand,
  unsafeHookCommandResult,
  type ObserverInstallFilePlan,
  type ObserverInstallOptions,
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import {
  CURSOR_HOOK_COMMAND_NAME,
  CURSOR_HOOKS_VERSION,
  CURSOR_REQUIRED_HOOK_EVENTS,
} from './events.js'

const HOOK_SEGMENTS = ['.cursor', 'hooks.json'] as const

export function resolveCursorHookCommandPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../bin/sikumi-observer-cursor.mjs',
  )
}

export function planCursorHookMutation(
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
  const staged = resolveSafeInstallHookCommand({
    sourcePath: resolveCursorHookCommandPath(),
    filename: CURSOR_HOOK_COMMAND_NAME,
    action,
    options,
  })
  if (!staged.ok) {
    return unsafeHookCommandResult()
  }
  const command = staged.command

  const root = scope === 'repo' ? repoDir! : homeDir!
  try {
    const target = assertConfigPathWritable(root, HOOK_SEGMENTS)
    const parsed = readJsonObject(target)
    if (!parsed.ok) {
      return {
        ok: false,
        changed: false,
        applied: false,
        message:
          '既存の hooks.json を安全に読めませんでした。壊れた設定は上書きしません。',
        evidence: [target],
      }
    }
    const next =
      action === 'install'
        ? mergeCursorHooks(parsed.value, command)
        : removeCursorHooks(parsed.value, command)
    const preview = formatJson(next)
    const previous = parsed.raw ?? undefined
    const unchanged =
      previous === preview || (!existsSync(target) && action === 'uninstall')
    const file: ObserverInstallFilePlan = {
      path: target,
      action: unchanged ? 'keep' : existsSync(target) ? 'update' : 'create',
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
          ? 'Cursor Hooks の導入差分です。version:1 を保ち、既存 hook と未知の項目は残します。Sikumiがeventを受信するまで有効とはしません。'
          : 'Cursor Hooks から Sikumi の設定だけを外す差分です。ほかの hook は残します。',
      preview: previewForFiles([staged.file, file]),
      files: [staged.file, file],
      evidence: [
        `target: ${target}`,
        `command: ${command}`,
        'Cursor Cloud Agent は初期対象外です',
      ],
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

export function applyCursorHookMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const plan = planCursorHookMutation(action, options)
  const scope = options.scope ?? 'user'
  const targetRoot =
    scope === 'repo'
      ? (options.repoDir ?? plan.targetRoot ?? null)
      : (options.homeDir ?? plan.targetRoot ?? null)
  const staged = resolveSafeInstallHookCommand({
    sourcePath: resolveCursorHookCommandPath(),
    filename: CURSOR_HOOK_COMMAND_NAME,
    action,
    options,
  })
  return applyConfirmedInstallPlan(plan, options, {
    targetRoot,
    relativeSegments: HOOK_SEGMENTS,
    successMessage: cursorApplySuccessMessage(action, options),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(staged.ok ? { stagingRoot: staged.stagingRoot } : {}),
  })
}

function cursorApplySuccessMessage(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions,
): string {
  if (action === 'install') {
    return options.allowRealUserApply
      ? '表示した対象へ Cursor Hooks を書きました。Sikumiがeventを受信するまで有効とはしません。'
      : '一時ディレクトリへ Cursor Hooks を書きました。Sikumiがeventを受信するまで有効とはしません。'
  }
  return options.allowRealUserApply
    ? '表示した対象から Sikumi の Cursor Hooks を外しました。'
    : '一時ディレクトリから Sikumi の Cursor Hooks を外しました。'
}

export function mergeCursorHooks(
  existing: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const next = { ...existing }
  if (typeof existing.version !== 'number') {
    next.version = CURSOR_HOOKS_VERSION
  }
  const hooks = isPlainObject(existing.hooks) ? { ...existing.hooks } : {}
  for (const eventName of CURSOR_REQUIRED_HOOK_EVENTS) {
    const current = Array.isArray(hooks[eventName]) ? [...hooks[eventName]] : []
    const withoutOurs = current.filter((entry) => !isOurEntry(entry, command))
    withoutOurs.push({ command })
    hooks[eventName] = withoutOurs
  }
  next.hooks = hooks
  return next
}

export function removeCursorHooks(
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
  return isHookEntryOurs(entry, command)
}
