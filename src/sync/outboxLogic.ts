/**
 * Pure outbox / sync decision logic — no React Native, Supabase or SQLite
 * imports, so it can be unit-tested directly under Jest.
 */

// ── Config ──
export const BASE_DELAY_MS = 1000;
export const MAX_DELAY_MS = 5 * 60 * 1000; // 5 min
export const MAX_ATTEMPTS = 10;

/** Exponential backoff with jitter, capped at MAX_DELAY_MS. */
export function computeBackoffMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS) + Math.random() * 1000;
}

/**
 * Outbox row status after a failed attempt.
 * `failed` is terminal — the row is only re-enabled by a manual reset
 * (Sync Debug → "Clear Failed"). Version conflicts are never retried
 * because replaying the same stale payload can never succeed.
 */
export function nextOutboxStatus(attempts: number, isConflict: boolean): 'pending' | 'failed' {
  if (isConflict || attempts >= MAX_ATTEMPTS) return 'failed';
  return 'pending';
}

export function isVersionConflictError(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.startsWith('version conflict');
}

/** Postgres unique-violation (23505) on the invoice number index. */
export function isInvoiceNumberConflict(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code !== '23505') return false;
  return (error.message ?? '').includes('invoice_number');
}

/**
 * Job outbox operation: only rows with a known pre-edit version are true
 * updates (version-guarded on the server); everything else is an insert.
 */
export function resolveJobOperation(isNew: boolean, expectedVersion: number | null): 'insert' | 'update' {
  return !isNew && expectedVersion !== null ? 'update' : 'insert';
}

/**
 * Keyset boundary for pull(): advance to max(updated_at) minus a small skew
 * so rows sharing the boundary timestamp are re-fetched next cycle (upserts
 * are idempotent). Never moves backwards.
 */
export function pullBoundary(maxUpdatedIso: string, previousIso: string, skewMs = 2000): string {
  const candidate = new Date(new Date(maxUpdatedIso).getTime() - skewMs).toISOString();
  return candidate > previousIso ? candidate : previousIso;
}
