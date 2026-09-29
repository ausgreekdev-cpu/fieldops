// deno-lint-ignore-file no-explicit-any
/**
 * Pure/testable Stripe webhook primitives — HMAC signature verification,
 * replay-protection timestamp checks and invoice amount matching.
 * No Deno.env / Supabase imports: unit-tested via `deno test`.
 */

/** Parse a `stripe-signature` header: `t=…,v1=…,v1=…` (multiple v1s during key rotation). */
export function parseStripeSigHeader(header: string): { t: string; v1s: string[] } | null {
  const parts = header.split(',').map(p => p.trim());
  const tPart = parts.find(p => p.startsWith('t='));
  const v1s = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!tPart || v1s.length === 0) return null;
  return { t: tPart.slice(2), v1s };
}

/** Replay protection: signature timestamp must be within `toleranceSec` of now. */
export function checkStripeTimestamp(tsSec: number, nowSec: number, toleranceSec = 300): boolean {
  if (!Number.isFinite(tsSec)) return false;
  return Math.abs(nowSec - tsSec) <= toleranceSec;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/**
 * Verify `stripe-signature` over `${t}.${payload}` (HMAC-SHA256, hex) against
 * every v1 candidate — constant-time compare, 5-minute default tolerance.
 */
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    const parsed = parseStripeSigHeader(sigHeader);
    if (!parsed) return false;
    if (!checkStripeTimestamp(Number(parsed.t), nowSec)) return false;

    const signedPayload = `${parsed.t}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    for (const v1 of parsed.v1s) {
      if (timingSafeEqualStr(v1, hex)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Defense in depth: only mark an invoice paid when the paid amount matches.
 * `paidCents` comes from `checkout.session.amount_total` / `payment_intent.amount`
 * (integer cents); `invoiceTotalDollars` is `invoices.total` (dollars).
 * Fails closed on null/NaN/non-numeric input.
 */
export function amountMatchesPaid(paidCents: unknown, invoiceTotalDollars: number, toleranceCents = 1): boolean {
  if (paidCents == null) return false;
  const paid = Number(paidCents);
  const expected = Math.round(Number(invoiceTotalDollars) * 100);
  if (!Number.isFinite(paid) || !Number.isFinite(expected)) return false;
  return Math.abs(paid - expected) <= toleranceCents;
}
