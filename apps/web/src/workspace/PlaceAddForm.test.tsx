import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlaceAddForm } from './PlaceAddForm'

describe('PlaceAddForm', () => {
  it('fills the path from the native folder picker and then registers', async () => {
    const onRegister = vi.fn()
    const onChooseFolder = vi.fn(async () => '/Users/example/blog')
    render(
      <PlaceAddForm
        busy={false}
        error={null}
        onRegister={onRegister}
        onChooseFolder={onChooseFolder}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'フォルダを選ぶ' }))
    expect(onChooseFolder).toHaveBeenCalled()
    expect(screen.getByLabelText('場所のパス')).toHaveValue(
      '/Users/example/blog',
    )
    await userEvent.type(screen.getByLabelText('担当の名前（任意）'), 'ブログ番')
    await userEvent.click(screen.getByRole('button', { name: 'この場所を追加' }))
    expect(onRegister).toHaveBeenCalledWith('/Users/example/blog', 'ブログ番')
  })

  it('does nothing when folder picking is cancelled', async () => {
    const onRegister = vi.fn()
    render(
      <PlaceAddForm
        busy={false}
        error={null}
        onRegister={onRegister}
        onChooseFolder={async () => null}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'フォルダを選ぶ' }))
    expect(screen.getByLabelText('場所のパス')).toHaveValue('')
    expect(onRegister).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'この場所を追加' })).toBeDisabled()
  })

  it('still accepts a typed path as a secondary path', async () => {
    const onRegister = vi.fn()
    render(
      <PlaceAddForm busy={false} error={null} onRegister={onRegister} />,
    )

    expect(
      screen.queryByRole('button', { name: 'フォルダを選ぶ' }),
    ).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('場所のパス'), '/tmp/second')
    await userEvent.click(screen.getByRole('button', { name: 'この場所を追加' }))
    expect(onRegister).toHaveBeenCalledWith('/tmp/second', '')
  })
})
