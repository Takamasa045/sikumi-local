import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Artifact } from '@sikumi-local/core'
import { ArtifactShelf } from './ArtifactShelf'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ArtifactShelf', () => {
  it('labels saved metadata without inventing missing body text', () => {
    const artifacts: Artifact[] = [
      sample('report', '調査レポート', '/tmp/a'),
      sample('markdown', 'Markdown', null),
      sample('code_diff', '差分', null),
      sample('patch', 'patch', null),
      sample('test_result', 'tests', null),
      sample('review', 'review', null),
      sample('plan', 'plan', null),
      sample('handoff', 'handoff', null),
      sample('file', 'file', null),
      sample('link', 'link', null),
    ]
    render(<ArtifactShelf artifacts={artifacts} />)
    expect(screen.getByText('調査レポート')).toBeVisible()
    expect(screen.getByText(/保存済み/)).toBeVisible()
    expect(screen.getAllByText(/本文はまだありません/).length).toBeGreaterThan(
      0,
    )
    expect(screen.getByText('Markdown')).toBeVisible()
    expect(screen.getByText(/コード差分/)).toBeVisible()
    expect(screen.getByText(/Patch/)).toBeVisible()
    expect(screen.getByText(/テスト結果/)).toBeVisible()
    expect(screen.getByText(/レビュー結果/)).toBeVisible()
    expect(screen.getByText(/計画/)).toBeVisible()
    expect(screen.getByText(/引き継ぎメモ/)).toBeVisible()
    expect(screen.getByText(/ファイル/)).toBeVisible()
    expect(screen.getByText(/URL/)).toBeVisible()
  })

  it('offers explicit apply and discard for a worktree patch', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const onApply = vi.fn()
    const onDiscard = vi.fn()
    const onExport = vi.fn()
    const onKeep = vi.fn()
    render(
      <ArtifactShelf
        artifacts={[sample('patch', '変更パッチ', '/tmp/a.patch')]}
        worktree={{
          branchName: 'shikumi/tsukuru/a8f3d2aa',
          baseCommit: 'abc12345',
          status: 'completed',
          summary: '1 file changed',
          files: ['from-worktree.txt'],
          patch: 'diff --git a/from-worktree.txt',
        }}
        onApply={onApply}
        onExport={onExport}
        onKeep={onKeep}
        onDiscard={onDiscard}
      />,
    )
    expect(screen.getByTestId('worktree-diff')).toHaveTextContent(
      'shikumi/tsukuru/a8f3d2aa',
    )
    await userEvent.click(
      screen.getByRole('button', { name: '現在のbranchへ適用' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Patchを書き出す' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'branchを残す' }))
    await userEvent.click(screen.getByRole('button', { name: '破棄' }))
    expect(onApply).toHaveBeenCalled()
    expect(onExport).toHaveBeenCalled()
    expect(onKeep).toHaveBeenCalled()
    expect(onDiscard).toHaveBeenCalled()
  })

  it('opens a content viewer, copies text, and closes on Escape', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          artifactId: 'report',
          title: '調査レポート',
          type: 'report',
          format: 'json',
          content: '{"summary":"完了","extra":{"ok":true}}',
          sizeBytes: 40,
          truncated: false,
        }),
      ),
    )
    render(
      <ArtifactShelf artifacts={[sample('report', '調査レポート', 'x')]} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '内容を見る' }))
    expect(await screen.findByTestId('artifact-viewer')).toHaveAttribute(
      'role',
      'dialog',
    )
    expect(screen.getByTestId('artifact-viewer')).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(await screen.findByTestId('artifact-viewer-body')).toHaveTextContent(
      '完了',
    )
    expect(screen.getByText('extra')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'コピー' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        '{"summary":"完了","extra":{"ok":true}}',
      )
    })
    const copyStatus = screen.getByTestId('artifact-viewer-copy-status')
    expect(copyStatus).toBeVisible()
    expect(copyStatus).toHaveTextContent('コピーしました')
    expect(copyStatus).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryAllByText('コピーしました')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('artifact-viewer')).not.toBeInTheDocument()
  })

  it('falls back to raw text for invalid JSON and shows API errors and truncation', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('broken')) {
          return jsonResponse({
            artifactId: 'broken',
            title: '壊れたJSON',
            type: 'report',
            format: 'json',
            content: '{not-json',
            sizeBytes: 9,
            truncated: false,
          })
        }
        if (url.includes('missing')) {
          return jsonResponse(
            { error: { code: 'NOT_FOUND', message: '成果が見つかりません' } },
            404,
          )
        }
        return jsonResponse({
          artifactId: 'huge',
          title: '大きなメモ',
          type: 'markdown',
          format: 'markdown',
          content: '# 一部',
          sizeBytes: 2_000_000,
          truncated: true,
        })
      }),
    )

    const { rerender } = render(
      <ArtifactShelf
        artifacts={[{ ...sample('report', '壊れたJSON', 'x'), id: 'broken' }]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '内容を見る' }))
    expect(await screen.findByText('{not-json')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))

    rerender(
      <ArtifactShelf
        artifacts={[{ ...sample('report', '欠落', 'x'), id: 'missing' }]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '内容を見る' }))
    expect(
      await screen.findByTestId('artifact-viewer-error'),
    ).toHaveTextContent('成果が見つかりません')
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))

    rerender(
      <ArtifactShelf
        artifacts={[{ ...sample('markdown', '大きなメモ', 'x'), id: 'huge' }]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '内容を見る' }))
    expect(await screen.findByText('一部のみ表示')).toBeVisible()
    expect(await screen.findByText('# 一部')).toBeVisible()
  })

  it('shows a loading state while content is fetching', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    let resolveFetch: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )
    render(<ArtifactShelf artifacts={[sample('markdown', 'Markdown', 'x')]} />)
    await userEvent.click(screen.getByRole('button', { name: '内容を見る' }))
    expect(screen.getByTestId('artifact-viewer-loading')).toBeVisible()
    resolveFetch?.(
      jsonResponse({
        artifactId: 'markdown',
        title: 'Markdown',
        type: 'markdown',
        format: 'markdown',
        content: '本文',
        sizeBytes: 2,
        truncated: false,
      }),
    )
    expect(await screen.findByText('本文')).toBeVisible()
  })

  it('shows a visible copy failure without a second live region', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          artifactId: 'markdown',
          title: 'Markdown',
          type: 'markdown',
          format: 'markdown',
          content: '本文',
          sizeBytes: 2,
          truncated: false,
        }),
      ),
    )
    render(<ArtifactShelf artifacts={[sample('markdown', 'Markdown', 'x')]} />)
    await userEvent.click(screen.getByRole('button', { name: '内容を見る' }))
    expect(await screen.findByText('本文')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'コピー' }))
    const copyStatus = await screen.findByTestId('artifact-viewer-copy-status')
    expect(copyStatus).toBeVisible()
    expect(copyStatus).toHaveTextContent('コピーできませんでした')
    expect(screen.queryAllByText('コピーできませんでした')).toHaveLength(1)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sample(
  type: Artifact['type'],
  title: string,
  storagePath: string | null,
): Artifact {
  return {
    id: type,
    jobId: 'job_1',
    type,
    title,
    storagePath,
    createdAt: 't',
  }
}
