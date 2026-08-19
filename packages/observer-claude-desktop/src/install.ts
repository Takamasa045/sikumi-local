import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyConfirmedInstallPlan,
  previewForFiles,
  type ObserverInstallFilePlan,
  type ObserverInstallOptions,
  type ObserverInstallResult,
} from '@sikumi-local/observer-core'
import {
  packageClaudeDesktopMcpb,
  renderClaudeDesktopManifest,
  writeExtensionSources,
} from './mcpb.js'
import {
  CLAUDE_DESKTOP_INSTRUCTION,
  COOPERATIVE_REPORTING_NOTICE,
} from './events.js'

export const CLAUDE_DESKTOP_BUNDLE_SEGMENTS = [
  'observer',
  'claude-desktop',
] as const

export function claudeDesktopBundleRoot(dataDirectory: string): string {
  return join(dataDirectory, ...CLAUDE_DESKTOP_BUNDLE_SEGMENTS)
}

export function claudeDesktopMcpbPath(dataDirectory: string): string {
  return join(claudeDesktopBundleRoot(dataDirectory), 'sikumi-observer.mcpb')
}

export function claudeDesktopManifestOutputPath(dataDirectory: string): string {
  return join(claudeDesktopBundleRoot(dataDirectory), 'bundle', 'manifest.json')
}

export function planClaudeDesktopPackageMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const dataDirectory = options.dataDirectory ?? null
  if (!dataDirectory) {
    return {
      ok: true,
      changed: false,
      requiresConfirm: true,
      applied: false,
      message:
        '差分を確認しました。Claude Desktop の設定は書き換えません。パッケージは Sikumi のデータフォルダへ生成します。',
      files: [],
      evidence: [
        COOPERATIVE_REPORTING_NOTICE,
        '適用先のデータディレクトリが無いため preview のみです',
      ],
    }
  }
  const bundleRoot = claudeDesktopBundleRoot(dataDirectory)
  const mcpbPath = claudeDesktopMcpbPath(dataDirectory)
  const manifestPath = claudeDesktopManifestOutputPath(dataDirectory)
  const manifestPreview = `${JSON.stringify(renderClaudeDesktopManifest(), null, 2)}\n`
  const instructionPreview = `${CLAUDE_DESKTOP_INSTRUCTION}\n`
  if (action === 'uninstall') {
    const files: ObserverInstallFilePlan[] = [
      removePlan(manifestPath),
      removePlan(mcpbPath),
    ]
    return identifiedPlan({
      message:
        '生成した .mcpb を消す差分です。Claude Desktop の Extensions は手動で外してください。設定ファイルは触りません。',
      files,
      targetRoot: bundleRoot,
      evidence: [
        COOPERATIVE_REPORTING_NOTICE,
        `package: ${mcpbPath}`,
        'Claude Desktop の設定や Extensions フォルダへは書き込みません',
      ],
    })
  }
  const files: ObserverInstallFilePlan[] = [
    {
      path: manifestPath,
      action: existsSync(manifestPath) ? 'update' : 'create',
      preview: manifestPreview,
    },
    {
      path: join(bundleRoot, 'bundle', 'instructions.txt'),
      action: existsSync(join(bundleRoot, 'bundle', 'instructions.txt'))
        ? 'update'
        : 'create',
      preview: instructionPreview,
    },
  ]
  return identifiedPlan({
    message:
      'Claudeアプリ向け .mcpb パッケージの生成差分です。制限付きの協調報告であり、通常チャットの自動全観測ではありません。生成後、Claude Desktop の Settings > Extensions からユーザー自身が入れてください。Sikumi は Claude の設定を書き換えません。',
    files,
    targetRoot: bundleRoot,
    evidence: [
      COOPERATIVE_REPORTING_NOTICE,
      `package: ${mcpbPath}`,
      '導入は Claude Desktop の Settings > Extensions でユーザーが行います',
      'Sikumi は Claude Desktop の設定ファイルを変更しません',
    ],
  })
}

export function applyClaudeDesktopPackageMutation(
  action: 'install' | 'uninstall',
  options: ObserverInstallOptions = {},
): ObserverInstallResult {
  const plan = planClaudeDesktopPackageMutation(action, options)
  const dataDirectory = options.dataDirectory ?? null
  if (!dataDirectory) {
    return plan
  }
  const applied = applyConfirmedInstallPlan(plan, options, {
    targetRoot: claudeDesktopBundleRoot(dataDirectory),
    relativeSegments: ['bundle', 'manifest.json'],
    successMessage:
      action === 'install'
        ? '協調報告用の .mcpb を生成しました。Claude Desktop の設定は変更していません。Settings > Extensions からユーザーが入れてください。'
        : '生成した .mcpb を削除しました。Claude Desktop 側の解除はユーザーが行ってください。',
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  if (!applied.applied || !applied.ok) {
    return applied
  }
  if (action === 'uninstall') {
    rmSync(claudeDesktopBundleRoot(dataDirectory), {
      recursive: true,
      force: true,
    })
    return applied
  }
  const bundleDir = join(claudeDesktopBundleRoot(dataDirectory), 'bundle')
  mkdirSync(bundleDir, { recursive: true, mode: 0o700 })
  try {
    writeExtensionSources(bundleDir)
    const packed = packageClaudeDesktopMcpb(
      claudeDesktopMcpbPath(dataDirectory),
    )
    if (!packed.ok) {
      return {
        ...applied,
        ok: false,
        message:
          'MCPB の pack に失敗しました。Claude の設定は変更していません。',
      }
    }
    return {
      ...applied,
      evidence: [
        ...(applied.evidence ?? []),
        `package: ${packed.path}`,
        'official mcpb CLI で pack しました',
      ],
    }
  } catch (error) {
    return {
      ...applied,
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : 'MCPB の pack に失敗しました。Claude の設定は変更していません。',
    }
  }
}

function identifiedPlan(input: {
  readonly message: string
  readonly files: readonly ObserverInstallFilePlan[]
  readonly targetRoot: string
  readonly evidence: readonly string[]
}): ObserverInstallResult {
  return {
    ok: true,
    changed: false,
    requiresConfirm: true,
    applied: false,
    message: input.message,
    preview: previewForFiles(input.files),
    files: input.files,
    evidence: input.evidence,
    targetRoot: input.targetRoot,
  }
}

function removePlan(path: string): ObserverInstallFilePlan {
  return {
    path,
    action: existsSync(path) ? 'remove' : 'keep',
    preview: '',
  }
}
