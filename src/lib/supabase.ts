import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore adapter for Supabase auth persistence (Expo)
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    if (Platform.OS === 'web') return Promise.resolve(localStorage.getItem(key));
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return Promise.resolve();
    }
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return Promise.resolve();
    }
    return SecureStore.deleteItemAsync(key);
  },
};

let client: SupabaseClient | null = null;
let configOverride: { url: string; anonKey: string } | null = null;

// Set from first-run wizard; overrides baked env so a prebuilt installer works for anyone.
export function setSupabaseConfigOverride(url: string, anonKey: string) {
  configOverride = { url, anonKey };
  client = null; // rebuild client on next getSupabase()
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  // Prefer user-saved config (first-run wizard), then baked env, then placeholder.
  const cfg = configOverride;
  const url = cfg?.url || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = cfg?.anonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes('placeholder') || url.includes('YOUR_PROJECT')) {
    console.warn('[supabase] No real config — using placeholder (run first-run Connect screen)');
    return createClient('https://placeholder.supabase.co', 'placeholder', {
      auth: { persistSession: false },
    });
  }
  client = createClient(url, anonKey, {
    auth: {
      storage: ExpoSecureStoreAdapter as any,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

// For tests / mocking
export function __setSupabase(mock: SupabaseClient) {
  client = mock;
}

export type { SupabaseClient };
