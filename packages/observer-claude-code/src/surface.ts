import type { ObserverSurface } from '@sikumi-local/observer-core'

export function inferClaudeCodeSurface(input: Record<string, unknown>): ObserverSurface {
  const hint = [
    readString(input.surface),
    readString(input.client),
    readString(input.app),
    readString(input.app_name),
    readString(input.entrypoint),
    readString(input.platform),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
    .toLowerCase()

  if (
    hint.includes('desktop') ||
    hint.includes('claude.app') ||
    hint === 'desktop-app'
  ) {
    return 'desktop-app'
  }
  if (hint.includes('vscode') || hint.includes('ide') || hint.includes('cursor')) {
    return 'ide'
  }
  if (hint.includes('cli') || hint.includes('terminal') || hint.includes('headless')) {
    return 'cli'
  }
  return 'unknown'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}
