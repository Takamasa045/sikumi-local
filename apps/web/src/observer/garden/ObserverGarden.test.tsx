import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKING_WALK_FIRST_STEP_MS,
  WORKING_WALK_LANE_X,
  WORKING_WALK_STOPS,
} from './gardenWalk'
import type { Workspace } from '@sikumi-local/core'
import type { TodayOverview } from '../../api/observer'
import { GARDEN_WORLD_PACK_STORAGE_KEY } from '../../garden/useGardenWorldPack'
import { getWorldPack } from '../../garden/worlds'
import { ObserverGarden } from './ObserverGarden'
import { ANOTHER_LIVE_WORK } from '../places/placeResidents'

type RepositoryView = TodayOverview['repositories'][number]
type SessionView = RepositoryView['sessions'][number]

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem(GARDEN_WORLD_PACK_STORAGE_KEY)
})

describe('ObserverGarden', () => {
  it('shows registered places as ○○番 characters, not tool dogs or a list', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'my-blog', [
          session({
            id: 's1',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
            lastObservedLabel: '3分前',
          }),
          session({
            id: 's2',
            source: 'claude-code',
            displayName: 'Claude Code',
            title: 'テストを書いている',
            status: 'active',
            activity: 'active',
            lastObservedLabel: '1分前',
          }),
        ]),
        repository('repo_b', 'notes', []),
      ]),
      [workspace('ws_repo_a', 'ブログ番')],
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getAllByRole('listitem')).toHaveLength(3)
    expect(within(residents).getAllByText('ブログ番')).toHaveLength(2)
    expect(within(residents).getByText(/APIを直している/)).toBeVisible()
    expect(within(residents).getByText(/テストを書いている/)).toBeVisible()
    expect(within(residents).getByText('notes番')).toBeVisible()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
    expect(within(residents).queryByText('Codex')).toBeNull()
    expect(within(residents).queryByText('Claude Code')).toBeNull()
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()
    expect(screen.queryByTestId('garden-employee')).toBeNull()
    expect(screen.queryByText('サグル')).toBeNull()
    expect(
      screen.queryByRole('list', { name: '出どころ未確認の変更' }),
    ).toBeNull()
  })

  it('lets each live stream on one place be inspected as its own everyday line', async () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'hataraki', [
          session({
            id: 'grok',
            source: 'grok-build',
            displayName: 'Grok Build',
            title: '働きの画面を直している',
            status: 'running',
            activity: 'working',
            lastObservedLabel: '1分前',
          }),
          session({
            id: 'codex',
            source: 'codex',
            surface: 'desktop-app',
            displayName: 'Codex',
            title: '確認の仕組みを書いている',
            status: 'running',
            activity: 'working',
            lastObservedAt: '2026-08-18T23:58:00.000Z',
            lastObservedLabel: '2分前',
          }),
        ]),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    const walkers = within(residents).getAllByRole('listitem')
    expect(walkers).toHaveLength(2)
    expect(within(residents).getAllByText('hataraki番')).toHaveLength(2)
    expect(within(residents).getByText('働きの画面を直している')).toBeVisible()
    expect(
      within(residents).getByText('確認の仕組みを書いている'),
    ).toBeVisible()
    const groundXs = walkers.map((item) =>
      Number(item.getAttribute('data-ground-x')),
    )
    const walkXs = walkers.map((item) =>
      Number(item.getAttribute('data-walk-x')),
    )
    expect(Math.abs(groundXs[0]! - groundXs[1]!)).toBeGreaterThanOrEqual(
      WORKING_WALK_LANE_X,
    )
    expect(Math.abs(walkXs[0]! - walkXs[1]!)).toBeGreaterThanOrEqual(
      WORKING_WALK_LANE_X - 1,
    )
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const first = screen.getByTestId('garden-inspect')
    expect(first).toHaveTextContent('働きの画面を直している')
    expect(first).not.toHaveTextContent('確認の仕組みを書いている')
    expect(first).not.toHaveTextContent('まだ分かっていません')
    expect(first).not.toHaveTextContent('.tsx')
    expect(first).not.toHaveTextContent('SHA')

    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a-2')).getByRole('button'),
    )
    const second = screen.getByTestId('garden-inspect')
    expect(second).toHaveTextContent('確認の仕組みを書いている')
    expect(second).not.toHaveTextContent('働きの画面を直している')
    expect(second).not.toHaveTextContent('まだ分かっていません')
    expect(second).not.toHaveTextContent('Grok Build')
  })

  it('does not add a second walker for leftover hooks or inferred git', () => {
    renderGarden(
      overviewOf([
        repository(
          'repo_hataraki',
          'hataraki',
          [
            session({
              id: 'grok',
              source: 'grok-build',
              displayName: 'Grok Build',
              title: '働きの画面を直している',
              status: 'running',
              activity: 'working',
            }),
            session({
              id: 'fake',
              source: 'claude-code',
              displayName: 'Claude Code',
              title: 'Claude Codeがファイルを扱っています',
              surface: 'unknown',
              status: 'running',
              activity: 'working',
            }),
            session({
              id: 'git',
              source: 'git',
              displayName: '変更元不明',
              title: '変更元不明の作業',
              attributionConfidence: 'inferred',
            }),
          ],
          4,
        ),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getAllByRole('listitem')).toHaveLength(1)
    expect(within(residents).getByText('hataraki番')).toBeVisible()
    expect(within(residents).getByText('働きの画面を直している')).toBeVisible()
    expect(within(residents).queryByText(ANOTHER_LIVE_WORK)).toBeNull()
    expect(within(residents).queryByText('Claude Code')).toBeNull()
    expect(within(residents).queryByText('変更元不明の作業')).toBeNull()
  })

  it('keeps one character per registered place even when idle', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', []),
        repository('repo_b', 'beta', []),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getAllByRole('listitem')).toHaveLength(2)
    expect(within(residents).getByText('alpha番')).toBeVisible()
    expect(within(residents).getByText('beta番')).toBeVisible()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
    const items = within(residents).getAllByRole('listitem')
    expect(
      items.every(
        (item) => item.getAttribute('data-station') !== 'observatory',
      ),
    ).toBe(true)
    expect(
      items.every((item) => item.getAttribute('data-station') !== 'archive'),
    ).toBe(true)
    const groundXs = items.map((item) => item.getAttribute('data-ground-x'))
    expect(new Set(groundXs).size).toBe(2)
    expect(groundXs.every((value) => Number(value) >= 36)).toBe(true)
  })

  it('does not use git or inferred work as the job name', () => {
    renderGarden(
      overviewOf([
        repository(
          'repo_a',
          'alpha',
          [
            session({
              id: 'git',
              source: 'git',
              displayName: 'Git作業',
              title: '変更元不明の作業',
              attributionConfidence: 'observed',
            }),
            session({
              id: 'guess',
              source: 'codex',
              displayName: 'Codexらしい',
              title: '推測された作業',
              attributionConfidence: 'inferred',
            }),
          ],
          4,
        ),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('alpha番')).toBeVisible()
    expect(within(residents).getByText('途中の仕事がある')).toBeVisible()
    expect(within(residents).queryByText(/しまっていない変更/)).toBeNull()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
    expect(within(residents).queryByText('変更元不明の作業')).toBeNull()
    expect(within(residents).queryByText('Git作業')).toBeNull()
    expect(within(residents).queryByText('Codexらしい')).toBeNull()
    expect(
      screen.queryByRole('list', { name: '出どころ未確認の変更' }),
    ).toBeNull()
  })

  it('shows the empty garden when no place is registered', () => {
    renderGarden(overviewOf([]))

    expect(
      screen.getByText(
        '登録した場所がまだありません。今日の作業場からフォルダを追加してください。',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('list', { name: '庭の住人' })).toBeNull()
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()

    renderGarden(null)
    expect(
      screen.getAllByText(
        '登録した場所がまだありません。今日の作業場からフォルダを追加してください。',
      ).length,
    ).toBeGreaterThan(0)
  })

  it('names shikumi places しくみローカル番', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'sikumi-local', []),
        repository('repo_b', 'my-shikumi-notes', []),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getAllByText('しくみローカル番')).toHaveLength(2)
  })

  it('opens current work in place without turning a tool into an employee', async () => {
    renderGarden(
      overviewOf([
        repository(
          'repo_a',
          'alpha',
          [
            session({
              id: 's1',
              source: 'codex',
              displayName: 'Codex',
              title: 'APIを直している',
              status: 'running',
              activity: 'working',
            }),
          ],
          2,
          ['画面'],
        ),
      ]),
    )

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('alpha番')
    expect(inspect).toHaveTextContent('いま')
    expect(inspect).toHaveTextContent('APIを直している')
    expect(inspect).toHaveTextContent('途中の仕事が残っている')
    expect(inspect).not.toHaveTextContent('画面まわりを直している')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect).not.toHaveTextContent('実装の様子')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('途中の仕事が2')
    expect(inspect).not.toHaveTextContent('画面あたり')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent('作業中のファイル')
    expect(inspect).not.toHaveTextContent('これから')
    expect(inspect).not.toHaveTextContent('いまの作業の続き')
    expect(inspect).not.toHaveTextContent('Codexが動かしている')
    expect(inspect).not.toHaveTextContent('まだ分かっていません')
    expect(inspect).toHaveTextContent(/資料棚|作業台|確認の場所/)
    expect(inspect.querySelector('.garden-inspect__title')).toHaveTextContent(
      'alpha番',
    )
    expect(inspect).not.toHaveTextContent('望遠鏡')
    expect(screen.queryByTestId('garden-employee')).toBeNull()
    expect(screen.queryByRole('heading', { name: '登録した場所' })).toBeNull()
  })

  it('hides idle sessions and does not put residents on the observatory', () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'kids',
            source: 'cursor',
            displayName: 'エージェントワークフローキッズ版',
            title: '作業',
            status: 'idle',
            activity: 'idle',
          }),
          session({
            id: 'live',
            source: 'codex',
            displayName: 'Codex',
            title: 'Codexの作業が始まりました',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(
      within(residents).queryByText('エージェントワークフローキッズ版'),
    ).toBeNull()
    expect(within(residents).getByText('動いている')).toBeVisible()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
    expect(
      within(residents).queryByText('Codexの作業が始まりました'),
    ).toBeNull()
    expect(within(residents).queryByText('Codexが動かしている')).toBeNull()
    expect(within(residents).getByRole('listitem')).toHaveAttribute(
      'data-station',
      'workbench',
    )
    expect(
      within(residents).queryByRole('listitem', { name: /望遠鏡/ }),
    ).toBeNull()
    expect(within(residents).getByRole('listitem')).not.toHaveAttribute(
      'data-station',
      'observatory',
    )
  })

  it('shows only known facts when no real title remains', async () => {
    renderGarden(
      overviewOf([
        repository('repo_a', '', [
          session({
            id: 's1',
            source: 'codex',
            displayName: 'Codex',
            title: 'Codexの様子が届きました',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('動いている')).toBeVisible()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
    await userEvent.click(within(residents).getByRole('button'))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('動いている')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent(
      'まだ分かっていません',
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent(
      'いまの作業の続き',
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('望遠鏡')
  })

  it('explains a station in place when it is clicked', async () => {
    renderGarden(null)

    await userEvent.click(screen.getByRole('button', { name: '資料棚' }))
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      'この工房の資料を読む場所',
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent(
      '資料棚に、いまは誰もいません',
    )
  })

  it('names the waiting place in picture words', async () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 'wait',
            source: 'claude-desktop',
            displayName: 'Claudeアプリ',
            title: '承認が必要',
            status: 'idle',
            activity: 'waiting',
          }),
        ]),
      ]),
    )

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('確認の場所')
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('確認待ち')
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('承認が必要')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent(' / ')
    expect(screen.getByTestId('garden-inspect')).toHaveTextContent('確認が必要')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent(
      'Claudeアプリが動かしている',
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent(
      'Claude Codeが動かしている',
    )
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('望遠鏡')
    expect(screen.getByTestId('garden-inspect')).not.toHaveTextContent('確認札')
    expect(screen.getByTestId('garden-place-repo_a')).toHaveAttribute(
      'data-station',
      'waiting',
    )
    const labels = [
      ...screen.getByTestId('garden-inspect').querySelectorAll('dt'),
    ].map((item) => item.textContent)
    expect(labels).toContain('どこまでやったか')
    expect(labels).toContain('次はこんな感じか')
    expect(labels).not.toContain('いま')
  })

  it('walks a working character between the shelf, bench, and check place', async () => {
    vi.useFakeTimers()
    renderGarden(
      overviewOf([
        repository('repo_a', 'alpha', [
          session({
            id: 's1',
            source: 'codex',
            displayName: 'Codex',
            title: 'APIを直している',
            status: 'running',
            activity: 'working',
          }),
        ]),
      ]),
    )

    const actor = screen.getByTestId('garden-place-repo_a')
    const firstStop = actor.getAttribute('data-walk-stop')
    expect(actor).toHaveAttribute('data-station', 'workbench')
    expect(actor).toHaveAttribute('data-status', 'working')
    expect(actor).toHaveAttribute('data-traveling', 'false')
    expect(WORKING_WALK_STOPS).toContain(firstStop)

    await act(async () => {
      vi.advanceTimersByTime(WORKING_WALK_FIRST_STEP_MS + 20)
    })

    expect(actor).toHaveAttribute('data-traveling', 'true')
    expect(actor).toHaveAttribute('data-gesture', 'walking')
    const nextStop = actor.getAttribute('data-walk-stop')
    expect(nextStop).not.toBe(firstStop)
    expect(WORKING_WALK_STOPS).toContain(nextStop)
    expect(actor.getAttribute('data-station')).toBe('workbench')
  })

  it('shows the repository name on the bubble when ○○番 does not already name it', () => {
    renderGarden(overviewOf([repository('repo_a', 'my-blog', [])]), [
      workspace('ws_repo_a', 'ブログ番'),
    ])

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(within(residents).getByText('ブログ番')).toBeVisible()
    expect(within(residents).getByText('my-blog')).toBeVisible()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
  })

  it('shows everyday git status without SHA or unknown boilerplate', async () => {
    renderGarden(
      overviewOf([
        repository('repo_a', 'hataraki', [], 2, ['画面'], {
          latestRecordTitle: '働きの直し',
          outgoingCount: 1,
          incomingCount: 0,
        }),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(
      within(residents).getByText('画面まわりに、途中の仕事がある'),
    ).toBeVisible()
    expect(within(residents).queryByText('働きの直し')).toBeNull()
    expect(within(residents).queryByText(/送っていない/)).toBeNull()
    expect(within(residents).queryByText('まだ分かっていません')).toBeNull()
    expect(within(residents).queryByText(/Claude Code/)).toBeNull()
    expect(within(residents).queryByText(/しまっていない変更/)).toBeNull()
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('いちばん新しい記録：働きの直し')
    expect(inspect).toHaveTextContent('画面まわりを直している')
    expect(inspect).toHaveTextContent('途中の仕事が残っている')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('途中の仕事が2')
    expect(inspect).toHaveTextContent('送っていない')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect).not.toHaveTextContent('まだ分かっていません')
    expect(inspect).not.toHaveTextContent('commit')
    expect(inspect).not.toHaveTextContent('HEAD')
  })

  it('shows how far a still place got and what is next, without inventing', async () => {
    renderGarden(overviewOf([repository('repo_a', 'notes', [], 1, ['画面'])]))

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('画面まわりを直している')
    expect(inspect).toHaveTextContent('途中の仕事が残っている')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('途中の仕事が1')
    expect(inspect).not.toHaveTextContent('画面あたり')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent('まだ分かっていません')
    expect(inspect).not.toHaveTextContent('次に動かすまで待つ')
    expect(inspect).not.toHaveTextContent('次はこんな感じか')
    const labels = [...inspect.querySelectorAll('dt')].map(
      (item) => item.textContent,
    )
    expect(labels).not.toContain('いま')
    expect(labels).not.toContain('これから')
    expect(inspect).not.toHaveTextContent('変更元不明')
  })

  it('summarizes leftover work without listing files when a place is clicked', async () => {
    const files = hatarakiLeftoverFiles()
    renderGarden(
      overviewOf([
        repository('repo_hataraki', 'hataraki', [], files.length, [], {
          worktrees: [worktreeOf(files)],
        }),
      ]),
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(
      within(residents).getByText('画面や確認まわりに、途中の仕事がある'),
    ).toBeVisible()
    expect(within(residents).queryByText(/しまっていない変更/)).toBeNull()
    expect(screen.queryByRole('region', { name: '○○番の一覧' })).toBeNull()

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_hataraki')).getByRole(
        'button',
      ),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent('どこまでやったか')
    expect(inspect).toHaveTextContent('画面や確認まわりを直している')
    expect(inspect).toHaveTextContent('途中の仕事が残っている')
    expect(inspect).not.toHaveTextContent('Office.tsx')
    expect(inspect).not.toHaveTextContent('garden.spec.ts')
    expect(inspect).not.toHaveTextContent('api-fixture-entry.ts')
    expect(inspect).not.toHaveTextContent('README.md')
    expect(inspect).not.toHaveTextContent('ほかにもある')
    expect(inspect).not.toHaveTextContent('途中の仕事が18')
    expect(inspect).not.toHaveTextContent(' / ')
    expect(inspect).not.toHaveTextContent('しまっていない変更')
    expect(inspect).not.toHaveTextContent('まだ分かっていません')
    expect(inspect).not.toHaveTextContent('変更元不明')
  })

  it('shows a blog article title on inspect instead of kit files', async () => {
    renderGarden(
      overviewOf([
        repository('repo_blog', 'my-blog', [], 4, [], {
          workStory:
            'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
        }),
      ]),
      [workspace('ws_repo_blog', 'ブログ番')],
    )

    const residents = screen.getByRole('list', { name: '庭の住人' })
    expect(
      within(residents).getByText(
        'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
      ),
    ).toBeVisible()
    expect(within(residents).queryByText('MEMORY.md')).toBeNull()

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_blog')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).toHaveTextContent(
      'いちばん新しい記事は『AIチームは多いほど強い、ではなかった』です',
    )
    expect(inspect).toHaveTextContent('途中の仕事が残っている')
    expect(inspect).not.toHaveTextContent('MEMORY.md')
    expect(inspect).not.toHaveTextContent('BLOG_WORKSPACE.md')
    expect(inspect).not.toHaveTextContent('STYLE.md')
    expect(inspect).not.toHaveTextContent('articles.log')
  })

  it('does not show leftover files when a still place has none', async () => {
    renderGarden(overviewOf([repository('repo_a', 'notes', [])]))

    await userEvent.click(
      within(screen.getByTestId('garden-place-repo_a')).getByRole('button'),
    )
    const inspect = screen.getByTestId('garden-inspect')
    expect(inspect).not.toHaveTextContent('記録する前の、途中の仕事です')
    expect(inspect).not.toHaveTextContent('途中の仕事')
    expect(inspect).not.toHaveTextContent('ほかにもある')
    expect(inspect.querySelector('.garden-inspect__leftover')).toBeNull()
  })

  it('stays on the satoyama atelier until a look is chosen', () => {
    renderGarden(overviewOf([repository('repo_a', 'alpha', [])]))

    const garden = screen.getByRole('region', { name: '観測の庭' })
    const dogOffice = getWorldPack('dog-office')
    expect(garden).toHaveAttribute('data-world-pack', 'dog-office')
    expect(garden.style.backgroundImage).toContain(dogOffice.backgroundUrl)
    expect(gardenLookButton('里山')).toHaveAttribute('aria-pressed', 'true')
    expect(gardenLookButton('工房')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('犬たちの里山アトリエ')).toBeVisible()
    expect(screen.queryByText('dog-office')).toBeNull()
    expect(screen.queryByText('craft-workshop')).toBeNull()
    expect(screen.queryByText('worldPackId')).toBeNull()
    expect(actorAtlasUrl('repo_a')).toContain(dogOffice.character.atlasUrl)
  })

  it('renders the workshop look from a stored choice', () => {
    localStorage.setItem(GARDEN_WORLD_PACK_STORAGE_KEY, 'craft-workshop')
    renderGarden(overviewOf([repository('repo_a', 'alpha', [])]))

    const garden = screen.getByRole('region', { name: '観測の庭' })
    const workshop = getWorldPack('craft-workshop')
    expect(garden).toHaveAttribute('data-world-pack', 'craft-workshop')
    expect(garden.style.backgroundImage).toContain(workshop.backgroundUrl)
    expect(screen.getByText('職人工房')).toBeVisible()
    expect(actorAtlasUrl('repo_a')).toContain(workshop.character.atlasUrl)
    expect(screen.getByRole('button', { name: '作業台' })).toHaveStyle({
      left: '56%',
      top: '53%',
    })
    expect(screen.queryByText('craft-workshop')).toBeNull()
  })

  it('switches background and characters to the workshop look', async () => {
    const firstView = renderGarden(
      overviewOf([repository('repo_a', 'alpha', [])]),
    )

    await userEvent.click(gardenLookButton('工房'))

    const garden = screen.getByRole('region', { name: '観測の庭' })
    const workshop = getWorldPack('craft-workshop')
    expect(garden).toHaveAttribute('data-world-pack', 'craft-workshop')
    expect(garden.style.backgroundImage).toContain(workshop.backgroundUrl)
    expect(actorAtlasUrl('repo_a')).toContain(workshop.character.atlasUrl)
    expect(gardenLookButton('工房')).toHaveAttribute('aria-pressed', 'true')
    expect(gardenLookButton('里山')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('職人工房')).toBeVisible()
    expect(screen.getByRole('button', { name: '作業台' })).toBeVisible()
    expect(screen.getByRole('button', { name: '納品台' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '工房の整え方' })).toBeNull()
    expect(screen.queryByText('craft-workshop')).toBeNull()

    const first = garden.style.backgroundImage
    const firstAtlas = actorAtlasUrl('repo_a')
    firstView.unmount()
    renderGarden(overviewOf([repository('repo_a', 'alpha', [])]))
    expect(screen.getByRole('region', { name: '観測の庭' })).toHaveAttribute(
      'data-world-pack',
      'craft-workshop',
    )
    expect(
      screen.getByRole('region', { name: '観測の庭' }).style.backgroundImage,
    ).toBe(first)
    expect(actorAtlasUrl('repo_a')).toBe(firstAtlas)
  })
})

