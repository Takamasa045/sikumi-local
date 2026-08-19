import type Database from 'better-sqlite3'

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

export const initialSchemaMigration: Migration = {
  version: 1,
  name: 'initial-domain-schema',
  sql: `
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      default_provider_id TEXT,
      world_pack_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE repositories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
      absolute_path TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      current_branch TEXT,
      remote_name TEXT,
      remote_url TEXT,
      readable INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE employees (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      default_provider_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE employee_instances (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      character_pack_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, employee_id)
    );

    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      execution_connected INTEGER NOT NULL
    );

    CREATE TABLE provider_settings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      selected_model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, provider_id)
    );

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL,
      request TEXT NOT NULL,
      job_type TEXT NOT NULL,
      selected_provider TEXT NOT NULL,
      selected_model TEXT,
      permission_profile TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_session_id TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE provider_sessions (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      run_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      run_id TEXT,
      risk TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE user_questions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      answer TEXT,
      created_at TEXT NOT NULL,
      answered_at TEXT
    );

    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      storage_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE growth_records (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      workspace_id TEXT,
      metric TEXT NOT NULL,
      value INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE world_unlocks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      world_pack_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      UNIQUE (workspace_id, world_pack_id)
    );

    CREATE TABLE audit_entries (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE installed_packs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      version TEXT NOT NULL,
      source_path TEXT,
      installed_at TEXT NOT NULL,
      UNIQUE (kind, pack_id)
    );

    INSERT INTO providers (id, display_name, execution_connected) VALUES
      ('codex', 'Codex', 0),
      ('grok-build', 'Grok Build', 0),
      ('claude-code', 'Claude Code', 0);
  `,
}

export const worktreeGrowthPacksMigration: Migration = {
  version: 2,
  name: 'worktree-growth-packs',
  sql: `
    CREATE TABLE job_worktrees (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      repository_id TEXT NOT NULL,
      worktree_rel_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      include_dirty_patch INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE growth_applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      metric TEXT NOT NULL,
      value INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (job_id, employee_id, scope_key, metric)
    );

    CREATE TABLE world_feature_unlocks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      world_pack_id TEXT NOT NULL,
      unlock_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      UNIQUE (workspace_id, world_pack_id, unlock_id)
    );

    CREATE TABLE pack_previews (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      version TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_display TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      file_summary_json TEXT NOT NULL,
      git_commit TEXT,
      git_changes TEXT,
      staging_rel_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    ALTER TABLE installed_packs ADD COLUMN source_kind TEXT;
    ALTER TABLE installed_packs ADD COLUMN source_display TEXT;
    ALTER TABLE installed_packs ADD COLUMN commit_hash TEXT;
    ALTER TABLE installed_packs ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0;
  `,
}

export const workspaceEmployeeNameMigration: Migration = {
  version: 3,
  name: 'workspace-employee-name',
  sql: `
    ALTER TABLE workspaces ADD COLUMN employee_name TEXT;
    UPDATE workspaces
    SET employee_name = CASE
      WHEN lower(name) LIKE '%blog%' THEN 'ブログ番'
      WHEN lower(name) LIKE '%content%' THEN 'コンテンツ番'
      WHEN lower(name) LIKE '%web%' THEN 'ウェブ番'
      WHEN lower(name) LIKE '%app%' THEN 'アプリ番'
      WHEN name = 'project' THEN 'プロジェクト番'
      ELSE name || '番'
    END;
  `,
}

