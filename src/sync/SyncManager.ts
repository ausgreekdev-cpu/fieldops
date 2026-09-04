/**
 * SyncManager — Local-first offline queue with exponential backoff
 * Never blocks UI. All writes commit locally first, then queued to outbox.
 * Monitors NetInfo + AppState and drains queue when online.
 *
 * Usage:
 *   const sync = SyncManager.getInstance(supabase, db);
 *   await sync.init();
 *   await sync.enqueue('jobs', recordId, 'insert', payload);
 *   // or helper:
 *   await sync.upsertJob(job);
 */
import NetInfo from '@react-native-community/netinfo';
import { SupabaseClient } from '@supabase/supabase-js';
import * as FileSystem from 'expo-file-system';
import { getRawDb } from '@/db/client';
import type { OutboxOp } from '@/types';

// ── Config ──
const BATCH_SIZE = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 min
const MAX_ATTEMPTS = 10;

type TableName = 'jobs' | 'job_photos' | 'job_signatures' | 'checklist_submissions' | 'compliance_checklists' | 'invoices' | 'companies';

interface OutboxRow {
  id: string;
  table_name: string;
  record_id: string;
  operation: string;
  payload: string;
  attempts: number;
  next_retry_at: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class SyncManager {
  private static instance: SyncManager | null = null;
  private supabase: SupabaseClient;
  private isOnline = false;
  private isSyncing = false;
  private listeners: Set<(s: SyncStatus) => void> = new Set();
  private unsubscribeNetInfo?: () => void;
  private syncInterval?: ReturnType<typeof setInterval>;

  private constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  static getInstance(supabase: SupabaseClient): SyncManager {
    if (!SyncManager.instance) SyncManager.instance = new SyncManager(supabase);
    return SyncManager.instance;
  }

  /** Start NetInfo listener + periodic drain */
  async init(): Promise<void> {
    const state = await NetInfo.fetch();
    this.isOnline = !!state.isConnected;
    this.notify();

    this.unsubscribeNetInfo = NetInfo.addEventListener(state => {
      const wasOnline = this.isOnline;
      this.isOnline = !!state.isConnected;
      this.notify();
      if (!wasOnline && this.isOnline) this.processQueue().catch(console.error);
    });

    // Periodic drain every 30s when online
    this.syncInterval = setInterval(() => {
      if (this.isOnline) this.processQueue().catch(console.error);
    }, 30_000);

    // Initial drain if online
    if (this.isOnline) this.processQueue().catch(console.error);
  }

  destroy() {
    this.unsubscribeNetInfo?.();
    if (this.syncInterval) clearInterval(this.syncInterval);
  }

  // ── Public API: Enqueue ──
  async enqueue(table: TableName, recordId: string, operation: OutboxOp, payload: Record<string, unknown>): Promise<void> {
    const db = getRawDb();
    const id = uuid();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO outbox (id, table_name, record_id, operation, payload, attempts, next_retry_at, status, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?)`,
      [id, table, recordId, operation, JSON.stringify(payload), now, now]
    );
    this.notify();
    if (this.isOnline) this.processQueue().catch(console.error);
  }

  // ── Helpers for common writes (local-first) ──
  async upsertJob(job: Record<string, unknown>): Promise<void> {
    const db = getRawDb();
    const now = new Date().toISOString();
    const id = (job.id as string) || uuid();
    const localId = (job.local_id as string) || id;
    const row = {
      id,
      local_id: localId,
      company_id: job.company_id,
      assigned_to: job.assigned_to ?? null,
      customer_name: job.customer_name,
      customer_phone: job.customer_phone ?? null,
      address: job.address,
      lat: job.lat ?? null,
      lng: job.lng ?? null,
      title: job.title,
      description: job.description ?? null,
      status: job.status ?? 'scheduled',
      scheduled_at: job.scheduled_at ?? null,
      materials: JSON.stringify(job.materials ?? []),
      notes: job.notes ?? null,
      version: (job.version as number) ?? 1,
      created_at: (job.created_at as string) ?? now,
      updated_at: now,
      synced: 0,
    };
    // Upsert locally
    await db.runAsync(
      `INSERT INTO jobs (id, local_id, company_id, assigned_to, customer_name, customer_phone, address, lat, lng, title, description, status, scheduled_at, materials, notes, version, created_at, updated_at, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET customer_name=excluded.customer_name, address=excluded.address, title=excluded.title, status=excluded.status, materials=excluded.materials, notes=excluded.notes, updated_at=excluded.updated_at, synced=0, version=version+1`,
      Object.values(row) as any
    );
    await this.enqueue('jobs', id, (job.id ? 'update' : 'insert') as OutboxOp, { ...row, materials: job.materials ?? [] });
  }

  async queueFileUpload(jobId: string, companyId: string, localUri: string, storagePath: string): Promise<void> {
    // Store photo row locally immediately, file upload queued via outbox
    const db = getRawDb();
    const id = uuid();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO job_photos (id, job_id, company_id, storage_path, local_uri, taken_at, synced) VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [id, jobId, companyId, storagePath, localUri, now]
    );
    await this.enqueue('job_photos', id, 'insert', { id, job_id: jobId, company_id: companyId, storage_path: storagePath, local_uri: localUri, taken_at: now });
  }

  // ── Queue drain ──
  async processQueue(): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing || !this.isOnline) return { synced: 0, failed: 0 };
    this.isSyncing = true;
    let synced = 0;
    let failed = 0;
    try {
      const db = getRawDb();
      const now = new Date().toISOString();
      // Fetch batch ready to retry (pending or failed with nextRetry <= now)
      const rows = (await db.getAllAsync(
        `SELECT * FROM outbox WHERE status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT ?`,
        [now, BATCH_SIZE]
      )) as OutboxRow[];

      // Mark as syncing
      for (const r of rows) {
        await db.runAsync(`UPDATE outbox SET status='syncing' WHERE id=?`, [r.id]);
      }
      this.notify();

      for (const row of rows) {
        try {
          await this.syncRow(row);
          await db.runAsync(`DELETE FROM outbox WHERE id=?`, [row.id]);
          // mark original record synced
          await this.markRecordSynced(row.table_name as TableName, row.record_id);
          synced++;
        } catch (e: any) {
          const attempts = (row.attempts ?? 0) + 1;
          const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS) + Math.random() * 1000;
          const nextRetry = new Date(Date.now() + delay).toISOString();
          const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
          const error = e?.message?.slice(0, 1000) ?? String(e);
          await db.runAsync(`UPDATE outbox SET attempts=?, next_retry_at=?, status=?, error=? WHERE id=?`, [
            attempts,
            nextRetry,
            status,
            error,
            row.id,
          ]);
          failed++;
          // Also log to remote sync_logs if possible
          try {
            await this.supabase.from('sync_logs').insert({
              table_name: row.table_name,
              record_id: row.record_id,
              operation: row.operation,
              payload: JSON.parse(row.payload),
              status: 'failed',
              error,
              attempts,
            });
          } catch {}
        }
      }
    } finally {
      this.isSyncing = false;
      this.notify();
    }
    return { synced, failed };
  }

  private async syncRow(row: OutboxRow): Promise<void> {
    const payload = JSON.parse(row.payload);
    const table = row.table_name;

    // Handle storage uploads for photos/signatures (local_uri -> storage)
    if ((table === 'job_photos' || table === 'job_signatures') && payload.local_uri) {
      const fileInfo = await FileSystem.getInfoAsync(payload.local_uri);
      if (fileInfo.exists) {
        const base64 = await FileSystem.readAsStringAsync(payload.local_uri, { encoding: FileSystem.EncodingType.Base64 });
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const bucket = table === 'job_signatures' ? 'signatures' : 'job-photos';
        const contentType = table === 'job_signatures' ? 'image/png' : 'image/jpeg';
        const { error: uploadErr } = await this.supabase.storage.from(bucket).upload(payload.storage_path, bytes, { contentType, upsert: true });
        if (uploadErr) throw uploadErr;
      }
      const { local_uri, _localPhotoMap, ...rest } = payload as any;
      const { error } = await this.supabase.from(table).upsert(rest, { onConflict: 'id' });
      if (error) throw error;
      return;
    }

    // Checklist submissions — handle embedded photo uploads + strip private field
    if (table === 'checklist_submissions' && (payload as any)._localPhotoMap) {
      const map = (payload as any)._localPhotoMap as Record<string, string>;
      for (const [key, localUri] of Object.entries(map)) {
        try {
          const info = await FileSystem.getInfoAsync(localUri);
          if (info.exists) {
            const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            // Reuse job-photos bucket path if available in photo_proofs, else generic
            const proofs = (payload.photo_proofs as string[]) ?? [];
            const storagePath = proofs.find(p => p.includes(key)) ?? `${(payload as any).company_id}/${(payload as any).job_id}/check_${key}.jpg`;
            await this.supabase.storage.from('job-photos').upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: true });
          }
        } catch {}
      }
      const { _localPhotoMap, ...rest } = payload as any;
      // Also strip synced
      const { synced, ...clean } = rest;
      const { error } = await this.supabase.from('checklist_submissions').upsert(clean, { onConflict: 'id' });
      if (error) throw error;
      return;
    }

    // Generic table upsert/delete
    if (row.operation === 'delete') {
      const { error } = await this.supabase.from(table).delete().eq('id', row.record_id);
      if (error) throw error;
    } else {
      // Strip local-only fields like synced
      const { synced, ...clean } = payload;
      // Ensure materials is jsonb not string if jobs
      if (table === 'jobs' && typeof clean.materials === 'string') {
        try {
          clean.materials = JSON.parse(clean.materials as string);
        } catch {}
      }
      const { error } = await this.supabase.from(table).upsert(clean, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  private async markRecordSynced(table: TableName, recordId: string) {
    try {
      const db = getRawDb();
      const sqliteTable = table === 'job_photos' ? 'job_photos' : table === 'job_signatures' ? 'job_signatures' : table === 'compliance_checklists' ? 'compliance_checklists' : table;
      await db.runAsync(`UPDATE ${sqliteTable} SET synced=1 WHERE id=?`, [recordId]);
    } catch {}
  }

  // ── Pull sync (hydrate from server) ──
  async pull(table: TableName): Promise<number> {
    if (!this.isOnline) return 0;
    const db = getRawDb();
    const metaRow = (await db.getFirstAsync(`SELECT value FROM sync_meta WHERE key=?`, [`last_pull_${table}`])) as
      | { value: string }
      | null;
    const lastPulled = metaRow?.value ?? '1970-01-01T00:00:00Z';

    const { data, error } = await this.supabase.from(table).select('*').gt('updated_at', lastPulled).limit(200);
    if (error) throw error;
    if (!data || data.length === 0) return 0;

    for (const row of data) {
      // Upsert into sqlite — stringify jsonb fields
      if (table === 'jobs') {
        await db.runAsync(
          `INSERT INTO jobs (id, local_id, company_id, assigned_to, customer_name, customer_phone, address, lat, lng, title, description, status, scheduled_at, materials, notes, version, created_at, updated_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET customer_name=excluded.customer_name, status=excluded.status, materials=excluded.materials, notes=excluded.notes, updated_at=excluded.updated_at, synced=1`,
          [
            row.id,
            row.local_id,
            row.company_id,
            row.assigned_to,
            row.customer_name,
            row.customer_phone,
            row.address,
            row.lat,
            row.lng,
            row.title,
            row.description,
            row.status,
            row.scheduled_at,
            JSON.stringify(row.materials ?? []),
            row.notes,
            row.version,
            row.created_at,
            row.updated_at,
          ] as any
        );
      }
      // other tables: generic JSON stash — extend as needed
    }

    const maxUpdated = data.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), lastPulled);
    await db.runAsync(`INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      `last_pull_${table}`,
      maxUpdated,
    ]);
    this.notify();
    return data.length;
  }

  // ── Status / listeners ──
  getStatusSync(): SyncStatus {
    // sync read — caller should use hook for reactive
    return { isOnline: this.isOnline, isSyncing: this.isSyncing, pendingCount: 0 };
  }

  async getPendingCount(): Promise<number> {
    try {
      const db = getRawDb();
      const row = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM outbox WHERE status IN ('pending','failed','syncing')`)) as {
        c: number;
      } | null;
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  }

  subscribe(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async notify() {
    const pendingCount = await this.getPendingCount().catch(() => 0);
    const status: SyncStatus = { isOnline: this.isOnline, isSyncing: this.isSyncing, pendingCount };
    this.listeners.forEach(cb => cb(status));
  }
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
}
