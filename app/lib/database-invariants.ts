const immutableVersionChildren = [
  "product_assumptions",
  "product_metrics",
  "product_risks",
  "product_trigger_rules",
] as const;

export const immutableDatabaseTriggers = [
  `CREATE TRIGGER IF NOT EXISTS prevent_confirmed_version_content_update
    BEFORE UPDATE OF input_text, core_thesis, horizon_min_months, horizon_max_months, confidence,
      change_type, structured_payload, content_hash, created_at, confirmed_at
    ON product_thesis_versions
    WHEN OLD.status != 'DRAFT'
    BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END`,
  `CREATE TRIGGER IF NOT EXISTS prevent_confirmed_version_status_update
    BEFORE UPDATE OF status ON product_thesis_versions
    WHEN OLD.status != 'DRAFT' AND NOT (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
    BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END`,
  `CREATE TRIGGER IF NOT EXISTS prevent_decision_snapshot_update
    BEFORE UPDATE ON decision_snapshots
    BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT'); END`,
  `CREATE TRIGGER IF NOT EXISTS prevent_decision_snapshot_delete
    BEFORE DELETE ON decision_snapshots
    BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT'); END`,
  ...immutableVersionChildren.flatMap((table) => [
    `CREATE TRIGGER IF NOT EXISTS prevent_${table}_confirmed_update
      BEFORE UPDATE ON ${table}
      WHEN EXISTS (SELECT 1 FROM product_thesis_versions version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END`,
    `CREATE TRIGGER IF NOT EXISTS prevent_${table}_confirmed_delete
      BEFORE DELETE ON ${table}
      WHEN EXISTS (SELECT 1 FROM product_thesis_versions version WHERE version.id = OLD.version_id AND version.status != 'DRAFT')
      BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VERSION'); END`,
  ]),
] as const;
