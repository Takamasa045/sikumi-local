import type { CSSProperties } from 'react';
import type { TodayOverview } from '../../api/observer';
import { gardenStationLabels, getWorldPack } from '../../garden/worlds';

const WORLD_ID = 'dog-office' as const;
const ATLAS_COLUMNS = 3;
const ATLAS_ROWS = 4;
const ATLAS_X_PERCENTS = ['0%', '50%', '100%'] as const;
const ATLAS_Y_PERCENTS = ['0%', '33.333%', '66.667%', '100%'] as const;

const STATION_IDS = [
  'archive',
  'observatory',
  'workbench',
  'delivery',
  'waiting',
  'rest',
] as const;

const STATION_SLOT_OFFSETS = [
  [-12, 0],
  [12, 0],
  [-7, 11],
  [7, 11],
  [0, -10],
] as const;

type StationId = (typeof STATION_IDS)[number];
type AgentStation = 'observatory' | 'workbench' | 'delivery' | 'waiting';
type ActorTone = 'waiting' | 'working' | 'completed' | 'observing';

type ObserverGardenProps = {
  overview: TodayOverview | null;
  onOpenWorkshop: () => void;
  onOpenSettings: () => void;
};

type OverviewRepository = TodayOverview['repositories'][number];
type OverviewSession = OverviewRepository['sessions'][number];

type GardenActor = {
  key: string;
  session: OverviewSession;
  repository: OverviewRepository;
  station: AgentStation;
  tone: ActorTone;
  column: number;
  row: number;
  slot: number;
  jitterX: number;
  jitterY: number;
  sourceDisplayName: string;
  sessionDisplayName: string;
};

type BulletinItem = {
  key: string;
  repository: OverviewRepository;
};

const KNOWN_SOURCE_LABELS: Record<string, string> = {
  aider: 'Aider',
  anthropic: 'Claude',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claudeアプリ',
  codex: 'Codex',
  continue: 'Continue',
  copilot: 'GitHub Copilot',
  cursor: 'Cursor',
  gemini: 'Gemini',
  grok: 'Grok Build',
  'grok-build': 'Grok Build',
  local: 'ローカル',
  observer: '観測',
  openai: 'OpenAI',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
};

const SOURCE_COLUMN: Record<string, number> = {
  anthropic: 0,
  claude: 0,
  'claude-code': 0,
  'claude-desktop': 0,
  codex: 0,
  copilot: 1,
  cursor: 1,
  vscode: 1,
  windsurf: 1,
  chatgpt: 2,
  gemini: 2,
  grok: 2,
  'grok-build': 2,
  openai: 2,
};

const TONE_LABELS: Record<ActorTone, string> = {
  waiting: '確認待ち',
  working: '作業中',
  completed: '完了',
  observing: '観測中',
};

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceKey(source: string | null | undefined): string {
  return (source ?? '').trim().toLowerCase();
}

function knownSourceLabel(source: string | null | undefined): string | null {
  const key = sourceKey(source);
  if (!key) return null;
  return KNOWN_SOURCE_LABELS[key] ?? null;
}

function atlasColumnForSource(source: string | null | undefined): number {
  const key = sourceKey(source);
  const mapped = SOURCE_COLUMN[key];
  if (mapped != null) return mapped % ATLAS_COLUMNS;
  return stableHash(`source:${key}`) % ATLAS_COLUMNS;
}

function atlasPosition(column: number, row: number): { x: string; y: string } {
  const x = ATLAS_X_PERCENTS[column] ?? ATLAS_X_PERCENTS[0];
  const y = ATLAS_Y_PERCENTS[row] ?? ATLAS_Y_PERCENTS[0];
  return { x, y };
}

function includesToken(value: string, token: string): boolean {
  return value.includes(token);
}

function resolveTone(
  status: string | null | undefined,
  activity: string | null | undefined,
): ActorTone {
  const haystack = `${status ?? ''} ${activity ?? ''}`.toLowerCase();
  if (includesToken(haystack, 'waiting')) return 'waiting';
  if (
    includesToken(haystack, 'running') ||
    includesToken(haystack, 'working') ||
    includesToken(haystack, 'active')
  ) {
    return 'working';
  }
  if (includesToken(haystack, 'completed') || includesToken(haystack, 'finished')) {
    return 'completed';
  }
  return 'observing';
}

