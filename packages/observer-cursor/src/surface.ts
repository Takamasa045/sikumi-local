import type { ObserverSurface } from '@sikumi-local/observer-core'
import { isCursorTabEvent } from './events.js'

export function inferCursorSurface(
  input: Record<string, unknown>,
  nativeEventType: string,
): ObserverSurface {
  if (looksLikeCloudAgent(input)) {
    return 'unknown'
  }
  if (isCursorTabEvent(nativeEventType)) {
    return 'cursor-tab'
  }

  const hint = [
    readString(input.surface),
    readString(input.client),
    readString(input.app),
    readString(input.entrypoint),
    readString(input.platform),
    readString(input.source),
    readString(input.composer_mode),
    readString(input.composerMode),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase()

  if (
    hint.includes('cursor-tab') ||
    hint.includes('tab-hook') ||
    hint === 'tab'
  ) {
    return 'cursor-tab'
  }
  if (
    hint.includes('cursor-cli') ||
    hint.includes('cli') ||
    hint.includes('terminal') ||
    hint.includes('headless')
  ) {
    return 'cursor-cli'
  }
  if (
    hint.includes('cursor-agent') ||
    hint.includes('agent') ||
    hint.includes('chat') ||
    hint.includes('composer') ||
    typeof input.conversation_id === 'string' ||
    typeof input.generation_id === 'string'
  ) {
    return 'cursor-agent'
  }
  return 'unknown'
}

export function looksLikeCloudAgent(input: Record<string, unknown>): boolean {
  const hint = [
    readString(input.surface),
    readString(input.client),
    readString(input.app),
    readString(input.platform),
    readString(input.agent_kind),
    readString(input.agentKind),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase()
  return (
    hint.includes('cloud agent') ||
    hint.includes('cursor-cloud') ||
    hint.includes('background_agent') ||
    hint.includes('cloud-agent')
  )
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}
