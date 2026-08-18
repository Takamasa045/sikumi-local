import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Artifact } from '@sikumi-local/core'
import { ArtifactShelf } from './ArtifactShelf'

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
})

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
