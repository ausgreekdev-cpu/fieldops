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

/**
 * Should a terminal `failed` row be re-enabled by a manual "Retry" reset?
 * Version conflicts are excluded — replaying the same stale payload can
 * never succeed; they need the newer server row pulled + a fresh edit.
 */
export function shouldRetryOnManualReset(error: string | null | undefined): boolean {
  return !isVersionConflictError(error);
}

/** A row the user must resolve manually: terminal failure caused by a version conflict. */
export function isConflictRow(status: string | null | undefined, error: string | null | undefined): boolean {
  return status === 'failed' && isVersionConflictError(error);
}

/**
 * Rebase a conflicted job outbox payload for a manual resolution:
 * - `serverVersion = n` → retry against the server's current version (keep
 *   local edit, overwrite the other device);
 * - `serverVersion = null` → strip the version guard so the plain upsert
 *   path recreates the row (it was deleted server-side).
 * Returns the new JSON payload, or null when input/version is invalid.
 */
export function rebaseJobPayload(payloadJson: string, serverVersion: number | null): string | null {
  try {
    const p = JSON.parse(payloadJson);
    if (serverVersion === null) {
      delete p._expected_version;
    } else {
      if (!Number.isInteger(serverVersion) || serverVersion < 1) return null;
      p._expected_version = serverVersion;
    }
    return JSON.stringify(p);
  } catch {
    return null;
  }
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

/**
 * Pull loop: fetch another page only when the current page was full and the
 * per-cycle row cap isn't hit. The boundary still advances (see pull()), so
 * a capped cycle resumes exactly where it stopped on the next run.
 */
export function shouldPullNextPage(totalAfterPage: number, pageLen: number, pageSize: number, maxRows: number): boolean {
  if (pageLen < pageSize) return false;
  return totalAfterPage < maxRows;
}