export const observerFoundationMigration: Migration = {
  version: 4,
  name: 'observer-foundation',
  sql: `
    CREATE TABLE observer_adapters (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      installation_status TEXT NOT NULL,
      installed_version TEXT,
      detected_version TEXT,
      last_event_at TEXT,
      health_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE external_sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      surface TEXT NOT NULL,
      external_session_id TEXT,
      workspace_id TEXT,
      repository_id TEXT,
      cwd TEXT,
      worktree_path TEXT,
      branch TEXT,
      base_commit TEXT,
      head_commit TEXT,
      title TEXT,
      status TEXT NOT NULL,
      activity TEXT NOT NULL,
      attribution_confidence TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE UNIQUE INDEX external_sessions_source_external_id
      ON external_sessions(source, external_session_id)
      WHERE external_session_id IS NOT NULL;

    CREATE TABLE observer_events (
      id TEXT PRIMARY KEY,
      external_session_id TEXT,
      repository_id TEXT,
      source TEXT NOT NULL,
      native_event_type TEXT NOT NULL,
      normalized_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE resource_claims (
      id TEXT PRIMARY KEY,
      external_session_id TEXT,
      repository_id TEXT,
      resource_type TEXT NOT NULL,
      resource_key TEXT NOT NULL,
      action TEXT NOT NULL,
      claim_kind TEXT NOT NULL,
      confidence TEXT NOT NULL,
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX resource_claims_unique_scope
      ON resource_claims(
        IFNULL(external_session_id, ''),
        IFNULL(repository_id, ''),
        resource_type,
        resource_key,
        action,
        claim_kind
      );

    CREATE TABLE repository_snapshots (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT,
      head_commit TEXT,
      base_commit TEXT,
      status_json TEXT NOT NULL,
      changed_files_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE conflict_findings (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL,
      left_session_id TEXT,
      right_session_id TEXT,
      left_worktree_path TEXT,
      right_worktree_path TEXT,
      level TEXT NOT NULL,
      score INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      summary TEXT NOT NULL,
      reason_json TEXT NOT NULL,
      status TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE session_labels (
      id TEXT PRIMARY KEY,
      external_session_id TEXT NOT NULL UNIQUE,
      title TEXT,
      summary TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
}

export const conflictEngineMigration: Migration = {
  version: 5,
  name: 'conflict-engine',
  sql: `
    ALTER TABLE conflict_findings ADD COLUMN identity_key TEXT;
    ALTER TABLE conflict_findings ADD COLUMN headline TEXT;
    ALTER TABLE conflict_findings ADD COLUMN recommendation TEXT;
    ALTER TABLE conflict_findings ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE conflict_findings ADD COLUMN fingerprint TEXT;
    ALTER TABLE conflict_findings ADD COLUMN left_source TEXT;
    ALTER TABLE conflict_findings ADD COLUMN right_source TEXT;
    UPDATE conflict_findings
      SET identity_key = id
      WHERE identity_key IS NULL;
    UPDATE conflict_findings
      SET headline = summary
      WHERE headline IS NULL;
    UPDATE conflict_findings
      SET recommendation = 'こちらから自動操作はしません。'
      WHERE recommendation IS NULL;
    UPDATE conflict_findings
      SET fingerprint = id
      WHERE fingerprint IS NULL;
    CREATE INDEX IF NOT EXISTS conflict_findings_identity_idx
      ON conflict_findings(repository_id, identity_key);
  `,
}

export const conflictAttributionMigration: Migration = {
  version: 6,
  name: 'conflict-side-attribution',
  sql: `
    ALTER TABLE conflict_findings ADD COLUMN left_attribution_confidence TEXT;
    ALTER TABLE conflict_findings ADD COLUMN right_attribution_confidence TEXT;
  `,
}

export const defaultMigrations: readonly Migration[] = [
  initialSchemaMigration,
  worktreeGrowthPacksMigration,
  workspaceEmployeeNameMigration,
  observerFoundationMigration,
  conflictEngineMigration,
  conflictAttributionMigration,
]

export function applyMigrations(
  sqlite: Database.Database,
  migrations: readonly Migration[] = defaultMigrations,
  now: () => string = () => new Date().toISOString(),
): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedRows = sqlite
    .prepare('SELECT version FROM schema_migrations')
    .all() as Array<{ version: number }>
  const applied = new Set(appliedRows.map((row) => row.version))

  const insertMigration = sqlite.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )
  // BEGIN IMMEDIATE so exec() and the version insert commit or roll back
  // together. Connection-level pragmas such as foreign_keys / journal_mode
  // must stay outside this transaction; SQLite ignores or rejects them inside.
  const applyMigration = sqlite.transaction((migration: Migration) => {
    sqlite.exec(migration.sql)
    insertMigration.run(migration.version, migration.name, now())
  })

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue
    }
    applyMigration.immediate(migration)
  }
}
