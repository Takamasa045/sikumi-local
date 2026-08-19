import { chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, relative, sep } from 'node:path'
import {
  ALLOWED_HOOK_COMMAND_NAMES,
  applyFilePlans,
  assertConfigPathWritable,
  isInsideRoot,
  isRealUserHomePath,
  refuseRealUserApplyMessage,
} from './config-files.js'
import { isStagedHookCommandFile } from './hook-command.js'
import type {
  ObserverInstallFilePlan,
  ObserverInstallOptions,
  ObserverInstallResult,
} from './types.js'

export function computeInstallPlanDigest(
  files: readonly ObserverInstallFilePlan[] = [],
  targetRoot?: string | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        targetRoot: targetRoot ?? null,
        files: files.map((file) => ({
          path: file.path,
          action: file.action,
          preview: file.preview,
        })),
      }),
    )
    .digest('hex')
}

export function attachInstallPlanIdentity(
  result: ObserverInstallResult,
  targetRoot?: string | null,
): ObserverInstallResult {
  if (!result.ok) {
    return result
  }
  const digest = computeInstallPlanDigest(result.files ?? [], targetRoot)
  return {
    ...result,
    ...(targetRoot ? { targetRoot } : {}),
    planDigest: digest,
    confirmationToken: digest,
  }
}

export const INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE =
  '表示した差分と現在の設定が一致しません。もう一度差分を確認してください。'

export function installConfirmationMatches(
  options: ObserverInstallOptions,
  plan: ObserverInstallResult,
): boolean {
  const expected = plan.planDigest ?? plan.confirmationToken
  if (!options.confirm || !expected) {
    return false
  }
  const provided = options.confirmationToken ?? options.planDigest
  return provided === expected
}

/** Server grants this only after CSRF/auth and a matching plan digest. */
export function shouldGrantRealUserApply(
  options: Pick<
    ObserverInstallOptions,
    'confirm' | 'confirmationToken' | 'planDigest'
  >,
  preview: ObserverInstallResult,
): boolean {
  return installConfirmationMatches(options, preview)
}

export function applyConfirmedInstallPlan(
  plan: ObserverInstallResult,
  options: ObserverInstallOptions,
  input: {
    readonly targetRoot: string | null
    readonly relativeSegments: readonly string[]
    readonly successMessage: string
    readonly env?: NodeJS.ProcessEnv
    readonly stagingRoot?: string | null
  },
): ObserverInstallResult {
  const identified = attachInstallPlanIdentity(plan, input.targetRoot)
  if (!identified.ok) {
    return identified
  }
  if (!options.confirm) {
    return {
      ...identified,
      requiresConfirm: true,
      applied: false,
      changed: false,
    }
  }
  const env = input.env ?? options.env ?? process.env
  if (!input.targetRoot) {
    return {
      ...identified,
      ok: false,
      applied: false,
      changed: false,
      message: refuseRealUserApplyMessage(),
    }
  }
  if (
    isRealUserHomePath(input.targetRoot, env) &&
    options.allowRealUserApply !== true
  ) {
    return {
      ...identified,
      ok: false,
      applied: false,
      changed: false,
      message: refuseRealUserApplyMessage(),
    }
  }
  if (!installConfirmationMatches(options, identified)) {
    return {
      ...identified,
      ok: false,
      applied: false,
      changed: false,
      requiresConfirm: true,
      message: INSTALL_PLAN_DIGEST_MISMATCH_MESSAGE,
    }
  }
  try {
    assertConfigPathWritable(input.targetRoot, input.relativeSegments)
    for (const file of identified.files ?? []) {
      assertPlanFileAllowed(
        file.path,
        input.targetRoot,
        input.stagingRoot ?? null,
      )
    }
  } catch {
    return {
      ok: false,
      changed: false,
      applied: false,
      message: '設定pathが安全ではないため、導入差分を適用できませんでした',
    }
  }
  const applied = applyFilePlans(identified.files ?? [])
  if (applied.ok) {
    makeStagedHookCommandsExecutable(identified.files ?? [])
  }
  return {
    ...identified,
    ok: applied.ok,
    changed: applied.changed,
    applied: applied.ok && applied.changed,
    requiresConfirm: false,
    message: applied.ok
      ? input.successMessage
      : '書き込みに失敗したため、元の内容へ戻しました。',
  }
}

function assertPlanFileAllowed(
  path: string,
  root: string,
  stagingRoot: string | null,
): void {
  if (isAbsolute(path) && isInsideRoot(path, root)) {
    assertPlanFileInsideRoot(path, root)
    return
  }
  if (
    stagingRoot &&
    isAbsolute(path) &&
    isStagedHookCommandFile(path, stagingRoot)
  ) {
    assertConfigPathWritable(stagingRoot, ['observer', 'bin', basename(path)])
    return
  }
  throw new Error('plan file left the target root')
}

function assertPlanFileInsideRoot(path: string, root: string): void {
  if (!isAbsolute(path) || !isInsideRoot(path, root)) {
    throw new Error('plan file left the target root')
  }
  const segments = relative(root, path)
    .split(sep)
    .filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    throw new Error('plan file is the target root')
  }
  assertConfigPathWritable(root, segments)
}

function makeStagedHookCommandsExecutable(
  files: readonly ObserverInstallFilePlan[],
): void {
  for (const file of files) {
    if (file.action === 'remove' || file.action === 'keep') {
      continue
    }
    if (!ALLOWED_HOOK_COMMAND_NAMES.has(basename(file.path))) {
      continue
    }
    try {
      chmodSync(file.path, 0o755)
    } catch {
      // chmod is best-effort on platforms that ignore mode bits
    }
  }
}