function stationForTone(tone: ActorTone): AgentStation {
  if (tone === 'waiting') return 'waiting';
  if (tone === 'working') return 'workbench';
  if (tone === 'completed') return 'delivery';
  return 'observatory';
}

function isVisibleDog(session: OverviewSession): boolean {
  return sourceKey(session.source) !== 'git' && session.attributionConfidence !== 'inferred';
}

function isUnconfirmedChange(session: OverviewSession): boolean {
  return sourceKey(session.source) === 'git' || session.attributionConfidence === 'inferred';
}

function stationPoint(
  stations: ReturnType<typeof getWorldPack>['stations'],
  id: StationId,
): { x: number; y: number } {
  const point = stations[id];
  return {
    x: point?.x ?? 50,
    y: point?.y ?? 50,
  };
}

function sessionVisibleName(session: OverviewSession): string {
  const named = session.displayName?.trim();
  if (named) return named;
  return session.title?.trim() || '無題';
}

function actorNames(session: OverviewSession): {
  sourceDisplayName: string;
  sessionDisplayName: string;
} {
  const sessionDisplayName = sessionVisibleName(session);
  const mapped = knownSourceLabel(session.source);
  return {
    sourceDisplayName: mapped ?? sessionDisplayName,
    sessionDisplayName,
  };
}

function collectGardenState(overview: TodayOverview | null): {
  actors: GardenActor[];
  bulletin: BulletinItem[];
} {
  const actors: GardenActor[] = [];
  const bulletin: BulletinItem[] = [];
  const seenRepositories = new Set<string>();
  const repositories = overview?.repositories ?? [];

  for (const repository of repositories) {
    const sessions = repository.sessions ?? [];
    let hasUnconfirmed = false;

    for (const session of sessions) {
      if (isUnconfirmedChange(session)) {
        hasUnconfirmed = true;
        continue;
      }
      if (!isVisibleDog(session)) continue;

      const hash = stableHash(`${repository.repositoryId}|${session.id}`);
      const tone = resolveTone(session.status, session.activity);
      const names = actorNames(session);
      actors.push({
        key: `${repository.repositoryId}:${session.id}`,
        session,
        repository,
        station: stationForTone(tone),
        tone,
        column: atlasColumnForSource(session.source),
        row: hash % ATLAS_ROWS,
        slot: 0,
        jitterX: ((hash % 7) - 3) * 0.18,
        jitterY: (((hash >>> 4) % 5) - 2) * 0.14,
        sourceDisplayName: names.sourceDisplayName,
        sessionDisplayName: names.sessionDisplayName,
      });
    }

    if (hasUnconfirmed && !seenRepositories.has(repository.repositoryId)) {
      seenRepositories.add(repository.repositoryId);
      bulletin.push({
        key: repository.repositoryId,
        repository,
      });
    }
  }

  const slotCursor = new Map<AgentStation, number>();
  actors.sort((left, right) => left.key.localeCompare(right.key));
  for (const actor of actors) {
    const next = slotCursor.get(actor.station) ?? 0;
    actor.slot = next;
    slotCursor.set(actor.station, next + 1);
  }

  return { actors, bulletin };
}

function actorAriaLabel(actor: GardenActor): string {
  const title = actor.session.title?.trim();
  return [
    actor.sourceDisplayName,
    actor.sessionDisplayName,
    ...(title ? [title] : []),
    actor.repository.displayName,
    TONE_LABELS[actor.tone],
    actor.session.lastObservedLabel || 'さっきまで',
  ].join('、');
}

function actorOffset(actor: GardenActor): { x: number; y: number } {
  const slot = STATION_SLOT_OFFSETS[actor.slot % STATION_SLOT_OFFSETS.length] ?? STATION_SLOT_OFFSETS[0]!;
  const lap = Math.floor(actor.slot / STATION_SLOT_OFFSETS.length);
  const waitingX =
    actor.station === 'waiting'
      ? typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 760px)').matches
        ? 12
        : 28
      : 0;
  return {
    x: slot[0] + actor.jitterX + lap * 3 + waitingX,
    y: slot[1] + actor.jitterY + lap * 2,
  };
}

