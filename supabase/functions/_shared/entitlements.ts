/**
 * Pure RevenueCat entitlement → subscription tier mapping.
 * No Deno.env / Supabase imports: unit-tested via `deno test`.
 */

export type SubscriptionTier = 'free' | 'pro' | 'team';

const GRANT_TYPES = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE'];
const REVOKE_TYPES = ['CANCELLATION', 'EXPIRATION', 'REFUND'];

/**
 * RevenueCat event → new tier. Returns `null` for TEST / non-subscription
 * events, meaning "keep the current tier".
 */
export function tierForRevenueCatEvent(type: string | undefined, entitlementId: string | undefined): SubscriptionTier | null {
  const t = type ?? '';
  if (GRANT_TYPES.includes(t)) return entitlementId === 'team' ? 'team' : 'pro';
  if (REVOKE_TYPES.includes(t)) return 'free';
  return null;
}
