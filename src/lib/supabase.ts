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

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Return a dummy client that will throw on use — allows typecheck without env
    console.warn('[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / ANON_KEY — using placeholder');
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
