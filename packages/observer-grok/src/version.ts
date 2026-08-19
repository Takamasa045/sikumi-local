import {
  classifyObservedVersion,
  probeCommandVersion,
  type ObservedVersionClass,
} from '@sikumi-local/observer-core'
import { GROK_SUPPORTED_VERSION_RANGE } from './events.js'

export interface GrokVersionInspection {
  readonly version: string | null
  readonly classification: ObservedVersionClass
  readonly supportedRange: string
}

export async function inspectGrokVersion(
  env?: NodeJS.ProcessEnv,
): Promise<GrokVersionInspection> {
  const probed = await probeCommandVersion({
    names: ['grok'],
    args: ['--version'],
    ...(env ? { env } : {}),
  })
  const version = probed.version
  return {
    version,
    classification: classifyObservedVersion(
      version,
      GROK_SUPPORTED_VERSION_RANGE,
    ),
    supportedRange: GROK_SUPPORTED_VERSION_RANGE.label,
  }
}
