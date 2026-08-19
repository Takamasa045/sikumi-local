export const CLAUDE_DESKTOP_SOURCE = 'claude-desktop' as const
export const CLAUDE_DESKTOP_SURFACE = 'desktop-app' as const
export const CLAUDE_DESKTOP_INGESTION = 'mcp' as const
export const CLAUDE_DESKTOP_ATTRIBUTION = 'reported' as const

export const SIKUMI_MCP_TOOLS = [
  'sikumi.list_registered_repositories',
  'sikumi.begin_work',
  'sikumi.update_work',
  'sikumi.note_resource',
  'sikumi.waiting_for_user',
  'sikumi.complete_work',
  'sikumi.fail_work',
] as const

export type SikumiMcpToolName = (typeof SIKUMI_MCP_TOOLS)[number]

export const CLAUDE_DESKTOP_INSTRUCTION = `登録Repositoryで作業を始める場合は、
最初にsikumi.begin_workを使用してください。

作業範囲が変わった場合は、
sikumi.update_workまたはsikumi.note_resourceを使用してください。

ユーザー確認が必要なときは、
sikumi.waiting_for_userを使用してください。

完了時はsikumi.complete_workを使用してください。
失敗したときはsikumi.fail_workを使用してください。

これは協調報告です。通常チャットを自動で全観測するものではありません。
Prompt、返答、会話全文、ファイル本文、秘密情報は送らないでください。`

export const COOPERATIVE_REPORTING_NOTICE =
  'Claudeアプリの通常チャットは制限付きの協調報告です。自動の全チャット観測ではありません。'

export const MCP_SERVER_NAME = 'sikumi-observer-claude-desktop'
export const MCP_SERVER_VERSION = '0.1.0'
export const MCP_PROTOCOL_VERSION = '2025-06-18'

export const MAX_SESSION_ID_LENGTH = 128
export const MIN_SESSION_ID_LENGTH = 8
export const MAX_SUMMARY_LENGTH = 280
export const MAX_PATH_LENGTH = 4096
export const MAX_MCP_MESSAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOOL_PAYLOAD_BYTES = 16 * 1024
export const MAX_TOOL_PAYLOAD_DEPTH = 6
export const MAX_TOOL_PAYLOAD_KEYS = 32
export const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export function isSikumiMcpToolName(value: string): value is SikumiMcpToolName {
  return (SIKUMI_MCP_TOOLS as readonly string[]).includes(value)
}

export function nativeEventForTool(tool: SikumiMcpToolName): string {
  return tool
}
