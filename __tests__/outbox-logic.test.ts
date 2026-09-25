// Unit tests for the pure outbox/sync decision logic (Fixes 1/3/5/9/10).
// Plain require — babel-jest strips the TS types.
const {
  computeBackoffMs,
  nextOutboxStatus,
  isVersionConflictError,
  isInvoiceNumberConflict,
  resolveJobOperation,
  pullBoundary,
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