export function ObserverGarden({
  overview,
  onOpenWorkshop,
  onOpenSettings,
}: ObserverGardenProps) {
  const world = getWorldPack(WORLD_ID);
  const { actors, bulletin } = collectGardenState(overview);

  const gardenStyle: CSSProperties = {
    backgroundImage: `url("${world.backgroundUrl}")`,
  };

  return (
    <section
      className="observer-garden observer-garden--satoyama"
      role="region"
      aria-label="観測の庭"
      style={gardenStyle}
    >
      <div className="observer-garden-mist" aria-hidden="true" />

      <header className="observer-garden-nav">
        <div className="observer-garden-heading-group">
          <h2 className="observer-garden-heading">観測の庭</h2>
          <p className="observer-garden-sign">犬たちの里山アトリエ</p>
        </div>
        <div className="observer-garden-nav-actions">
          <button
            type="button"
            className="observer-garden-nav-button observer-garden-nav-workshop"
            onClick={onOpenWorkshop}
          >
            今日の作業場
          </button>
          <button
            type="button"
            className="observer-garden-nav-button observer-garden-nav-settings"
            onClick={onOpenSettings}
          >
            設定
          </button>
        </div>
      </header>

      <div className="observer-garden-ground">
        {STATION_IDS.map((id) => {
          const point = stationPoint(world.stations, id);
          const label = gardenStationLabels[id];
          return (
            <div
              key={id}
              className={`observer-garden-station observer-garden-station--${id}`}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <span className="observer-garden-station-pill">{label}</span>
            </div>
          );
        })}

        {bulletin.length > 0 ? (
          <aside className="observer-garden-bulletin">
            <h3 className="observer-garden-bulletin-title">出どころ未確認の変更</h3>
            <ul
              className="observer-garden-bulletin-list"
              role="list"
              aria-label="出どころ未確認の変更"
            >
              {bulletin.map((item) => (
                <li key={item.key} className="observer-garden-bulletin-item">
                  <span className="observer-garden-bulletin-repo">
                    {item.repository.displayName}
                  </span>
                  <span className="observer-garden-bulletin-label">出どころ未確認の変更</span>
                  <span className="observer-garden-bulletin-count">
                    {item.repository.changedFileCount} 件
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        {actors.length > 0 ? (
          <div
            className="observer-garden-actors"
            role="list"
            aria-label="観測中のエージェント"
          >
            {actors.map((actor) => {
              const point = stationPoint(world.stations, actor.station);
              const offset = actorOffset(actor);
              const title = actor.session.title?.trim();
              const atlas = atlasPosition(actor.column, actor.row);
              const spriteStyle = {
                '--observer-atlas-x': atlas.x,
                '--observer-atlas-y': atlas.y,
                '--observer-atlas-columns': String(ATLAS_COLUMNS),
                '--observer-atlas-rows': String(ATLAS_ROWS),
                backgroundImage: `url("${world.character.atlasUrl}")`,
              } as CSSProperties;
              const actorStyle: CSSProperties = {
                left: `calc(${point.x}% + ${offset.x}%)`,
                top: `calc(${point.y}% + ${offset.y}%)`,
                zIndex: Math.max(1, Math.round(point.y + offset.y)),
              };

              return (
                <article
                  key={actor.key}
                  className={`observer-garden-actor observer-garden-actor--${actor.station}`}
                  role="listitem"
                  aria-label={actorAriaLabel(actor)}
                  data-source={actor.session.source}
                  data-status={actor.tone}
                  data-station={actor.station}
                  style={actorStyle}
                >
                  <div className="observer-garden-actor-sprite" style={spriteStyle} />
                  <div className="observer-garden-bubble">
                    <p className="observer-garden-bubble-session">{actor.sessionDisplayName}</p>
                    <p className="observer-garden-bubble-source">{actor.sourceDisplayName}</p>
                    {title ? (
                      <p className="observer-garden-bubble-title">{title}</p>
                    ) : null}
                    <p className="observer-garden-bubble-repo">{actor.repository.displayName}</p>
                    <p className="observer-garden-bubble-status">{TONE_LABELS[actor.tone]}</p>
                    <p className="observer-garden-bubble-observed">
                      {actor.session.lastObservedLabel || 'さっきまで'}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="observer-garden-guide">
            各AIアプリで作業を始めると、観測できたエージェントがここに現れます
          </p>
        )}
      </div>
    </section>
  );
}

export default ObserverGarden;
