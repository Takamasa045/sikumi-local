export type FirstRunStepState = 'done' | 'current' | 'pending'

export interface FirstRunGuideModel {
  readonly visible: boolean
  readonly steps: readonly {
    readonly id: 'repository' | 'provider' | 'job'
    readonly label: string
    readonly state: FirstRunStepState
  }[]
}

export function deriveFirstRunGuide(input: {
  readonly hasWorkspace: boolean
  readonly hasConnectedProvider: boolean
  readonly hasJobs: boolean
}): FirstRunGuideModel {
  const repository = input.hasWorkspace
  const provider = input.hasConnectedProvider
  const job = input.hasJobs
  const visible = !repository || !provider || !job
  const steps = [
    {
      id: 'repository' as const,
      label: '工房にするRepositoryを登録する',
      state: stepState(repository, !repository),
    },
    {
      id: 'provider' as const,
      label: 'Codexなどの実行エンジンをつなぐ',
      state: stepState(provider, repository && !provider),
    },
    {
      id: 'job' as const,
      label: 'AI社員に仕事を頼む',
      state: stepState(job, repository && provider && !job),
    },
  ]
  return { visible, steps }
}

export function FirstRunGuide(props: {
  readonly hasWorkspace: boolean
  readonly hasConnectedProvider: boolean
  readonly hasJobs: boolean
}) {
  const model = deriveFirstRunGuide(props)
  if (!model.visible) {
    return null
  }

  return (
    <section
      className="first-run-guide"
      aria-label="開始までの3段階"
      data-testid="first-run-guide"
    >
      <p className="section-kicker">はじめの案内</p>
      <h2>開始までの3段階</h2>
      <ol>
        {model.steps.map((step, index) => (
          <li key={step.id} data-state={step.state}>
            <span className="first-run-guide__index">{index + 1}</span>
            <span>{step.label}</span>
            <small>{stateLabel(step.state)}</small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function stepState(done: boolean, current: boolean): FirstRunStepState {
  if (done) {
    return 'done'
  }
  return current ? 'current' : 'pending'
}

function stateLabel(state: FirstRunStepState): string {
  if (state === 'done') {
    return '完了'
  }
  if (state === 'current') {
    return '次に行う'
  }
  return '未完了'
}
