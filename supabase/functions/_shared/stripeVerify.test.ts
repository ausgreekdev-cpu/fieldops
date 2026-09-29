import { parseStripeSigHeader, checkStripeTimestamp, verifyStripeSignature, amountMatchesPaid } from './stripeVerify.ts';

const SECRET = 'whsec_test_secret';

async function sign(t: string, payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('parseStripeSigHeader — single v1', () => {
  const parsed = parseStripeSigHeader('t=1700000000,v1=abcdef');
  assertEquals(parsed?.t, '1700000000');
  assertEquals(parsed?.v1s, ['abcdef']);
});

Deno.test('parseStripeSigHeader — multiple v1s (key rotation) + spaces', () => {
  const parsed = parseStripeSigHeader('t=1700000000, v1=aaa, v1=bbb');
  assertEquals(parsed?.v1s, ['aaa', 'bbb']);
});

Deno.test('parseStripeSigHeader — missing v1 or t → null', () => {
  assertEquals(parseStripeSigHeader('t=1700000000'), null);
  assertEquals(parseStripeSigHeader('v1=abc'), null);
  assertEquals(parseStripeSigHeader(''), null);
  assertEquals(parseStripeSigHeader('garbage'), null);
});

Deno.test('checkStripeTimestamp — 5-minute tolerance', () => {
  const now = 1_700_000_000;
  assertEquals(checkStripeTimestamp(now, now), true);
  assertEquals(checkStripeTimestamp(now - 299, now), true);
  assertEquals(checkStripeTimestamp(now - 301, now), false);
  assertEquals(checkStripeTimestamp(now + 301, now), false);
  assertEquals(checkStripeTimestamp(NaN, now), false);
  assertEquals(checkStripeTimestamp(Infinity, now), false);
});

Deno.test('verifyStripeSignature — accepts valid signature', async () => {
  const t = '1700000000';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const v1 = await sign(t, payload, SECRET);
  const header = `t=${t},v1=${v1}`;
  assertEquals(await verifyStripeSignature(payload, header, SECRET, 1_700_000_000), true);
});

Deno.test('verifyStripeSignature — accepts when a rotated (older) v1 matches', async () => {
  const t = '1700000000';
  const payload = '{}';
  const stale = await sign(t, payload, 'whsec_old');
  const fresh = await sign(t, payload, SECRET);
  const header = `t=${t},v1=${stale},v1=${fresh}`;
  assertEquals(await verifyStripeSignature(payload, header, SECRET, 1_700_000_000), true);
});

Deno.test('verifyStripeSignature — rejects tampered payload', async () => {
  const t = '1700000000';
  const payload = '{"amount":1000}';
  const v1 = await sign(t, payload, SECRET);
  assertEquals(await verifyStripeSignature('{"amount":999999}', `t=${t},v1=${v1}`, SECRET, 1_700_000_000), false);
});

Deno.test('verifyStripeSignature — rejects wrong secret', async () => {
  const t = '1700000000';
  const payload = '{"a":1}';
  const v1 = await sign(t, payload, 'whsec_wrong');
  assertEquals(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, SECRET, 1_700_000_000), false);
});

Deno.test('verifyStripeSignature — rejects expired timestamp (replay)', async () => {
  const t = '1700000000';
  const payload = '{"a":1}';
  const v1 = await sign(t, payload, SECRET);
  assertEquals(await verifyStripeSignature(payload, `t=${t},v1=${v1}`, SECRET, 1_700_000_000 + 301), false);
});

Deno.test('verifyStripeSignature — rejects malformed headers', async () => {
  assertEquals(await verifyStripeSignature('{}', 'not-a-header', SECRET, 1_700_000_000), false);
  assertEquals(await verifyStripeSignature('{}', '', SECRET, 1_700_000_000), false);
});

Deno.test('amountMatchesPaid — exact and 1-cent tolerance', () => {
  assertEquals(amountMatchesPaid(1000, 10), true); // $10.00 → 1000c
  assertEquals(amountMatchesPaid(1001, 10), true); // rounding tolerance
  assertEquals(amountMatchesPaid(999, 10), true);
  assertEquals(amountMatchesPaid(1002, 10), false);
  assertEquals(amountMatchesPaid(0, 0), true);
});

Deno.test('amountMatchesPaid — accepts numeric strings (Stripe sometimes sends them)', () => {
  assertEquals(amountMatchesPaid('1000', 10), true);
  assertEquals(amountMatchesPaid('1999', 19.99), true);
  assertEquals(amountMatchesPaid('2001', 19.99), false); // 2c off — beyond tolerance
});

Deno.test('amountMatchesPaid — fails closed on null / undefined / garbage', () => {
  assertEquals(amountMatchesPaid(null, 10), false);
  assertEquals(amountMatchesPaid(undefined, 10), false);
  assertEquals(amountMatchesPaid('abc', 10), false);
  assertEquals(amountMatchesPaid(NaN, 10), false);
  assertEquals(amountMatchesPaid(1000, NaN), false);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, got ${a}`);
  }
}
