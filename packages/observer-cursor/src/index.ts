export { createCursorObserverAdapter, inspectCursorHealth } from './adapter.js'
export { runCursorObserverHook } from './cli.js'
export {
  discoverCursorHooks,
  missingCursorEvents,
  type CursorDiscovery,
  type CursorHookOrigin,
  type DiscoveredCursorHook,
} from './discovery.js'
export {
  CURSOR_HOOK_COMMAND_NAME,
  CURSOR_HOOK_EVENTS,
  CURSOR_HOOKS_VERSION,
  CURSOR_KNOWN_EXTRA_EVENTS,
  CURSOR_REQUIRED_HOOK_EVENTS,
  CURSOR_SUPPORTED_RANGE,
  CURSOR_TAB_EVENTS,
  isCursorHookEvent,
  isCursorKnownExtraEvent,
  isCursorTabEvent,
  mapCursorEvent,
} from './events.js'
export {
  applyCursorHookMutation,
  mergeCursorHooks,
  planCursorHookMutation,
  removeCursorHooks,
  resolveCursorHookCommandPath,
} from './install.js'
export { normalizeCursorHook } from './normalize.js'
export { inferCursorSurface, looksLikeCloudAgent } from './surface.js'
