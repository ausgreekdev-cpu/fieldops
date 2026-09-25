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
import { captureError, addBreadcrumb } from '@/lib/monitoring';
import {
  MAX_ATTEMPTS,
  computeBackoffMs,
  isInvoiceNumberConflict,
  isVersionConflictError,
  nextOutboxStatus,
  pullBoundary,
  resolveJobOperation,
} from './outboxLogic';

// ── Config ──
const BATCH_SIZE = 10;
const PULL_PAGE_SIZE = 200;
const PULL_BOUNDARY_SKEW_MS = 2000;

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
    // Recover rows stranded in 'syncing' by a previous crash/kill.
    try {
      const db = getRawDb();
      await db.runAsync(`UPDATE outbox SET status='pending' WHERE status='syncing'`);
    } catch {}

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
    const isNew = !job.id;
    const id = (job.id as string) || uuid();
    const localId = (job.local_id as string) || id;

    // Version guard: for updates, capture the pre-bump local version so the
    // server can reject the sync if another device edited the job meanwhile.
    let expectedVersion: number | null = null;
    if (!isNew) {
      const cur = (await db.getFirstAsync(`SELECT version FROM jobs WHERE id=?`, [id])) as { version: number } | null;
      if (cur) expectedVersion = cur.version;
    }

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
    const payload: Record<string, unknown> = { ...row, materials: job.materials ?? [] };
    if (expectedVersion !== null) {
      // Local version is now expectedVersion+1 (bumped by the upsert above) —
      // keep payload.version in step with the local row.
      payload.version = expectedVersion + 1;
      payload._expected_version = expectedVersion;
    }
    await this.enqueue('jobs', id, resolveJobOperation(isNew, expectedVersion) as OutboxOp, payload);
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
      // Only 'pending' rows are eligible — 'failed' is terminal until a
      // manual reset (Sync Debug → "Clear Failed") flips it back.
      const rows = (await db.getAllAsync(
        `SELECT * FROM outbox WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT ?`,
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
          const isConflict = isVersionConflictError(e?.message);
          const delay = computeBackoffMs(attempts);
          const nextRetry = new Date(Date.now() + delay).toISOString();
          const status = nextOutboxStatus(attempts, isConflict);
          const error = e?.message?.slice(0, 1000) ?? String(e);
          await db.runAsync(`UPDATE outbox SET attempts=?, next_retry_at=?, status=?, error=? WHERE id=?`, [
            status === 'failed' && isConflict ? MAX_ATTEMPTS : attempts,
            nextRetry,
            status,
            error,
            row.id,
          ]);
          failed++;
          captureError(new Error(`Sync failed ${row.table_name}/${row.record_id}: ${error}`), { table: row.table_name, attempts, conflict: isConflict });
          // Also log to remote sync_logs (needs company_id to pass RLS)
          try {
            let payload: Record<string, unknown> = {};
            try { payload = JSON.parse(row.payload); } catch {}
            const companyId = (payload as any).company_id ?? (row.table_name === 'companies' ? row.record_id : null);
            const { error: logErr } = await this.supabase.from('sync_logs').insert({
              company_id: companyId,
              table_name: row.table_name,
              record_id: row.record_id,
              operation: row.operation,
              payload,
              status: 'failed',
              error,
              attempts,
            });
            if (logErr) captureError(new Error(`sync_logs insert blocked: ${logErr.message}`), { table: row.table_name });
          } catch (logE) {
            captureError(logE, { where: 'sync_logs insert' });
          }
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

    // Jobs updates — version guard: server rejects if another device
    // edited the job since this payload was created (no silent clobber).
    if (table === 'jobs' && row.operation === 'update') {
      const { _expected_version, synced, ...rest } = payload as any;
      if (typeof rest.materials === 'string') {
        try { rest.materials = JSON.parse(rest.materials); } catch {}
      }
      const expected = typeof _expected_version === 'number' ? _expected_version : null;
      if (expected !== null) {
        const { data, error } = await this.supabase.rpc('update_job_safe', { p_job: rest, p_expected_version: expected });
        if (error) {
          // PGRST202 = RPC not deployed yet — fall back to unguarded upsert
          if (error.code === 'PGRST202') {
            const { error: upErr } = await this.supabase.from('jobs').upsert(rest, { onConflict: 'id' });
            if (upErr) throw upErr;
            return;
          }
          throw error;
        }
        // setof returns [] on version conflict
        if (Array.isArray(data) && data.length === 0) {
          throw new Error(`version conflict: another device edited this job (expected v${expected})`);
        }
        return;
      }
      const { error: plainErr } = await this.supabase.from('jobs').upsert(rest, { onConflict: 'id' });
      if (plainErr) throw plainErr;
      return;
    }

    // Companies — logo upload
    if (table === 'companies' && (payload as any)._localLogoUri) {
      const localUri = (payload as any)._localLogoUri as string;
      try {
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists) {
          const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const storagePath = (payload as any).logo_url as string;
          if (storagePath) await this.supabase.storage.from('company-logos').upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: true });
        }
      } catch {}
      const { _localLogoUri, ...rest } = payload as any;
      const { synced, ...clean } = rest;
      const { error } = await this.supabase.from('companies').update(clean).eq('id', row.record_id);
      if (error) throw error;
      return;
    }

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

    // Invoices — handle PDF upload + strip private field
    if (table === 'invoices' && (payload as any)._localPdfUri) {
      const localUri = (payload as any)._localPdfUri as string;
      try {
        const info = await FileSystem.getInfoAsync(localUri);
        if (info.exists) {
          const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const storagePath = (payload as any).pdf_path as string;
          await this.supabase.storage.from('invoices').upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });
        }
      } catch {}
      const { _localPdfUri, ...rest } = payload as any;
      const { synced, ...clean } = rest;
      if (clean.line_items && typeof clean.line_items === 'string') {
        try { clean.line_items = JSON.parse(clean.line_items as string); } catch {}
      }
      await this.upsertInvoice(clean, row.record_id);
      return;
    }

    // Generic table upsert/delete
    if (row.operation === 'delete') {
      const { error } = await this.supabase.from(table).delete().eq('id', row.record_id);
      if (error) throw error;
    } else {
      // Strip local-only fields like synced
      const { synced, ...clean } = payload as any;
      // Ensure jsonb fields are objects
      if (table === 'jobs' && typeof clean.materials === 'string') {
        try { clean.materials = JSON.parse(clean.materials as string); } catch {}
      }
      if (table === 'invoices' && typeof clean.line_items === 'string') {
        try { clean.line_items = JSON.parse(clean.line_items as string); } catch {}
      }
      if (table === 'compliance_checklists' && typeof clean.fields === 'string') {
        try { clean.fields = JSON.parse(clean.fields as string); } catch {}
      }
      const { _localPdfUri, _localPhotoMap, ...finalClean } = clean;
      const { error } = await this.supabase.from(table).upsert(finalClean, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  /**
   * Upsert an invoice. On a unique invoice_number collision (two devices
   * minted the same offline number), renumber via the server function and
   * retry once — keeps local ids stable while server numbers stay unique.
   */
  private async upsertInvoice(clean: Record<string, any>, recordId: string): Promise<void> {
    const { error } = await this.supabase.from('invoices').upsert(clean, { onConflict: 'id' });
    if (!error) return;
    if (!isInvoiceNumberConflict(error)) throw error;

    const { data: newNo, error: rpcErr } = await this.supabase.rpc('next_invoice_number', { target_company: clean.company_id });
    if (rpcErr || typeof newNo !== 'string' || !newNo) throw error;

    const db = getRawDb();
    await db.runAsync(`UPDATE invoices SET invoice_number=? WHERE id=?`, [newNo, recordId]);
    clean.invoice_number = newNo;
    const retry = await this.supabase.from('invoices').upsert(clean, { onConflict: 'id' });
    if (retry.error) throw retry.error;
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
    const lastPulled = metaRow?.value ?? '1970-01-01T00:00:00.000Z';

    let offset = 0;
    let total = 0;
    let maxUpdated = lastPulled;
    // Page through EVERY row newer than the boundary — never stop at the
    // first page (the old limit(200) silently dropped everything after it).
    for (;;) {
      const { data, error } = await this.supabase
        .from(table)
        .select('*')
        .gt('updated_at', lastPulled)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PULL_PAGE_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) await this.applyPulledRow(db, table, r);
      total += data.length;
      const last = data[data.length - 1] as { updated_at?: string };
      if (last.updated_at && last.updated_at > maxUpdated) maxUpdated = last.updated_at;
      if (data.length < PULL_PAGE_SIZE) break;
      offset += PULL_PAGE_SIZE;
    }

    if (total > 0) {
      const boundary = pullBoundary(maxUpdated, lastPulled, PULL_BOUNDARY_SKEW_MS);
      await db.runAsync(`INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
        `last_pull_${table}`,
        boundary,
      ]);
      this.notify();
    }
    return total;
  }

  /**
   * Write a server row into local SQLite. Pending local edits win: rows with
   * synced=0 (unsynced outbox work) are never overwritten by a pull.
   */
  private async applyPulledRow(db: any, table: TableName, row: any): Promise<void> {
    const j = (v: unknown, fallback: string) => (v == null ? fallback : typeof v === 'string' ? v : JSON.stringify(v));
    switch (table) {
      case 'jobs': {
        await db.runAsync(
          `INSERT INTO jobs (id, local_id, company_id, assigned_to, customer_name, customer_phone, address, lat, lng, title, description, status, scheduled_at, materials, notes, version, created_at, updated_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET customer_name=excluded.customer_name, customer_phone=excluded.customer_phone, address=excluded.address, lat=excluded.lat, lng=excluded.lng, title=excluded.title, description=excluded.description, status=excluded.status, scheduled_at=excluded.scheduled_at, materials=excluded.materials, notes=excluded.notes, version=excluded.version, updated_at=excluded.updated_at, synced=1
           WHERE jobs.synced = 1`,
          [
            row.id,
            row.local_id ?? null,
            row.company_id,
            row.assigned_to ?? null,
            row.customer_name,
            row.customer_phone ?? null,
            row.address,
            row.lat ?? null,
            row.lng ?? null,
            row.title,
            row.description ?? null,
            row.status,
            row.scheduled_at ?? null,
            j(row.materials, '[]'),
            row.notes ?? null,
            row.version ?? 1,
            row.created_at,
            row.updated_at,
          ]
        );
        return;
      }
      case 'companies': {
        await db.runAsync(
          `INSERT INTO companies (id, name, logo_url, abn, tax_rate, subscription_tier, created_at, updated_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, logo_url=excluded.logo_url, abn=excluded.abn, tax_rate=excluded.tax_rate, subscription_tier=excluded.subscription_tier, updated_at=excluded.updated_at, synced=1
           WHERE companies.synced = 1`,
          [row.id, row.name, row.logo_url ?? null, row.abn ?? null, row.tax_rate ?? 10, row.subscription_tier ?? 'free', row.created_at, row.updated_at]
        );
        return;
      }
      case 'job_photos': {
        await db.runAsync(
          `INSERT INTO job_photos (id, job_id, company_id, storage_path, local_uri, caption, taken_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET storage_path=excluded.storage_path, caption=excluded.caption, synced=1
           WHERE job_photos.synced = 1`,
          [row.id, row.job_id, row.company_id, row.storage_path, row.local_uri ?? null, row.caption ?? null, row.taken_at]
        );
        return;
      }
      case 'job_signatures': {
        await db.runAsync(
          `INSERT INTO job_signatures (id, job_id, company_id, storage_path, signed_by_name, signed_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET storage_path=excluded.storage_path, synced=1
           WHERE job_signatures.synced = 1`,
          [row.id, row.job_id, row.company_id, row.storage_path, row.signed_by_name, row.signed_at]
        );
        return;
      }
      case 'compliance_checklists': {
        await db.runAsync(
          `INSERT INTO compliance_checklists (id, company_id, name, description, fields, is_active, synced)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, fields=excluded.fields, is_active=excluded.is_active, synced=1
           WHERE compliance_checklists.synced = 1`,
          [row.id, row.company_id, row.name, row.description ?? null, j(row.fields, '[]'), row.is_active ? 1 : 0]
        );
        return;
      }
      case 'checklist_submissions': {
        await db.runAsync(
          `INSERT INTO checklist_submissions (id, job_id, checklist_id, company_id, responses, photo_proofs, signed_by, signed_at, result, created_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET responses=excluded.responses, photo_proofs=excluded.photo_proofs, signed_by=excluded.signed_by, signed_at=excluded.signed_at, result=excluded.result, synced=1
           WHERE checklist_submissions.synced = 1`,
          [
            row.id,
            row.job_id,
            row.checklist_id,
            row.company_id,
            j(row.responses, '{}'),
            j(row.photo_proofs, '[]'),
            row.signed_by ?? null,
            row.signed_at ?? null,
            row.result ?? null,
            row.created_at,
          ]
        );
        return;
      }
      case 'invoices': {
        await db.runAsync(
          `INSERT INTO invoices (id, job_id, company_id, invoice_number, line_items, subtotal, tax, total, status, pdf_path, payment_link, paid_at, created_at, synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET line_items=excluded.line_items, subtotal=excluded.subtotal, tax=excluded.tax, total=excluded.total, status=excluded.status, payment_link=excluded.payment_link, paid_at=excluded.paid_at, synced=1
           WHERE invoices.synced = 1`,
          [
            row.id,
            row.job_id,
            row.company_id,
            row.invoice_number,
            j(row.line_items, '[]'),
            row.subtotal ?? 0,
            row.tax ?? 0,
            row.total ?? 0,
            row.status ?? 'draft',
            row.pdf_path ?? null,
            row.payment_link ?? null,
            row.paid_at ?? null,
            row.created_at,
          ]
        );
        return;
      }
      default:
        return;
    }
  }

  // ── Status / listeners ──
  async getStatusSync(): Promise<SyncStatus> {
    return { isOnline: this.isOnline, isSyncing: this.isSyncing, pendingCount: await this.getPendingCount() };
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
