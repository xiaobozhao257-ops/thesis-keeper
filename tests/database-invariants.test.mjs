import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { immutableDatabaseTriggers } from "../app/lib/database-invariants.ts";

function createDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE product_thesis_versions (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, input_text TEXT, core_thesis TEXT,
      horizon_min_months INTEGER, horizon_max_months INTEGER, confidence INTEGER,
      change_type TEXT, structured_payload TEXT, content_hash TEXT, created_at TEXT, confirmed_at TEXT
    );
    CREATE TABLE decision_snapshots (id TEXT PRIMARY KEY, frozen_payload TEXT);
    CREATE TABLE product_assumptions (id TEXT PRIMARY KEY, version_id TEXT, title TEXT);
    CREATE TABLE product_metrics (id TEXT PRIMARY KEY, version_id TEXT, name TEXT);
    CREATE TABLE product_risks (id TEXT PRIMARY KEY, version_id TEXT, title TEXT);
    CREATE TABLE product_trigger_rules (id TEXT PRIMARY KEY, version_id TEXT, name TEXT);
  `);
  immutableDatabaseTriggers.forEach((statement) => db.exec(statement));
  return db;
}

test("confirmed thesis versions and their children are immutable", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO product_thesis_versions (id, status, core_thesis) VALUES (?, ?, ?)").run("v1", "ACTIVE", "original");
  db.prepare("INSERT INTO product_assumptions (id, version_id, title) VALUES (?, ?, ?)").run("a1", "v1", "original");

  assert.throws(() => db.prepare("UPDATE product_thesis_versions SET core_thesis = ? WHERE id = ?").run("changed", "v1"), /IMMUTABLE_VERSION/);
  assert.throws(() => db.prepare("UPDATE product_assumptions SET title = ? WHERE id = ?").run("changed", "a1"), /IMMUTABLE_VERSION/);
  assert.throws(() => db.prepare("DELETE FROM product_assumptions WHERE id = ?").run("a1"), /IMMUTABLE_VERSION/);
  assert.doesNotThrow(() => db.prepare("UPDATE product_thesis_versions SET status = 'SUPERSEDED' WHERE id = 'v1'").run());
});

test("draft children remain editable until confirmation", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO product_thesis_versions (id, status, core_thesis) VALUES (?, ?, ?)").run("draft", "DRAFT", "original");
  db.prepare("INSERT INTO product_metrics (id, version_id, name) VALUES (?, ?, ?)").run("m1", "draft", "original");
  assert.doesNotThrow(() => db.prepare("UPDATE product_metrics SET name = 'edited' WHERE id = 'm1'").run());
  assert.doesNotThrow(() => db.prepare("UPDATE product_thesis_versions SET core_thesis = 'edited' WHERE id = 'draft'").run());
});

test("decision snapshots reject update and deletion", () => {
  const db = createDatabase();
  db.prepare("INSERT INTO decision_snapshots (id, frozen_payload) VALUES (?, ?)").run("snapshot-1", "{}");
  assert.throws(() => db.prepare("UPDATE decision_snapshots SET frozen_payload = ? WHERE id = ?").run("tampered", "snapshot-1"), /IMMUTABLE_SNAPSHOT/);
  assert.throws(() => db.prepare("DELETE FROM decision_snapshots WHERE id = ?").run("snapshot-1"), /IMMUTABLE_SNAPSHOT/);
});
