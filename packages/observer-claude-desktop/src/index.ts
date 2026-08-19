export {
  createClaudeDesktopObserverAdapter,
  inspectClaudeDesktopHealth,
} from './adapter.js'
export {
  readRegisteredRepositoryCatalog,
  registeredRepositoryCatalogPath,
  writeRegisteredRepositoryCatalog,
  type RegisteredRepositoryCatalog,
  type RegisteredRepositoryRecord,
} from './catalog.js'
export { runClaudeDesktopMcpServer } from './cli.js'
export {
  CLAUDE_DESKTOP_ATTRIBUTION,
  CLAUDE_DESKTOP_INGESTION,
  CLAUDE_DESKTOP_INSTRUCTION,
  CLAUDE_DESKTOP_SOURCE,
  CLAUDE_DESKTOP_SURFACE,
  COOPERATIVE_REPORTING_NOTICE,
  SIKUMI_MCP_TOOLS,
  isSikumiMcpToolName,
} from './events.js'
export {
  applyClaudeDesktopPackageMutation,
  claudeDesktopMcpbPath,
  planClaudeDesktopPackageMutation,
} from './install.js'
export {
  handleMcpMessage,
  serializeMcpMessage,
  serveMcpStdio,
  writeMcpResponse,
} from './mcp-protocol.js'
export {
  assertArchiveRuntimeComplete,
  officialMcpbCliPath,
  packageClaudeDesktopMcpb,
  renderClaudeDesktopManifest,
  runOfficialMcpbValidate,
  unpackClaudeDesktopMcpb,
  validateClaudeDesktopManifest,
  writeExtensionSources,
} from './mcpb.js'
export { normalizeClaudeDesktopReport } from './normalize.js'
export {
  canonicalizeObservedPath,
  matchRegisteredRepository,
  resolveResourceInsideRepository,
} from './paths.js'
export {
  createOpaqueSessionId,
  isOpaqueSessionId,
  type CooperativeSession,
} from './sessions.js'
export {
  callSikumiTool,
  listSikumiTools,
  SIKUMI_TOOL_DESCRIPTIONS,
  type CooperativeToolResult,
} from './tools.js'
