export const fakeScenarios = [
  'complete',
  'fail',
  'hang',
  'spawn-child',
] as const
export type FakeScenario = (typeof fakeScenarios)[number]

export function scenarioFromPrompt(prompt: string): FakeScenario {
  if (prompt.includes('[fail]')) {
    return 'fail'
  }
  if (prompt.includes('[hang]')) {
    return 'hang'
  }
  if (prompt.includes('[spawn-child]')) {
    return 'spawn-child'
  }
  return 'complete'
}
