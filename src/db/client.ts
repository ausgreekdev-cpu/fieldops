import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sqliteInstance: SQLite.SQLiteDatabase | null = null;

const DB_NAME = 'fieldops.db';

export async function getDb() {
  if (dbInstance) return dbInstance;
  sqliteInstance = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL for better concurrency on-device
  await sqliteInstance.execAsync('PRAGMA journal_mode = WAL;');
  dbInstance = drizzle(sqliteInstance, { schema });
  await migrateIfNeeded(sqliteInstance);
  return dbInstance;
}

export function getRawDb(): SQLite.SQLiteDatabase {
  if (!sqliteInstance) throw new Error('DB not initialized — call getDb() first');
  return sqliteInstance;
}

async function migrateIfNeeded(db: SQLite.SQLiteDatabase) {
  // Minimal inline migrations — for production prefer drizzle-kit generated SQL imported here
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, logo_url TEXT, abn TEXT, tax_rate REAL DEFAULT 10, subscription_tier TEXT DEFAULT 'free', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, synced INTEGER DEFAULT 0, version INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, company_id TEXT, role TEXT DEFAULT 'technician', display_name TEXT, phone TEXT, avatar_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY NOT NULL, local_id TEXT UNIQUE, company_id TEXT NOT NULL, assigned_to TEXT, customer_name TEXT NOT NULL, customer_phone TEXT, customer_email TEXT, address TEXT NOT NULL, lat REAL, lng REAL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'scheduled', scheduled_at TEXT, started_at TEXT, completed_at TEXT, materials TEXT DEFAULT '[]', notes TEXT, version INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS job_photos (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, company_id TEXT NOT NULL, storage_path TEXT NOT NULL, local_uri TEXT, caption TEXT, taken_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS job_signatures (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, company_id TEXT NOT NULL, storage_path TEXT NOT NULL, signed_by_name TEXT NOT NULL, signed_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS compliance_checklists (id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, fields TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS checklist_submissions (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, checklist_id TEXT NOT NULL, company_id TEXT NOT NULL, responses TEXT DEFAULT '{}', photo_proofs TEXT, signed_by TEXT, signed_at TEXT, result TEXT, created_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, company_id TEXT NOT NULL, invoice_number TEXT NOT NULL, line_items TEXT DEFAULT '[]', subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0, status TEXT DEFAULT 'draft', pdf_path TEXT, payment_link TEXT, created_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, table_name TEXT NOT NULL, record_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER DEFAULT 0, next_retry_at TEXT, status TEXT DEFAULT 'pending', error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, next_retry_at);
  `);
}

// For tests — in-memory
export async function getTestDb() {
  const db = await SQLite.openDatabaseAsync(':memory:');
  await migrateIfNeeded(db);
  return drizzle(db, { schema });
}
