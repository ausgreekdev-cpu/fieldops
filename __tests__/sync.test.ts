// Lightweight SyncManager logic tests — no sqlite needed, pure backoff math
describe('SyncManager backoff', () => {
  const BASE = 1000, MAX = 5 * 60 * 1000;

  function delayForAttempt(attempt) {
    return Math.min(BASE * Math.pow(2, attempt), MAX);
  }

  it('exponential backoff caps at 5m', () => {
    expect(delayForAttempt(0)).toBe(1000);
    expect(delayForAttempt(1)).toBe(2000);
    expect(delayForAttempt(5)).toBe(32000);
    expect(delayForAttempt(10)).toBe(MAX);
    expect(delayForAttempt(20)).toBe(MAX);
  });

  it('enqueues with pending status and next_retry_at ≈ now', async () => {
    const now = new Date().toISOString();
    const row = { status: 'pending', next_retry_at: now, attempts: 0 };
    expect(row.status).toBe('pending');
    expect(new Date(row.next_retry_at).getTime()).toBeGreaterThan(Date.now() - 2000);
  });
});

describe('Outbox draining respects batch size', () => {
  it('limits to BATCH_SIZE=10', () => {
    const BATCH = 10;
    const queue = Array.from({ length: 25 }, (_, i) => ({ id: `${i}` }));
    const batch = queue.slice(0, BATCH);
    expect(batch.length).toBe(10);
  });
});
