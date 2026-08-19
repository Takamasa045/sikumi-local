import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  ALLOWED_HOOK_COMMAND_NAMES,
  hookCommandFilename,
  isInsideRoot,
  readTextIfExists,
  safeJoinUnderRoot,
  toSafeHookCommand,
} from './config-files.js'
import type {
  ObserverInstallFilePlan,
  ObserverInstallOptions,
  ObserverInstallResult,
} from './types.js'

export const OBSERVER_HOOK_BIN_SEGMENTS = ['observer', 'bin'] as const

export const UNSAFE_HOOK_COMMAND_MESSAGE =
  'つなぐ道具を安全な場所へ置けませんでした。フォルダ名に使えない文字があるときは、庭の設定フォルダへ置き直します。もう一度つなぎ直してください。'

export function hookCommandStagingRoot(
  options: ObserverInstallOptions,
): string | null {
  if (options.dataDirectory && options.dataDirectory.trim().length > 0) {
    return resolve(options.dataDirectory)
  }
  if (options.homeDir && options.homeDir.trim().length > 0) {
    return resolve(options.homeDir, '.shikumi-local')
  }
  return null
}

export function resolveStagedHookCommandPath(
  options: ObserverInstallOptions,
  filename: string,
): string | null {
  if (!ALLOWED_HOOK_COMMAND_NAMES.has(filename)) {
    return null
  }
  const root = hookCommandStagingRoot(options)
  if (!root) {
    return null
  }
  const dest = safeJoinUnderRoot(root, ...OBSERVER_HOOK_BIN_SEGMENTS, filename)
  if (!dest) {
    return null
  }
  return toSafeHookCommand(dest)
}

export function renderHookCommandLauncher(sourcePath: string): string {
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process'

const source = ${JSON.stringify(sourcePath)}
const child = spawn(process.execPath, [source, ...process.argv.slice(2)], {
  stdio: 'inherit',
})
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
`
}

export function planStagedHookCommandFile(input: {
  readonly sourcePath: string
  readonly stagedPath: string
}): ObserverInstallFilePlan {
  const preview = renderHookCommandLauncher(input.sourcePath)
  const previous = readTextIfExists(input.stagedPath)
  const unchanged = previous === preview
  return {
    path: input.stagedPath,
    action: unchanged
      ? 'keep'
      : existsSync(input.stagedPath)
        ? 'update'
        : 'create',
    preview,
    ...(previous === null ? {} : { previous }),
  }
}

export function planStagedHookCommandRemoval(
  stagedPath: string,
): ObserverInstallFilePlan {
  const previous = readTextIfExists(stagedPath)
  return {
    path: stagedPath,
    action: existsSync(stagedPath) ? 'remove' : 'keep',
    preview: '',
    ...(previous === null ? {} : { previous }),
  }
}

export function resolveSafeInstallHookCommand(input: {
  readonly sourcePath: string
  readonly filename: string
  readonly action?: 'install' | 'uninstall'
  readonly options: ObserverInstallOptions
}):
  | {
      readonly ok: true
      readonly command: string
      readonly stagingRoot: string
      readonly file: ObserverInstallFilePlan
    }
  | {
      readonly ok: false
      readonly message: string
    } {
  const source = input.options.hookCommandSourcePath ?? input.sourcePath
  const stagingRoot = hookCommandStagingRoot(input.options)
  const command = resolveStagedHookCommandPath(input.options, input.filename)
  if (!stagingRoot || !command) {
    return { ok: false, message: UNSAFE_HOOK_COMMAND_MESSAGE }
  }
  return {
    ok: true,
    command,
    stagingRoot,
    file:
      input.action === 'uninstall'
        ? planStagedHookCommandRemoval(command)
        : planStagedHookCommandFile({
            sourcePath: source,
            stagedPath: command,
          }),
  }
}

export function unsafeHookCommandResult(): ObserverInstallResult {
  return {
    ok: false,
    changed: false,
    applied: false,
    message: UNSAFE_HOOK_COMMAND_MESSAGE,
  }
}

export function isStagedHookCommandFile(
  path: string,
  stagingRoot: string,
): boolean {
  const filename = basename(path)
  if (!ALLOWED_HOOK_COMMAND_NAMES.has(filename)) {
    return false
  }
  const binRoot = join(stagingRoot, ...OBSERVER_HOOK_BIN_SEGMENTS)
  return isInsideRoot(path, binRoot) && hookCommandFilename(path) === filename
}

export function installedHookCommandExists(
  options: ObserverInstallOptions,
  filename: string,
  sourcePath: string,
): boolean {
  const staged = resolveStagedHookCommandPath(options, filename)
  return Boolean((staged && existsSync(staged)) || existsSync(sourcePath))
}
