import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('Shikumi Local garden', () => {
  it('shows the initial dog atelier without pretending work is running', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '犬たちの里山アトリエ' }),
    ).toBeVisible()
    expect(screen.getByText('サグル')).toBeVisible()
    expect(screen.getByText('まだ仕事は始まっていません')).toBeVisible()
    expect(screen.queryByText('作業中')).not.toBeInTheDocument()
  })

  it('switches to the craft workshop', async () => {
    render(<App />)

    await userEvent.click(
      screen.getByRole('button', { name: '職人工房を表示' }),
    )

    expect(screen.getByRole('heading', { name: '職人工房' })).toBeVisible()
    expect(screen.getByTestId('world-stage')).toHaveAttribute(
      'data-world-pack',
      'craft-workshop',
    )
  })

  it('keeps job submission disabled during the repository foundation phase', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '仕事を頼む' })).toBeDisabled()
    expect(screen.getByText('実行機能は次のPhaseで接続します')).toBeVisible()
  })
})
