import {
  isGardenStationId,
  isProviderCapabilityKey,
  isProviderId,
  permissionProfileIds,
  providerIds,
  shikumiEventTypes,
  type GardenStationId,
  type PermissionProfileId,
  type ProviderCapabilityKey,
  type ProviderId,
  type ShikumiEventType,
} from '@sikumi-local/core'
import { z } from 'zod'
import { EMPLOYEE_PACK_SCHEMA_VERSION } from './limits.js'

const employeeIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,62}$/, 'employee id must be a lowercase slug')

export const employeeManifestSchema = z.object({
  schemaVersion: z.literal(EMPLOYEE_PACK_SCHEMA_VERSION),
  id: employeeIdSchema,
  name: z.string().trim().min(1).max(64),
  role: z.string().trim().min(1).max(64),
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, 'version must be semver'),
  description: z.string().trim().min(1).max(2000),
  compatibility: z.object({
    core: z.string().trim().min(1).max(32),
  }),
  capabilities: z.array(z.string().trim().min(1).max(64)).min(1),
  requiredProviderCapabilities: z
    .array(z.string().trim().min(1))
    .min(1)
    .transform((values, context) => {
      const keys: ProviderCapabilityKey[] = []
      for (const value of values) {
        if (!isProviderCapabilityKey(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown provider capability: ${value}`,
          })
          return z.NEVER
        }
        keys.push(value)
      }
      return keys
    }),
  permissionProfile: z.enum(permissionProfileIds),
  supportedJobTypes: z.array(z.string().trim().min(1).max(64)).min(1),
  defaultProviderOrder: z
    .array(z.string().trim().min(1))
    .min(1)
    .superRefine((values, context) => {
      for (const [index, value] of values.entries()) {
        if (!isProviderId(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown provider: ${value}`,
            path: [index],
          })
        }
      }
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'defaultProviderOrder must be unique',
        })
      }
    })
    .transform((values) => values.filter(isProviderId) as ProviderId[]),
  prompts: z.object({
    system: z.string().trim().min(1),
    job: z.string().trim().min(1),
  }),
  resultSchema: z.string().trim().min(1),
  stateMap: z.string().trim().min(1),
  growth: z.string().trim().min(1),
  character: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,62}$/, 'character must be a lowercase slug'),
})

export type EmployeeManifest = z.infer<typeof employeeManifestSchema>

export const employeeStateMapSchema = z.object({
  states: z
    .record(
      z.string().min(1),
      z.object({
        station: z.string().min(1),
        pose: z.string().min(1),
        summary: z.string().min(1),
      }),
    )
    .superRefine((states, context) => {
      if (!('idle' in states)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'state-map must define idle',
        })
      }
      for (const [name, state] of Object.entries(states)) {
        if (!isGardenStationId(state.station)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown garden station: ${state.station}`,
            path: [name, 'station'],
          })
        }
      }
    }),
  eventBindings: z
    .record(z.string().min(1), z.string().min(1))
    .superRefine((bindings, context) => {
      for (const [eventType, stateName] of Object.entries(bindings)) {
        if (!(shikumiEventTypes as readonly string[]).includes(eventType)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown event type: ${eventType}`,
            path: [eventType],
          })
        }
        if (typeof stateName !== 'string' || stateName.length === 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'event binding must name a state',
            path: [eventType],
          })
        }
      }
    }),
})

export interface EmployeeStateDefinition {
  readonly station: GardenStationId
  readonly pose: string
  readonly summary: string
}

export interface EmployeeStateMap {
  readonly states: Readonly<Record<string, EmployeeStateDefinition>>
  readonly eventBindings: Readonly<Partial<Record<ShikumiEventType, string>>>
}

export const employeeGrowthSchema = z.object({
  metrics: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        label: z.string().trim().min(1).max(64),
        incrementOn: z.string().trim().min(1).max(64),
      }),
    )
    .min(1),
  levels: z
    .array(
      z.object({
        level: z.number().int().min(1).max(99),
        threshold: z.number().int().min(0),
      }),
    )
    .min(1),
})

export type EmployeeGrowthDefinition = z.infer<typeof employeeGrowthSchema>

export const CATALOG_PROVIDER_IDS: readonly ProviderId[] = providerIds
export type { PermissionProfileId, ProviderId }
