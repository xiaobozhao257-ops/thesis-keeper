import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

function applyMigration(db, migrationDirectory, name) {
  const migration = readFileSync(new URL(name, migrationDirectory), "utf8");
  migration.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean).forEach((statement) => db.exec(statement));
}

test("all migrations apply from an empty database with immutable triggers", () => {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort().forEach((name) => {
    applyMigration(db, migrationDirectory, name);
  });

  const tables = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get();
  const triggers = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger'").get();
  assert.equal(tables.count, 16);
  assert.equal(triggers.count, 12);
  const thesisColumns = db.prepare("PRAGMA table_info(product_theses)").all().map((column) => column.name);
  assert.ok(thesisColumns.includes("data_mode"));
  assert.ok(thesisColumns.includes("status"));
  assert.ok(thesisColumns.includes("predecessor_thesis_id"));
  assert.ok(thesisColumns.includes("closed_at"));
  const thesisIndexes = db.prepare("PRAGMA index_list(product_theses)").all().map((index) => index.name);
  assert.ok(thesisIndexes.includes("idx_product_theses_owner_mode_status"));
  const workflowColumns = db.prepare("PRAGMA table_info(workflow_runs)").all().map((column) => column.name);
  assert.ok(workflowColumns.includes("input_tokens"));
  assert.ok(workflowColumns.includes("output_tokens"));
  assert.ok(workflowColumns.includes("estimated_cost_cny"));

  db.prepare("INSERT INTO decision_snapshots (id, session_id, action, reason, confidence, thesis_version_id, health_score, frozen_payload, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("s1", "session", "HOLD", "reason", 50, "v1", 80, "{}", "hash", "2026-08-12");
  assert.throws(() => db.prepare("DELETE FROM decision_snapshots WHERE id = 's1'").run(), /IMMUTABLE_SNAPSHOT/);

  // 计划外行动记录：两列以可加迁移方式引入，旧的 10 列 INSERT 必须仍然落到 PLANNED_REVIEW。
  const snapshotColumns = db.prepare("PRAGMA table_info(decision_snapshots)").all().map((column) => column.name);
  assert.ok(snapshotColumns.includes("record_type"));
  assert.ok(snapshotColumns.includes("trigger_source"));
  const legacyRow = db.prepare("SELECT record_type, trigger_source FROM decision_snapshots WHERE id = 's1'").get();
  assert.equal(legacyRow.record_type, "PLANNED_REVIEW");
  assert.equal(legacyRow.trigger_source, null);

  db.prepare("INSERT INTO decision_snapshots (id, session_id, action, reason, confidence, thesis_version_id, health_score, frozen_payload, content_hash, record_type, trigger_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("s2", "session", "ADD", "追高了", 70, "v1", 80, "{}", "hash2", "UNPLANNED_ACTION", "PRICE_MOVE", "2026-08-12");
  const unplannedRow = db.prepare("SELECT record_type, trigger_source FROM decision_snapshots WHERE id = 's2'").get();
  assert.equal(unplannedRow.record_type, "UNPLANNED_ACTION");
  assert.equal(unplannedRow.trigger_source, "PRICE_MOVE");
  assert.throws(() => db.prepare("UPDATE decision_snapshots SET reason = 'x' WHERE id = 's2'").run(), /IMMUTABLE_SNAPSHOT/);

  db.prepare(`INSERT INTO product_theses
    (id, owner_id, instrument_name, canonical_code, asset_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run("real-1", "owner", "真实标的", "600000.XSHG", "EQUITY", "2026-08-14", "2026-08-14");
  const realThesis = db.prepare("SELECT data_mode, status FROM product_theses WHERE id = 'real-1'").get();
  assert.equal(realThesis.data_mode, "REAL");
  assert.equal(realThesis.status, "ACTIVE");
});

test("the Alpha migration marks every pre-existing P0 thesis as demo data", () => {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  migrations.filter((name) => name < "0003").forEach((name) => applyMigration(db, migrationDirectory, name));
  db.prepare(`INSERT INTO product_theses
    (id, owner_id, instrument_name, canonical_code, asset_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("legacy-demo", "owner", "华星智算", "CN.DEMO.HXZS", "EQUITY", "2026-08-12", "2026-08-12");

  applyMigration(db, migrationDirectory, migrations.find((name) => name.startsWith("0003_")));

  const migrated = db.prepare("SELECT data_mode, status FROM product_theses WHERE id = 'legacy-demo'").get();
  assert.equal(migrated.data_mode, "DEMO");
  assert.equal(migrated.status, "ACTIVE");
});
