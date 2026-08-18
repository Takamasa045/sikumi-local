export interface WorldUnlockDefinition {
  readonly id: string
  readonly label: string
  readonly condition:
    | { readonly completedJobs: number }
    | { readonly totalAcceptedArtifacts: number }
    | {
        readonly employeeMetric: {
          readonly employeeId: string
          readonly metric: string
          readonly minimum: number
        }
      }
}

export interface BuiltInWorldDefinition {
  readonly id: string
  readonly name: string
  readonly unlocks: readonly WorldUnlockDefinition[]
}

export const builtInWorlds: readonly BuiltInWorldDefinition[] = [
  {
    id: 'dog-office',
    name: '犬たちの里山アトリエ',
    unlocks: [
      {
        id: 'bookshelf-small',
        label: '小さな資料棚',
        condition: { completedJobs: 1 },
      },
      {
        id: 'telescope',
        label: '望遠鏡',
        condition: {
          employeeMetric: {
            employeeId: 'saguru',
            metric: 'research_completed',
            minimum: 2,
          },
        },
      },
      {
        id: 'monument',
        label: '記念碑',
        condition: { totalAcceptedArtifacts: 1 },
      },
    ],
  },
  {
    id: 'craft-workshop',
    name: '職人工房',
    unlocks: [
      {
        id: 'workshop',
        label: '作業小屋',
        condition: { completedJobs: 2 },
      },
    ],
  },
]

export function getBuiltInWorld(id: string): BuiltInWorldDefinition {
  return builtInWorlds.find((world) => world.id === id) ?? builtInWorlds[0]!
}
