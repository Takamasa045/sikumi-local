import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyConfirmedInstallPlan,
  assertConfigPathWritable,
  previewForFiles,
  readTextIfExists,
  resolveSafeInstallHookCommand,
  unsafeHookCommandResult,
  type ObserverInstallFilePlan,
  type ObserverInstallOptions,
  type ObserverInstallResult,
  type ObserverInstallScope,
} from '@sikumi-local/observer-core'
import { GROK_HOOK_COMMAND_NAME, GROK_PLUGIN_ID } from './events.js'
import {
  mergeGrokToml,
  renderGrokHooksJson,
  renderGrokPluginManifest,
  stripSikumiToml,
} from './plugin.js'

const USER_CONFIG_SEGMENTS = ['.grok', 'config.toml'] as const
const REPO_HOOK_SEGMENTS = ['.grok', 'hooks', 'sikumi-observer.json'] as const
const LEGACY_REPO_HOOK_SEGMENTS = [
  '.grok',
  'hooks',
  'sikumi-observer.toml',
] as const
const PLUGIN_MANIFEST_SEGMENTS = [
  '.grok',
  'plugins',
  GROK_PLUGIN_ID,
  'plugin.json',
] as const
const PLUGIN_HOOKS_SEGMENTS = [
  '.grok',
  'plugins',
  GROK_PLUGIN_ID,
  'hooks',
  'hooks.json',
] as const
const LEGACY_PLUGIN_HOOKS_SEGMENTS = [
  '.grok',
  'plugins',
  GROK_PLUGIN_ID,
  'hooks.toml',
] as const

export function resolveGrokHookCommandPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '../bin/sikumi-observer-grok.mjs',
  )
}

