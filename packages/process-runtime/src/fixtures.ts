import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveProcessRuntimeFixture(name: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../fixtures', name)
}

export function resolveFakeCliPath(): string {
  return resolveProcessRuntimeFixture('fake-cli.mjs')
}

export function resolveLingerChildPath(): string {
  return resolveProcessRuntimeFixture('linger-child.mjs')
}
