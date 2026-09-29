import { tierForRevenueCatEvent, type SubscriptionTier } from './entitlements.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`Expected ${e}, got ${a}`);
  }
}

Deno.test('purchase/renewal events grant pro (or team entitlement)', () => {
  for (const type of ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE']) {
    assertEquals(tierForRevenueCatEvent(type, undefined), 'pro');
    assertEquals(tierForRevenueCatEvent(type, 'default'), 'pro');
    assertEquals(tierForRevenueCatEvent(type, 'team'), 'team');
  }
});

Deno.test('revocation events downgrade to free', () => {
  for (const type of ['CANCELLATION', 'EXPIRATION', 'REFUND']) {
    assertEquals(tierForRevenueCatEvent(type, 'team'), 'free');
    assertEquals(tierForRevenueCatEvent(type, undefined), 'free');
  }
});

Deno.test('TEST / unknown events keep the current tier (null)', () => {
  assertEquals(tierForRevenueCatEvent('TEST', undefined), null);
  assertEquals(tierForRevenueCatEvent('NON_RENEWING_PURCHASE', 'default'), null);
  assertEquals(tierForRevenueCatEvent(undefined, 'default'), null);
  assertEquals(tierForRevenueCatEvent('', undefined), null);
});

Deno.test('tier type stays within the allowed union', () => {
  const tiers: SubscriptionTier[] = ['free', 'pro', 'team'];
  assertEquals(tiers.length, 3);
});
