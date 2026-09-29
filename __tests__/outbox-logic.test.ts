// Unit tests for the pure outbox/sync decision logic (Fixes 1/3/5/9/10).
// Plain require — babel-jest strips the TS types.
const {
  computeBackoffMs,
  nextOutboxStatus,
  isVersionConflictError,
  isInvoiceNumberConflict,
  isConflictRow,
  rebaseJobPayload,
  resolveJobOperation,
  pullBoundary,
  shouldPullNextPage,
  shouldRetryOnManualReset,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
} = require('../src/sync/outboxLogic');

describe('outbox status — failed is terminal', () => {
  it('keeps retrying below MAX_ATTEMPTS', () => {
    expect(nextOutboxStatus(0, false)).toBe('pending');
    expect(nextOutboxStatus(MAX_ATTEMPTS - 1, false)).toBe('pending');
  });
  it('stops retrying at MAX_ATTEMPTS', () => {
    expect(nextOutboxStatus(MAX_ATTEMPTS, false)).toBe('failed');
    expect(nextOutboxStatus(MAX_ATTEMPTS + 40, false)).toBe('failed');
  });
  it('version conflicts fail immediately without burning retries', () => {
    expect(nextOutboxStatus(1, true)).toBe('failed');
  });
});

describe('backoff', () => {
  it('grows exponentially with jitter under 1s', () => {
    expect(computeBackoffMs(0)).toBeGreaterThanOrEqual(1000);
    expect(computeBackoffMs(0)).toBeLessThan(2000);
    expect(computeBackoffMs(4)).toBeGreaterThanOrEqual(16000);
    expect(computeBackoffMs(4)).toBeLessThan(17000);
  });
  it('caps at 5 minutes', () => {
    expect(computeBackoffMs(30)).toBeGreaterThanOrEqual(MAX_DELAY_MS);
    expect(computeBackoffMs(30)).toBeLessThan(MAX_DELAY_MS + 1000);
  });
});

describe('conflict detection', () => {
  it('recognises version conflict messages', () => {
    expect(isVersionConflictError('version conflict: another device edited this job (expected v3)')).toBe(true);
    expect(isVersionConflictError('network offline')).toBe(false);
    expect(isVersionConflictError(null)).toBe(false);
    expect(isVersionConflictError(undefined)).toBe(false);
  });
  it('recognises invoice-number unique violations only', () => {
    const invConflict = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "uniq_invoice_number_company"',
    };
    expect(isInvoiceNumberConflict(invConflict)).toBe(true);
    expect(isInvoiceNumberConflict({ code: '23505', message: 'other unique constraint' })).toBe(false);
    expect(isInvoiceNumberConflict({ code: 'PGRST116', message: 'not found' })).toBe(false);
    expect(isInvoiceNumberConflict({ message: 'invoice_number duplicate' })).toBe(false);
    expect(isInvoiceNumberConflict(null)).toBe(false);
    expect(isInvoiceNumberConflict(undefined)).toBe(false);
  });
});

describe('job operation detection (insert vs update)', () => {
  it('fresh jobs are inserts', () => {
    expect(resolveJobOperation(true, null)).toBe('insert');
    expect(resolveJobOperation(true, 1)).toBe('insert');
  });
  it('existing rows with a known pre-edit version are updates', () => {
    expect(resolveJobOperation(false, 3)).toBe('update');
  });
  it('existing row without version knowledge falls back to insert', () => {
    expect(resolveJobOperation(false, null)).toBe('insert');
  });
});

describe('pull boundary', () => {
  it('applies the timestamp skew', () => {
    expect(pullBoundary('2026-01-01T00:00:10.000Z', '1970-01-01T00:00:00.000Z', 2000)).toBe('2026-01-01T00:00:08.000Z');
  });
  it('never moves backwards', () => {
    expect(pullBoundary('2026-01-01T00:00:01.000Z', '2026-01-01T00:00:05.000Z', 2000)).toBe('2026-01-01T00:00:05.000Z');
  });
  it('boundary is strictly older than max updated_at (rows re-fetched, not skipped)', () => {
    const max = '2026-06-15T12:00:00.000Z';
    expect(pullBoundary(max, '1970-01-01T00:00:00.000Z', 2000) < max).toBe(true);
  });
});