export function planGrokHookMutation(
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
    sourcePath: resolveGrokHookCommandPath(),
    filename: GROK_HOOK_COMMAND_NAME,
    action,
    options,
  })
  if (!staged.ok) {
    return unsafeHookCommandResult()
  }
  const command = staged.command

  const root = scope === 'repo' ? repoDir! : homeDir!
  const hookSegments =
    scope === 'repo' ? REPO_HOOK_SEGMENTS : USER_CONFIG_SEGMENTS
  try {
    const hookTarget = assertConfigPathWritable(root, hookSegments)
    const files = [
      staged.file,
      ...(action === 'install'
        ? planInstallFiles({
            root,
            hookTarget,
            command,
            scope,
          })
        : planUninstallFiles({
            root,
            hookTarget,
            command,
            scope,
          })),
    ]
    return {
      ok: true,
      changed: false,
      requiresConfirm: true,
      applied: false,
      message:
        action === 'install'
          ? 'Grok Build Hook / Plugin の導入差分です。設定や plugin があるだけでは有効としません。ACP は使いません。'
          : 'Grok Build から Sikumi の plugin と hook だけを外す差分です。ほかの設定は残します。',
      preview: previewForFiles(files),
      files,
      evidence: [
        `target: ${hookTarget}`,
        `command: ${command}`,
        '設定ファイルだけでは ready としません。実event受信が必要です',
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
export function applyGrokHookMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const plan = planGrokHookMutation(action, options)
  const scope = options.scope ?? 'user'
  const targetRoot =
    scope === 'repo'
      ? (options.repoDir ?? plan.targetRoot ?? null)
      : (options.homeDir ?? plan.targetRoot ?? null)
  const staged = resolveSafeInstallHookCommand({
    sourcePath: resolveGrokHookCommandPath(),
    filename: GROK_HOOK_COMMAND_NAME,
    action,
    options,
  })
  return applyConfirmedInstallPlan(plan, options, {
    targetRoot,
    relativeSegments:
      scope === 'repo' ? REPO_HOOK_SEGMENTS : USER_CONFIG_SEGMENTS,
    successMessage: grokApplySuccessMessage(action, options),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(staged.ok ? { stagingRoot: staged.stagingRoot } : {}),
  })
}

function grokApplySuccessMessage(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions,
): string {
  if (action === 'install') {
    return options.allowRealUserApply
      ? '表示した対象へ Grok Build Observer を書きました。Sikumiがeventを受信するまで有効とはしません。'
      : '一時ディレクトリへ Grok Build Observer を書きました。Sikumiがeventを受信するまで有効とはしません。'
  }
  return options.allowRealUserApply
    ? '表示した対象から Sikumi の Grok Build Observer を外しました。'
    : '一時ディレクトリから Sikumi の Grok Build Observer を外しました。'
}

function planInstallFiles(input: {
  readonly root: string
  readonly hookTarget: string
  readonly command: string
  readonly scope: ObserverInstallScope
}): ObserverInstallFilePlan[] {
  if (input.scope === 'repo') {
    const existingJson = readTextIfExists(input.hookTarget)
    return [
      filePlan(
        input.hookTarget,
        renderGrokHooksJson(input.command),
        existingJson,
      ),
      ...legacyCleanupPlans(input.root, { includePlugin: true }),
    ]
  }
  const existingToml = readTextIfExists(input.hookTarget)
  const pluginManifest = writable(input.root, PLUGIN_MANIFEST_SEGMENTS)
  const pluginHooks = writable(input.root, PLUGIN_HOOKS_SEGMENTS)
  return [
    filePlan(
      input.hookTarget,
      mergeGrokToml(existingToml, input.command),
      existingToml,
    ),
    filePlan(
      pluginManifest,
      renderGrokPluginManifest(),
      readTextIfExists(pluginManifest),
    ),
    filePlan(
      pluginHooks,
      renderGrokHooksJson(input.command),
      readTextIfExists(pluginHooks),
    ),
    ...legacyCleanupPlans(input.root, { includePlugin: false }),
  ]
}

function planUninstallFiles(input: {
  readonly root: string
  readonly hookTarget: string
  readonly command: string
  readonly scope: ObserverInstallScope
}): ObserverInstallFilePlan[] {
  if (input.scope === 'repo') {
    return [
      removePlan(input.hookTarget),
      ...legacyCleanupPlans(input.root, { includePlugin: true }),
    ]
  }
  const existingToml = readTextIfExists(input.hookTarget)
  const files: ObserverInstallFilePlan[] = []
  if (existingToml) {
    files.push(
      filePlan(
        input.hookTarget,
        mergeUninstallToml(existingToml, input.command),
        existingToml,
      ),
    )
  }
  files.push(
    removePlan(writable(input.root, PLUGIN_MANIFEST_SEGMENTS)),
    removePlan(writable(input.root, PLUGIN_HOOKS_SEGMENTS)),
    ...legacyCleanupPlans(input.root, { includePlugin: false }),
  )
  return files
}

function legacyCleanupPlans(
  root: string,
  options: { readonly includePlugin: boolean },
): ObserverInstallFilePlan[] {
  const files = [removePlan(writable(root, LEGACY_REPO_HOOK_SEGMENTS))]
  if (options.includePlugin) {
    files.push(
      removePlan(writable(root, PLUGIN_MANIFEST_SEGMENTS)),
      removePlan(writable(root, PLUGIN_HOOKS_SEGMENTS)),
    )
  }
  files.push(removePlan(writable(root, LEGACY_PLUGIN_HOOKS_SEGMENTS)))
  return files
}

function mergeUninstallToml(existing: string, command: string): string {
  return stripSikumiToml(existing, command)
}

function writable(root: string, segments: readonly string[]): string {
  return assertConfigPathWritable(root, segments)
}

function filePlan(
  path: string,
  preview: string,
  previous: string | null,
): ObserverInstallFilePlan {
  const unchanged =
    previous === preview || (previous === null && preview.length === 0)
  return {
    path,
    action: unchanged ? 'keep' : existsSync(path) ? 'update' : 'create',
    preview,
    ...(previous === null ? {} : { previous }),
  }
}

function removePlan(path: string): ObserverInstallFilePlan {
  const previous = readTextIfExists(path)
  return {
    path,
    action: existsSync(path) ? 'remove' : 'keep',
    preview: '',
    ...(previous === null ? {} : { previous }),
  }
}
