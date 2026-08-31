import {
  gardenWorldListSchema,
  installedPackSchema,
  packPreviewSchema,
} from '@sikumi-local/core'
import { z } from 'zod'
import { authorizedHeaders, toApiError, writeWithCsrfRetry } from './session'

const listSchema = z.object({ packs: z.array(installedPackSchema) })
const previewSchema = z.object({ preview: packPreviewSchema })
const packSchema = z.object({ pack: installedPackSchema })

export async function listPacks() {
  const response = await fetch('/api/packs', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return listSchema.parse(body).packs
}

export async function listGardenWorlds() {
  const response = await fetch('/api/worlds', { credentials: 'include' })
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return gardenWorldListSchema.parse(body).worlds
}

export async function previewPack(input: {
  sourceType: 'folder' | 'zip' | 'git'
  path?: string
  gitUrl?: string
}) {
  const response = await writeWithCsrfRetry((token) =>
    fetch('/api/packs/preview', {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify(input),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return previewSchema.parse(body).preview
}

export async function installPack(previewId: string) {
  const response = await writeWithCsrfRetry((token) =>
    fetch('/api/packs/install', {
      method: 'POST',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ previewId, confirm: true }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
  return packSchema.parse(body).pack
}

export async function uninstallPack(id: string) {
  const response = await writeWithCsrfRetry((token) =>
    fetch(`/api/packs/${id}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authorizedHeaders(token),
      body: JSON.stringify({ confirm: true }),
    }),
  )
  const body: unknown = await response.json()
  if (!response.ok) {
    throw toApiError(body, response.status)
  }
}