describe('manual failed-reset (banner Retry)', () => {
  it('retries transient failures', () => {
    expect(shouldRetryOnManualReset('network offline')).toBe(true);
    expect(shouldRetryOnManualReset('fetch failed')).toBe(true);
    expect(shouldRetryOnManualReset('attempts exhausted')).toBe(true);
  });
  it('never retries version conflicts', () => {
    expect(shouldRetryOnManualReset('version conflict: another device edited this job (expected v3)')).toBe(false);
  });
  it('treats missing/empty error as retryable', () => {
    expect(shouldRetryOnManualReset(null)).toBe(true);
    expect(shouldRetryOnManualReset(undefined)).toBe(true);
    expect(shouldRetryOnManualReset('')).toBe(true);
  });
});

describe('pull pagination decision', () => {
  it('continues while pages are full and under the cap', () => {
    expect(shouldPullNextPage(200, 200, 200, 2000)).toBe(true);
    expect(shouldPullNextPage(1800, 200, 200, 2000)).toBe(true);
  });
  it('stops on a partial page (no more rows)', () => {
    expect(shouldPullNextPage(250, 50, 200, 2000)).toBe(false);
    expect(shouldPullNextPage(0, 0, 200, 2000)).toBe(false);
  });
  it('stops at the per-cycle row cap (boundary resumes next cycle)', () => {
    expect(shouldPullNextPage(2000, 200, 200, 2000)).toBe(false);
    expect(shouldPullNextPage(2200, 200, 200, 2000)).toBe(false);
  });
  it('stops after a full page once the cap is already reached', () => {
    expect(shouldPullNextPage(100, 100, 100, 50)).toBe(false);
    expect(shouldPullNextPage(50, 100, 100, 50)).toBe(false); // page itself pushed us to the cap
  });
});

describe('conflict row detection (manual resolution)', () => {
  const conflictMsg = 'version conflict: another device edited this job (expected v3)';
  it('matches only terminal failed rows with a conflict error', () => {
    expect(isConflictRow('failed', conflictMsg)).toBe(true);
  });
  it('does not match pending/syncing rows or other failures', () => {
    expect(isConflictRow('pending', conflictMsg)).toBe(false);
    expect(isConflictRow('syncing', conflictMsg)).toBe(false);
    expect(isConflictRow('failed', 'network offline')).toBe(false);
    expect(isConflictRow('failed', null)).toBe(false);
    expect(isConflictRow('failed', undefined)).toBe(false);
    expect(isConflictRow(null, null)).toBe(false);
  });
});

describe('rebaseJobPayload (conflict resolution)', () => {
  const payload = JSON.stringify({ id: 'j1', title: 'Paint job', _expected_version: 3, synced: 0 });

  it('"mine": rebases onto the server version, keeping all fields', () => {
    const out = JSON.parse(rebaseJobPayload(payload, 7)!);
    expect(out._expected_version).toBe(7);
    expect(out.id).toBe('j1');
    expect(out.title).toBe('Paint job');
  });
  it('"mine" with server row deleted: strips the version guard (plain upsert recreates)', () => {
    const out = JSON.parse(rebaseJobPayload(payload, null)!);
    expect('_expected_version' in out).toBe(false);
    expect(out.id).toBe('j1');
  });
  it('rejects invalid server versions', () => {
    expect(rebaseJobPayload(payload, 0)).toBeNull();
    expect(rebaseJobPayload(payload, -1)).toBeNull();
    expect(rebaseJobPayload(payload, 2.5)).toBeNull();
    expect(rebaseJobPayload(payload, NaN)).toBeNull();
  });
  it('rejects malformed payload JSON', () => {
    expect(rebaseJobPayload('not-json{', 4)).toBeNull();
    expect(rebaseJobPayload('', 4)).toBeNull();
  });
});
