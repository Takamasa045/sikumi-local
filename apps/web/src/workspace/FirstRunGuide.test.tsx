import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveFirstRunGuide, FirstRunGuide } from './FirstRunGuide'

describe('FirstRunGuide', () => {
  it('starts at repository registration', () => {
    const model = deriveFirstRunGuide({
      hasWorkspace: false,
      hasConnectedProvider: false,
      hasJobs: false,
    })
    expect(model.visible).toBe(true)
    expect(model.steps.map((step) => step.state)).toEqual([
      'current',
      'pending',
      'pending',
    ])
    render(
      <FirstRunGuide
        hasWorkspace={false}
        hasConnectedProvider={false}
        hasJobs={false}
      />,
    )
    expect(screen.getByTestId('first-run-guide')).toHaveTextContent(
      '開始までの3段階',
    )
    expect(screen.getByText('次に行う')).toBeVisible()
    expect(screen.getAllByText('未完了')).toHaveLength(2)
  })

  it('advances to provider connection after a repository is registered', () => {
    const model = deriveFirstRunGuide({
      hasWorkspace: true,
      hasConnectedProvider: false,
      hasJobs: false,
    })
    expect(model.steps[0]?.state).toBe('done')
    expect(model.steps[1]?.state).toBe('current')
    expect(model.steps[2]?.state).toBe('pending')
  })

  it('advances to asking an employee once a provider is connected', () => {
    const model = deriveFirstRunGuide({
      hasWorkspace: true,
      hasConnectedProvider: true,
      hasJobs: false,
    })
    expect(model.steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'current',
    ])
  })

  it('hides after every step is complete', () => {
    const model = deriveFirstRunGuide({
      hasWorkspace: true,
      hasConnectedProvider: true,
      hasJobs: true,
    })
    expect(model.visible).toBe(false)
    const { container } = render(
      <FirstRunGuide hasWorkspace hasConnectedProvider hasJobs />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