function gardenLookButton(name: '里山' | '工房') {
  return within(screen.getByRole('group', { name: '庭の様子' })).getByRole(
    'button',
    { name },
  )
}

function actorAtlasUrl(repositoryId: string): string {
  const sprite = screen
    .getByTestId(`garden-place-${repositoryId}`)
    .querySelector('.observer-garden-actor-sprite')
  expect(sprite).toBeInstanceOf(HTMLElement)
  return (sprite as HTMLElement).style.backgroundImage
}

function renderGarden(
  overview: TodayOverview | null,
  workspaces: Workspace[] = [],
) {
  return render(
    <ObserverGarden
      overview={overview}
      workspaces={workspaces}
      onOpenWorkshop={vi.fn()}
    />,
  )
}

function overviewOf(
  repositories: TodayOverview['repositories'],
): TodayOverview {
  return {
    generatedAt: '2026-08-19T00:00:00.000Z',
    repositoryCount: repositories.length,
    activeRepositoryCount: repositories.length,
    waitingCount: 0,
    conflictCount: 0,
    repositories,
  }
}

function repository(
  repositoryId: string,
  displayName: string,
  sessions: SessionView[],
  changedFileCount = 0,
  areas: readonly string[] = [],
  extras: {
    readonly latestRecordTitle?: string | null
    readonly workStory?: string | null
    readonly outgoingCount?: number | null
    readonly incomingCount?: number | null
    readonly worktrees?: RepositoryView['worktrees']
  } = {},
): RepositoryView {
  return {
    repositoryId,
    workspaceId: `ws_${repositoryId}`,
    displayName,
    available: true,
    gitAvailable: true,
    summary: '',
    changedFileCount,
    lastChangedLabel: null,
    latestRecordTitle: extras.latestRecordTitle ?? null,
    workStory: extras.workStory ?? null,
    outgoingCount: extras.outgoingCount ?? null,
    incomingCount: extras.incomingCount ?? null,
    sessions,
    worktrees: extras.worktrees ?? [],
    conflicts: [],
    areas: [...areas],
  }
}

