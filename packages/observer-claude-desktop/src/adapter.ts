import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  COOPERATIVE_CAPABILITIES,
  displayNameForSource,
  rememberAdapterObservation,
  unavailableHealth,
  type ObserverAdapter,
  type ObserverHealth,
  type ObserverInstallOptions,
} from '@sikumi-local/observer-core'
import { COOPERATIVE_REPORTING_NOTICE } from './events.js'
import {
  applyClaudeDesktopPackageMutation,
  claudeDesktopMcpbPath,
  claudeDesktopManifestOutputPath,
} from './install.js'
import { normalizeClaudeDesktopReport } from './normalize.js'

export function createClaudeDesktopObserverAdapter(): ObserverAdapter {
  return {
    id: 'claude-desktop',
    displayName: displayNameForSource('claude-desktop'),
    capabilities: COOPERATIVE_CAPABILITIES,
    async healthCheck(options) {
      return inspectClaudeDesktopHealth(options)
    },
    async install(options) {
      return applyClaudeDesktopPackageMutation('install', options ?? {})
    },
    async uninstall(options) {
      return applyClaudeDesktopPackageMutation('uninstall', options ?? {})
    },
    normalize(input) {
      return normalizeClaudeDesktopReport(input)
    },
  }
}

export function inspectClaudeDesktopHealth(
  options: ObserverInstallOptions = {},
): ObserverHealth {
  const dataDirectory =
    options.dataDirectory ??
    options.env?.SIKUMI_LOCAL_DATA_DIR ??
    join(homedir(), '.shikumi-local')
  const mcpbPath = claudeDesktopMcpbPath(dataDirectory)
  const manifestPath = claudeDesktopManifestOutputPath(dataDirectory)
  const evidence = [
    COOPERATIVE_REPORTING_NOTICE,
    `package: ${mcpbPath}`,
    'Claude Desktop の設定ファイルは参照も変更もしません',
  ]
  if (!existsSync(mcpbPath) && !existsSync(manifestPath)) {
    return rememberAdapterObservation(
      unavailableHealth({
        status: 'not_installed',
        detectedVersion: null,
        supportedRange: 'Claude Desktop MCP / MCPB',
        warnings: evidence,
        errors: [
          'Claudeアプリ向けの協調報告パッケージはまだ生成されていません',
        ],
      }),
      options.lastEventAt,
    )
  }
  return rememberAdapterObservation(
    {
      ok: false,
      status: 'needs_review',
      detectedVersion: 'claude-desktop-mcp',
      supportedRange: 'Claude Desktop MCP / MCPB',
      lastEventAt: null,
      warnings: [
        ...evidence,
        'パッケージはありますが、Sikumiが協調報告を受信した記録はありません',
        '通常チャットは協調報告方式です。自動の全観測ではありません',
      ],
      errors: [],
    },
    options.lastEventAt,
  )
}
