import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;
type SqlValue = null | number | bigint | string | Uint8Array;

// Loaded lazily so `quietWarnings` (imported first by the entry point) can
// filter Node's one-time "SQLite is experimental" warning.
const require = createRequire(import.meta.url);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	dsn_key TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS issues (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	fingerprint TEXT NOT NULL,
	title TEXT NOT NULL,
	culprit TEXT,
	level TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'unresolved',
	resolved_release TEXT,
	resolved_at INTEGER,
	first_seen INTEGER NOT NULL,
	last_seen INTEGER NOT NULL,
	event_count INTEGER NOT NULL DEFAULT 0,
	last_release TEXT,
	last_alert_at INTEGER,
	UNIQUE (project_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS events (
	id TEXT PRIMARY KEY,
	issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
	project_id TEXT NOT NULL,
	received_at INTEGER NOT NULL,
	level TEXT NOT NULL,
	release TEXT,
	environment TEXT,
	platform TEXT,
	payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_issue_received ON events (issue_id, received_at);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	url TEXT NOT NULL,
	auth_mode TEXT NOT NULL,
	secret TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL,
	type TEXT NOT NULL,
	suppressed INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_project_created ON alerts (project_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
	endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	next_attempt_at INTEGER,
	response_status INTEGER,
	error TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_pending ON webhook_deliveries (status, next_attempt_at);
`;

export function openDb(dbPath: string): Db {
	if (dbPath !== ":memory:") {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	}
	const { DatabaseSync: Database } =
		require("node:sqlite") as typeof import("node:sqlite");
	const db = new Database(dbPath);
	db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
	db.exec(SCHEMA);
	return db;
}

export function get<T>(db: Db, sql: string, ...params: SqlValue[]) {
	return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(db: Db, sql: string, ...params: SqlValue[]) {
	return db.prepare(sql).all(...params) as T[];
}

export function run(db: Db, sql: string, ...params: SqlValue[]) {
	const result = db.prepare(sql).run(...params);
	return {
		changes: Number(result.changes),
		lastInsertRowid: Number(result.lastInsertRowid),
	};
}

export function transaction<T>(db: Db, fn: () => T): T {
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = fn();
		db.exec("COMMIT");
		return result;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}
