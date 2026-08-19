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
import { CODEX_HOOK_EVENTS } from './events.js'

const USER_HOOK_SEGMENTS = ['.codex', 'hooks.json'] as const

export function resolveCodexHookCommandPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../bin/sikumi-observer-codex.mjs')
}

export function planCodexHookMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const homeDir = options.homeDir ?? null
  if (!homeDir) {
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
  const command = toSafeHookCommand(resolveCodexHookCommandPath())
  if (!command) {
    return {
      ok: false,
      changed: false,
      applied: false,
      message: 'Hookコマンドの絶対pathが安全ではありません',
    }
  }

  try {
    const target = assertConfigPathWritable(homeDir, USER_HOOK_SEGMENTS)
    const parsed = readJsonObject(target)
    if (!parsed.ok) {
      return {
        ok: false,
        changed: false,
        applied: false,
        message: '既存の hooks.json を安全に読めませんでした。壊れた設定は上書きしません。',
        evidence: [target],
      }
    }
    const next =
      action === 'install'
        ? mergeCodexHooks(parsed.value, command)
        : removeCodexHooks(parsed.value, command)
    const preview = formatJson(next)
    const previous = parsed.raw ?? undefined
    const unchanged = previous === preview || (!existsSync(target) && action === 'uninstall')
    const file: ObserverInstallFilePlan = {
      path: target,
      action: unchanged
        ? 'keep'
        : existsSync(target)
          ? 'update'
          : 'create',
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
          ? 'Codex Hooks の導入差分です。Sikumiがeventを受信するまで有効とはしません。'
          : 'Codex Hooks から Sikumi の設定だけを外す差分です。ほかの hook は残します。',
      preview: previewForFiles([file]),
      files: [file],
      evidence: [`target: ${target}`, `command: ${command}`],
      targetRoot: homeDir,
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

export function applyCodexHookMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const plan = planCodexHookMutation(action, options)
  return applyConfirmedInstallPlan(plan, options, {
    targetRoot: options.homeDir ?? plan.targetRoot ?? null,
    relativeSegments: USER_HOOK_SEGMENTS,
    successMessage: codexApplySuccessMessage(action, options),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
}

function codexApplySuccessMessage(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions,
): string {
  if (action === 'install') {
    return options.allowRealUserApply
      ? '表示した対象へ Codex Hooks を書きました。Sikumiがeventを受信するまで有効とはしません。'
      : '一時ディレクトリへ Codex Hooks を書きました。Sikumiがeventを受信するまで有効とはしません。'
  }
  return options.allowRealUserApply
    ? '表示した対象から Sikumi の Codex Hooks を外しました。'
    : '一時ディレクトリから Sikumi の Codex Hooks を外しました。'
}

export function mergeCodexHooks(
  existing: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const next = { ...existing }
  const hooks = isPlainObject(existing.hooks) ? { ...existing.hooks } : {}
  for (const eventName of CODEX_HOOK_EVENTS) {
    const current = Array.isArray(hooks[eventName]) ? [...hooks[eventName]] : []
    const withoutOurs = current.filter((entry) => !isOurCodexEntry(entry, command))
    withoutOurs.push({
      hooks: [
        {
          type: 'command',
          command,
        },
      ],
    })
    hooks[eventName] = withoutOurs
  }
  next.hooks = hooks
  return next
}

export function removeCodexHooks(
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
    const kept = entries.filter((entry) => !isOurCodexEntry(entry, command))
    if (kept.length === 0) {
      delete hooks[eventName]
    } else {
      hooks[eventName] = kept
    }
  }
  next.hooks = hooks
  return next
}

function isOurCodexEntry(entry: unknown, command: string): boolean {
  if (!isPlainObject(entry)) {
    return false
  }
  if (entry.command === command) {
    return true
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((hook) => isOurCodexEntry(hook, command))
  }
  return false
}
