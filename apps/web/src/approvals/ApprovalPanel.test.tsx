import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalPanel } from './ApprovalPanel'

describe('ApprovalPanel', () => {
  it('renders nothing when there are no approvals', () => {
    const { container } = render(
      <ApprovalPanel
        approvals={[]}
        employeeName="サグル"
        busy={false}
        onResolve={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('resolves, denies, and cancels a pending approval', async () => {
    const onResolve = vi.fn()
    const onCancelJob = vi.fn()
    render(
      <ApprovalPanel
        approvals={[
          {
            id: 'apr_1',
            jobId: 'job_1',
            runId: 'run_1',
            risk: 'medium',
            summary: '外部サイトへアクセスします',
            status: 'pending',
            createdAt: 't',
            resolvedAt: null,
          },
        ]}
        employeeName="サグル"
        busy={false}
        onResolve={onResolve}
        onCancelJob={onCancelJob}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '今回だけ許可' }))
    expect(onResolve).toHaveBeenCalledWith('apr_1', 'approved')
    await userEvent.click(screen.getByRole('button', { name: '拒否' }))
    expect(onResolve).toHaveBeenCalledWith('apr_1', 'denied')
    await userEvent.click(screen.getByRole('button', { name: '仕事を中止' }))
    expect(onCancelJob).toHaveBeenCalled()
  })
})