type WorktreeFile = RepositoryView['worktrees'][number]['files'][number]

function leftoverFile(
  path: string,
  areaLabel: string,
  changeLabel = '変更',
): WorktreeFile {
  return {
    path,
    changeLabel,
    areaLabel,
    addedLines: null,
    deletedLines: null,
  }
}

function worktreeOf(
  files: readonly WorktreeFile[],
): RepositoryView['worktrees'][number] {
  return {
    path: 'primary',
    isPrimary: true,
    branch: null,
    changedFileCount: files.length,
    returnedFileCount: files.length,
    filesTruncated: false,
    files: [...files],
  }
}

function hatarakiLeftoverFiles(): WorktreeFile[] {
  return [
    leftoverFile('README.md', '作業中のファイル'),
    leftoverFile('src/App.tsx', '画面'),
    leftoverFile('src/office/Office.tsx', '画面'),
    leftoverFile('src/styles.css', '画面'),
    leftoverFile('e2e/garden.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/observer.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/visual-qa.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/workshop.spec.ts', '確認用の仕組み'),
    leftoverFile('e2e/api.spec.ts', '確認用の仕組み'),
    leftoverFile('package.json', '道具の一覧'),
    leftoverFile('e2e/api-fixture-entry.ts', 'API', 'まだ記録していない変更'),
    leftoverFile('e2e/fixtures/', '確認用の仕組み'),
    leftoverFile('server/', '作業中のファイル'),
    leftoverFile('src/live/', '作業中のファイル'),
    leftoverFile('src/office/Desk.tsx', '画面'),
    leftoverFile('playwright.config.ts', '設定'),
    leftoverFile('src/main.tsx', '画面'),
    leftoverFile('server/index.ts', '作業中のファイル'),
  ]
}

function session(
  partial: Partial<SessionView> & Pick<SessionView, 'id' | 'source'>,
): SessionView {
  return {
    displayName: partial.displayName ?? partial.source,
    status: 'idle',
    activity: 'idle',
    attributionConfidence: 'observed',
    title: '作業',
    lastObservedAt: '2026-08-19T00:00:00.000Z',
    lastObservedLabel: null,
    ...partial,
  }
}

function workspace(id: string, employeeName?: string): Workspace {
  return {
    id,
    name: id,
    ...(employeeName ? { employeeName } : {}),
    defaultProviderId: null,
    worldPackId: 'dog-office',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    repository: {
      id: `repo_${id}`,
      absolutePath: `/tmp/${id}`,
      displayName: id,
      currentBranch: 'main',
      remoteName: 'origin',
      remoteUrl: null,
      readable: true,
    },
  }
}
