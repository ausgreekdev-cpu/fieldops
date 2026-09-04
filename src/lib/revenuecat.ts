import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { Platform } from 'react-native';

let initialized = false;

export async function initRevenueCat(userId?: string) {
  if (initialized) return;
  const apiKey = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (!apiKey || apiKey.includes('...')) {
    console.log('[revenuecat] Skipped — no API key');
    return;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  await Purchases.configure({ apiKey, appUserID: userId });
  initialized = true;
}

export async function getOfferings() {
  try {
    return await Purchases.getOfferings();
  } catch (e) {
    console.warn('[revenuecat] getOfferings failed', e);
    return null;
  }
}

export async function purchasePackage(pkg: any) {
  return Purchases.purchasePackage(pkg);
}

export async function restorePurchases() {
  return Purchases.restorePurchases();
}

export async function checkEntitlement(entitlementId = 'pro') {
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active[entitlementId];
  } catch {
    return false;
  }
}
