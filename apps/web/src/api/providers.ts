import {
  providerSchema,
  type Provider,
  type ProviderId,
} from '@sikumi-local/core'
import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session.js'

const providerListSchema = z.object({
  providers: z.array(providerSchema),
  executionConnected: z.boolean(),
  fakeHarness: z.boolean().optional(),
})

const probeResponseSchema = z.object({
  id: z.string(),
  probe: z.object({
    installed: z.boolean(),
    authenticated: z.boolean(),
    transport: z.string(),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
    version: z.string().optional(),
    authDescription: z.string().optional(),
  }),
})

export interface ProviderList {
  readonly providers: Provider[]
  readonly executionConnected: boolean
  readonly fakeHarness: boolean
}

export async function listProviders(): Promise<ProviderList> {
  const response = await fetch('/api/providers', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  const parsed = providerListSchema.parse(body)
  return {
    providers: parsed.providers,
    executionConnected: parsed.executionConnected,
    fakeHarness: parsed.fakeHarness ?? false,
  }
}

export async function probeProvider(id: ProviderId) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/providers/${id}/probe`, {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({}),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return probeResponseSchema.parse(body)
}
