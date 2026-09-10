import * as schema from './schema';
import { Platform } from 'react-native';

let dbInstance: any = null;
let sqliteInstance: any = null;

const DB_NAME = 'fieldops.db';

// Web stub: in-memory JS object that mimics minimal SQLite API for offline banner
const webMemory: Record<string, any[]> = { outbox: [], jobs: [], invoices: [], sync_meta: [] };
const webDbStub = {
  execAsync: async () => {},
  runAsync: async (sql: string, params: any[]) => {
    // Very minimal handling for outbox count queries
    if (sql.includes('INSERT INTO outbox')) {
      webMemory.outbox.push({ id: params[0], table_name: params[1], record_id: params[2], operation: params[3], payload: params[4], status: 'pending', created_at: params[6] });
    }
  },
  getAllAsync: async (sql: string) => {
    if (sql.includes('FROM outbox')) return webMemory.outbox;
    if (sql.includes('FROM jobs')) return [];
    if (sql.includes('FROM invoices')) return [];
    return [];
  },
  getFirstAsync: async () => null,
};

export async function getDb() {
  if (dbInstance) return dbInstance;
  if (Platform.OS === 'web') {
    // On web, use Supabase directly; no local sqlite
    // Return a drizzle-like stub that does nothing but won't crash bundling
    dbInstance = webDbStub as any;
    return dbInstance;
  }
  // Native: lazy import to avoid bundling on web
  const SQLite = await import('expo-sqlite');
  const { drizzle } = await import('drizzle-orm/expo-sqlite');
  sqliteInstance = await SQLite.openDatabaseAsync(DB_NAME);
  await sqliteInstance.execAsync('PRAGMA journal_mode = WAL;');
  dbInstance = drizzle(sqliteInstance, { schema: schema as any });
  await migrateIfNeeded(sqliteInstance);
  return dbInstance;
}

export function getRawDb(): any {
  if (Platform.OS === 'web') return webDbStub as any;
  if (!sqliteInstance) throw new Error('DB not initialized — call getDb() first');
  return sqliteInstance;
}

async function migrateIfNeeded(db: any) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, logo_url TEXT, abn TEXT, tax_rate REAL DEFAULT 10, subscription_tier TEXT DEFAULT 'free', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, synced INTEGER DEFAULT 0, version INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, company_id TEXT, role TEXT DEFAULT 'technician', display_name TEXT, phone TEXT, avatar_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY NOT NULL, local_id TEXT UNIQUE, company_id TEXT NOT NULL, assigned_to TEXT, customer_name TEXT NOT NULL, customer_phone TEXT, customer_email TEXT, address TEXT NOT NULL, lat REAL, lng REAL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'scheduled', scheduled_at TEXT, started_at TEXT, completed_at TEXT, materials TEXT DEFAULT '[]', notes TEXT, version INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS job_photos (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, company_id TEXT NOT NULL, storage_path TEXT NOT NULL, local_uri TEXT, caption TEXT, taken_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS job_signatures (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, company_id TEXT NOT NULL, storage_path TEXT NOT NULL, signed_by_name TEXT NOT NULL, signed_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS compliance_checklists (id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, fields TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS checklist_submissions (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, checklist_id TEXT NOT NULL, company_id TEXT NOT NULL, responses TEXT DEFAULT '{}', photo_proofs TEXT, signed_by TEXT, signed_at TEXT, result TEXT, created_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, company_id TEXT NOT NULL, invoice_number TEXT NOT NULL, line_items TEXT DEFAULT '[]', subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0, status TEXT DEFAULT 'draft', pdf_path TEXT, payment_link TEXT, paid_at TEXT, created_at TEXT NOT NULL, synced INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, table_name TEXT NOT NULL, record_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER DEFAULT 0, next_retry_at TEXT, status TEXT DEFAULT 'pending', error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, next_retry_at);
  `);
  try { await db.execAsync(`ALTER TABLE invoices ADD COLUMN paid_at TEXT`); } catch {}
}

export async function getTestDb() {
  const SQLite = await import('expo-sqlite');
  const { drizzle } = await import('drizzle-orm/expo-sqlite');
  const db = await SQLite.openDatabaseAsync(':memory:');
  await migrateIfNeeded(db);
  return drizzle(db, { schema: schema as any });
}
